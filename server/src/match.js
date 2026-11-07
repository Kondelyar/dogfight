import { World, TICK_MS, TICK_RATE, codecs, EventType } from 'shared';
import { encode } from './protocol.js';

const MAX_QUEUE = 20;
const MAX_CREDITS = 3; // скільки інпутів можна "надолужити" після лагу
const SAMPLES = 120;

const EVENT_RECORDS = {
  fired: (d) => ({ type: EventType.FIRED, x: d.x, y: d.y, a: d.owner, b: 0 }),
  hit: (d) => ({ type: EventType.HIT, x: d.x, y: d.y, a: 0, b: 0 }),
  exploded: (d) => ({
    type: EventType.EXPLODED,
    x: d.x,
    y: d.y,
    a: d.kind === 'ship' ? 1 : 2,
    b: 0,
  }),
  scored: (d) => ({ type: EventType.SCORED, x: d.x, y: d.y, a: d.owner, b: d.points }),
};

const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
const round = (n) => Math.round(n * 100) / 100;

export class Match {
  #room;
  #seed;
  #world;
  #clients = new Map(); // id гравця -> { player, ship, queue, credits, lastQueued, lastSeq }
  #events = [];
  #timer = null;
  #next = 0;
  #lastStart = 0;
  #durations = [];
  #intervals = [];
  #overruns = 0;

  constructor(room, { seed }) {
    this.#room = room;
    this.#seed = seed;
    this.#world = new World({ seed });
    this.#world.populate();

    for (const [name, toRecord] of Object.entries(EVENT_RECORDS)) {
      this.#world.addEventListener(name, (e) => {
        if (this.#events.length < 255) this.#events.push(toRecord(e.detail));
      });
    }

    room.on('join', (player) => this.#add(player));
    room.on('leave', (player) => this.#remove(player));
    room.on('input', (player, input) => this.#queue(player, input));
    room.on('empty', () => this.stop());
  }

  #add(player) {
    const ship = this.#world.addShip();
    this.#clients.set(player.id, {
      player,
      ship,
      queue: [],
      credits: 1,
      lastQueued: 0,
      lastSeq: 0,
    });
    player.send(
      encode('welcome', {
        you: ship.id,
        seed: this.#seed,
        tick: this.#world.tick,
        tickRate: TICK_RATE,
      }),
      true,
    );
    this.start();
  }

  #remove(player) {
    const client = this.#clients.get(player.id);
    if (!client) return;
    this.#world.removeShip(client.ship.id);
    this.#clients.delete(player.id);
  }

  #queue(player, input) {
    const client = this.#clients.get(player.id);
    if (!client || input.seq <= client.lastQueued) return; // старий або повторений
    client.lastQueued = input.seq;
    if (client.queue.length >= MAX_QUEUE) client.queue.shift();
    client.queue.push(input);
  }

  // Точний таймер: кожен тік планується на абсолютний час, а не "через 33 мс від попереднього",
  // тому похибка setTimeout не накопичується (на відміну від setInterval).
  start() {
    if (this.#timer) return;
    this.#next = performance.now() + TICK_MS;
    this.#lastStart = 0;
    this.#schedule();
  }

  stop() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule() {
    this.#timer = setTimeout(() => this.#run(), Math.max(0, this.#next - performance.now()));
  }

  #run() {
    const started = performance.now();
    if (this.#lastStart) this.#push(this.#intervals, started - this.#lastStart);
    this.#lastStart = started;

    this.#tick();

    const ended = performance.now();
    this.#push(this.#durations, ended - started);
    this.#next += TICK_MS;
    if (ended > this.#next) {
      // тік тривав довше за інтервал (CPU не встигає): не наздоганяємо серією тіків
      this.#overruns += 1;
      this.#next = ended + TICK_MS;
    }
    this.#schedule();
  }

  #push(list, value) {
    list.push(value);
    if (list.length > SAMPLES) list.shift();
  }

  #tick() {
    for (const client of this.#clients.values()) {
      // довгостроково не більше одного інпуту на тік: інакше можна летіти швидше за правила
      client.credits = Math.min(MAX_CREDITS, client.credits + 1);
      while (client.credits >= 1 && client.queue.length) {
        client.credits -= 1;
        const input = client.queue.shift();
        this.#world.applyInput(client.ship, input);
        client.lastSeq = input.seq;
      }
    }

    this.#world.step();

    const entities = this.#world.records();
    const events = this.#events.splice(0);
    for (const client of this.#clients.values()) {
      const snapshot = { tick: this.#world.tick, ack: client.lastSeq, entities, events };
      client.player.sendState(codecs[client.player.codec].encodeSnapshot(snapshot));
    }
  }

  stats() {
    const jitter = Math.max(0, ...this.#intervals.map((i) => Math.abs(i - TICK_MS)));
    return {
      room: this.#room.id,
      players: this.#clients.size,
      tick: this.#world.tick,
      tickMs: { avg: round(avg(this.#durations)), max: round(Math.max(0, ...this.#durations)) },
      intervalMs: { avg: round(avg(this.#intervals)), jitter: round(jitter) },
      overruns: this.#overruns,
    };
  }
}
