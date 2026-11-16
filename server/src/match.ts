import {
  World,
  TICK_MS,
  TICK_RATE,
  codecs,
  EventType,
  encodeServerMessage,
  seq,
  type ControlInput,
  type Seq,
  type Ship,
  type SnapshotEvent,
} from 'shared';
import type { Player, Room } from './rooms.ts';

const MAX_QUEUE = 20;
const MAX_CREDITS = 3; // скільки інпутів можна "надолужити" після лагу
const SAMPLES = 120;
const MAX_EVENTS = 255; // eventCount у кадрі - один байт

const avg = (list: number[]): number =>
  list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0;
const round = (n: number): number => Math.round(n * 100) / 100;

interface ClientState {
  player: Player;
  ship: Ship;
  queue: ControlInput[];
  credits: number;
  lastQueued: Seq;
  lastSeq: Seq;
}

export interface MatchStats {
  room: string;
  players: number;
  tick: number;
  tickMs: { avg: number; max: number };
  intervalMs: { avg: number; jitter: number };
  overruns: number;
}

export class Match {
  #room: Room;
  #seed: number;
  #world: World;
  #clients = new Map<string, ClientState>(); // id гравця -> стан
  #events: SnapshotEvent[] = [];
  #timer: NodeJS.Timeout | null = null;
  #next = 0;
  #lastStart = 0;
  #durations: number[] = [];
  #intervals: number[] = [];
  #overruns = 0;

  constructor(room: Room, { seed }: { seed: number }) {
    this.#room = room;
    this.#seed = seed;
    this.#world = new World({ seed });
    this.#world.populate();

    // події світу -> події знімка; кожен тип має свій обробник у типізованій таблиці
    this.#world.on('fired', (d) =>
      this.#record({ type: EventType.FIRED, x: d.x, y: d.y, owner: d.owner }),
    );
    this.#world.on('hit', (d) => this.#record({ type: EventType.HIT, x: d.x, y: d.y }));
    this.#world.on('exploded', (d) =>
      this.#record({ type: EventType.EXPLODED, x: d.x, y: d.y, what: d.kind }),
    );
    this.#world.on('scored', (d) =>
      this.#record({ type: EventType.SCORED, x: d.x, y: d.y, owner: d.owner, points: d.points }),
    );

    room.on('join', (player) => this.#add(player));
    room.on('leave', (player) => this.#remove(player));
    room.on('input', (player, input) => this.#queue(player, input));
    room.on('empty', () => this.stop());
  }

  #record(event: SnapshotEvent): void {
    if (this.#events.length < MAX_EVENTS) this.#events.push(event);
  }

  #add(player: Player): void {
    const ship = this.#world.addShip();
    this.#clients.set(player.id, {
      player,
      ship,
      queue: [],
      credits: 1,
      lastQueued: seq(0),
      lastSeq: seq(0),
    });
    player.send(
      encodeServerMessage({
        type: 'welcome',
        you: ship.id,
        seed: this.#seed,
        tick: this.#world.tick,
        tickRate: TICK_RATE,
      }),
      true,
    );
    this.start();
  }

  #remove(player: Player): void {
    const client = this.#clients.get(player.id);
    if (!client) return;
    this.#world.removeShip(client.ship.id);
    this.#clients.delete(player.id);
  }

  #queue(player: Player, input: ControlInput): void {
    const client = this.#clients.get(player.id);
    if (!client || input.seq <= client.lastQueued) return; // старий або повторений
    client.lastQueued = input.seq;
    if (client.queue.length >= MAX_QUEUE) client.queue.shift();
    client.queue.push(input);
  }

  // Точний таймер: кожен тік планується на абсолютний час, а не "через 33 мс від попереднього",
  // тому похибка setTimeout не накопичується (на відміну від setInterval).
  start(): void {
    if (this.#timer) return;
    this.#next = performance.now() + TICK_MS;
    this.#lastStart = 0;
    this.#schedule();
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(): void {
    this.#timer = setTimeout(() => this.#run(), Math.max(0, this.#next - performance.now()));
  }

  #run(): void {
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

  #push(list: number[], value: number): void {
    list.push(value);
    if (list.length > SAMPLES) list.shift();
  }

  #tick(): void {
    for (const client of this.#clients.values()) {
      // довгостроково не більше одного інпуту на тік: інакше можна летіти швидше за правила
      client.credits = Math.min(MAX_CREDITS, client.credits + 1);
      while (client.credits >= 1) {
        const input = client.queue.shift();
        if (!input) break;
        client.credits -= 1;
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

  stats(): MatchStats {
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
