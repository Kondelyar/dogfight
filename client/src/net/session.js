import { STEP, Ship, Kind, EffectName, EventType } from 'shared';
import { Prediction } from './prediction.js';
import { Interpolator } from './interpolation.js';

const GHOST_CONFIRM_MS = 1500;
const KIND_NAME = {
  [Kind.SHIP]: 'ship',
  [Kind.BULLET]: 'bullet',
  [Kind.ASTEROID]: 'asteroid',
  [Kind.PICKUP]: 'pickup',
};

// Усе мережеве: передбачення свого корабля, інтерполяція чужих сутностей, події для звуку/HUD.
// Без DOM і canvas.
export class Session {
  constructor({ connection, bus, codec, stats, predict = true }) {
    this.connection = connection;
    this.bus = bus;
    this.codec = codec;
    this.stats = stats;
    this.predict = predict; // false = «дурний» клієнт: корабель рухається лише за знімками
    this.interpolator = new Interpolator();
    this.you = null;
    this.seed = 1;
    this.seq = 0;
    this.lastTick = 0;
    this.prediction = null;
    this.ghosts = []; // власні кулі, показані до підтвердження сервером

    connection.addEventListener('welcome', (e) => this.#onWelcome(e.detail));
    connection.addEventListener('snapshot', (e) => this.#onSnapshot(e.detail));
    connection.addEventListener('pong', (e) => {
      stats.rtt = performance.now() - e.detail.t;
    });
    this.pingTimer = setInterval(
      () => connection.send({ type: 'ping', t: performance.now() }),
      1000,
    );
  }

  dispose() {
    clearInterval(this.pingTimer);
  }

  #emit(type, detail) {
    this.bus.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // сервер нас про щось "забув" (новий join), тож починаємо з нуля
  #onWelcome({ you, seed, tick }) {
    this.you = you;
    this.seed = seed;
    this.seq = 0;
    this.lastTick = tick;
    this.prediction = null;
    this.ghosts = [];
    this.interpolator.reset();
  }

  #onSnapshot(snapshot) {
    if (this.you === null || snapshot.tick <= this.lastTick) return;

    const now = performance.now();
    this.lastTick = snapshot.tick;
    this.stats.snapshotAt = now;
    this.interpolator.push(snapshot, now);

    const mine = snapshot.entities.find((e) => e.id === this.you && e.kind === Kind.SHIP);
    if (mine) {
      if (!this.prediction) {
        this.prediction = new Prediction(Ship.fromSnapshot(mine));
      } else {
        const correction = this.prediction.reconcile(mine, snapshot.ack);
        if (this.predict) this.stats.recordCorrection(correction);
      }
      this.stats.pending = this.prediction.pending.length;
    }

    this.#syncGhosts(snapshot);
    this.#replayEvents(snapshot.events);
  }

  // кулю свою малюємо одразу (привид); коли сервер підтвердив її, привид живе за життям справжньої
  #syncGhosts(snapshot) {
    const confirmed = new Set();
    for (const e of snapshot.entities) {
      if (e.kind === Kind.BULLET && e.owner === this.you) confirmed.add(e.seq);
    }

    const now = performance.now();
    this.ghosts = this.ghosts.filter((ghost) => {
      if (confirmed.has(ghost.seq16)) {
        ghost.confirmed = true;
        return true;
      }
      if (ghost.confirmed) return false; // сервер уже прибрав її: влучила або згасла
      return now - ghost.born < GHOST_CONFIRM_MS;
    });
  }

  #replayEvents(events) {
    for (const ev of events) {
      if (ev.type === EventType.FIRED && ev.a !== this.you) {
        this.#emit('fired', { x: ev.x, y: ev.y }); // свій постріл уже пролунав при передбаченні
      } else if (ev.type === EventType.HIT) {
        this.#emit('hit', { x: ev.x, y: ev.y });
      } else if (ev.type === EventType.EXPLODED) {
        this.#emit('exploded', { kind: ev.a === 1 ? 'ship' : 'asteroid', x: ev.x, y: ev.y });
      } else if (ev.type === EventType.SCORED && ev.a === this.you) {
        this.#emit('scored', { points: ev.b, x: ev.x, y: ev.y });
      }
    }
  }

  // один крок симуляції клієнта: інпут -> передбачення -> сервер
  step(controls) {
    for (const ghost of this.ghosts) ghost.update(STEP);
    this.ghosts = this.ghosts.filter((ghost) => ghost.alive);

    if (!this.prediction) return;
    this.prediction.decay(STEP);

    const input = { seq: ++this.seq, tick: this.lastTick, ...controls };
    const bullet = this.predict ? this.prediction.apply(input) : null;
    if (bullet) {
      bullet.seq16 = input.seq & 0xffff;
      bullet.born = performance.now();
      bullet.confirmed = false;
      this.ghosts.push(bullet);
      this.#emit('fired', { x: bullet.pos.x, y: bullet.pos.y });
    }

    this.connection.sendInput(input, this.codec);
    this.stats.pending = this.prediction.pending.length;
  }

  // що малювати цього кадру: свій корабель з передбачення, решта з інтерполяції
  renderEntities(now) {
    const out = [];

    for (const r of this.interpolator.sample(now)) {
      if (this.predict && r.kind === Kind.SHIP && r.id === this.you) continue;
      if (r.kind === Kind.BULLET && r.owner === this.you && this.#hasGhost(r.seq)) continue;
      if (r.kind === Kind.SHIP && !r.alive) continue;

      const pos = { x: r.x, y: r.y };
      out.push({
        kind: KIND_NAME[r.kind],
        isMe: r.kind === Kind.SHIP && r.id === this.you,
        pos,
        prevPos: pos,
        angle: r.angle,
        prevAngle: r.angle,
        radius: r.radius ?? (r.kind === Kind.SHIP ? 12 : r.kind === Kind.BULLET ? 3 : 10),
        thrusting: r.thrusting ?? false,
        homing: r.homing ?? false,
        effect: EffectName[r.effect],
      });
    }

    if (this.predict && this.prediction?.ship.alive) out.push(this.prediction.renderShip());
    for (const ghost of this.ghosts) out.push(ghost);
    return out;
  }

  #hasGhost(seq16) {
    return this.ghosts.some((g) => g.seq16 === seq16);
  }
}
