import {
  STEP,
  Ship,
  Kind,
  EventType,
  assertNever,
  effectName,
  seq,
  tick,
  toSeq16,
  type Bullet,
  type Codec,
  type Emitter,
  type EntityId,
  type Seq16,
  type ShipRecord,
  type Snapshot,
  type SnapshotEvent,
  type Tick,
  type Turn,
  type WorldEvents,
  type Seq,
} from 'shared';
import { Prediction } from './prediction.ts';
import { Interpolator } from './interpolation.ts';
import type { Connection } from './connection.ts';
import type { NetStats } from './netstats.ts';
import type { RenderEntity } from '../render/types.ts';

const GHOST_CONFIRM_MS = 1500;

export interface Controls {
  turn: Turn;
  thrust: boolean;
  fire: boolean;
}

// Власна куля, показана до підтвердження сервером ("привид"): куля + службові поля.
interface Ghost {
  bullet: Bullet;
  seq16: Seq16;
  born: number;
  confirmed: boolean;
}

export interface SessionOptions {
  connection: Connection;
  bus: Emitter<WorldEvents>;
  codec: Codec;
  stats: NetStats;
  predict?: boolean;
}

// Усе мережеве: передбачення свого корабля, інтерполяція чужих сутностей, події для звуку/HUD.
// Без DOM і canvas.
export class Session {
  connection: Connection;
  bus: Emitter<WorldEvents>;
  codec: Codec;
  stats: NetStats;
  predict: boolean; // false = «дурний» клієнт: корабель рухається лише за знімками
  interpolator = new Interpolator();
  you: EntityId | null = null;
  seed = 1;
  seq: Seq = seq(0);
  lastTick: Tick = tick(0);
  prediction: Prediction | null = null;
  ghosts: Ghost[] = []; // власні кулі, показані до підтвердження сервером
  pingTimer: ReturnType<typeof setInterval>;

  constructor({ connection, bus, codec, stats, predict = true }: SessionOptions) {
    this.connection = connection;
    this.bus = bus;
    this.codec = codec;
    this.stats = stats;
    this.predict = predict;

    connection.on('welcome', (msg) => this.#onWelcome(msg));
    connection.on('snapshot', (snapshot) => this.#onSnapshot(snapshot));
    connection.on('pong', (msg) => {
      stats.rtt = performance.now() - msg.t;
    });
    this.pingTimer = setInterval(
      () => connection.send({ type: 'ping', t: performance.now() }),
      1000,
    );
  }

  dispose(): void {
    clearInterval(this.pingTimer);
  }

  // сервер нас про щось "забув" (новий join), тож починаємо з нуля
  #onWelcome({ you, seed, tick: serverTick }: { you: EntityId; seed: number; tick: Tick }): void {
    this.you = you;
    this.seed = seed;
    this.seq = seq(0);
    this.lastTick = serverTick;
    this.prediction = null;
    this.ghosts = [];
    this.interpolator.reset();
  }

  #findMyShip(snapshot: Snapshot): ShipRecord | null {
    for (const e of snapshot.entities) {
      if (e.kind === Kind.SHIP && e.id === this.you) return e;
    }
    return null;
  }

  #onSnapshot(snapshot: Snapshot): void {
    if (this.you === null || snapshot.tick <= this.lastTick) return;

    const now = performance.now();
    this.lastTick = snapshot.tick;
    this.stats.snapshotAt = now;
    this.interpolator.push(snapshot, now);

    const mine = this.#findMyShip(snapshot);
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
    for (const event of snapshot.events) this.#replayEvent(event);
  }

  // кулю свою малюємо одразу (привид); коли сервер підтвердив її, привид живе за життям справжньої
  #syncGhosts(snapshot: Snapshot): void {
    const confirmed = new Set<Seq16>();
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

  // Вичерпний switch по type: нова подія знімка без обробника - помилка tsc
  #replayEvent(ev: SnapshotEvent): void {
    switch (ev.type) {
      case EventType.FIRED:
        // свій постріл уже пролунав при передбаченні
        if (ev.owner !== this.you) this.bus.emit('fired', { x: ev.x, y: ev.y, owner: ev.owner });
        return;
      case EventType.HIT:
        return this.bus.emit('hit', { x: ev.x, y: ev.y });
      case EventType.EXPLODED:
        return this.bus.emit('exploded', { kind: ev.what, x: ev.x, y: ev.y });
      case EventType.SCORED:
        if (ev.owner === this.you) {
          this.bus.emit('scored', { points: ev.points, x: ev.x, y: ev.y, owner: ev.owner });
        }
        return;
      default:
        return assertNever(ev);
    }
  }

  // один крок симуляції клієнта: інпут -> передбачення -> сервер
  step(controls: Controls): void {
    for (const ghost of this.ghosts) ghost.bullet.update(STEP);
    this.ghosts = this.ghosts.filter((ghost) => ghost.bullet.alive);

    if (!this.prediction) return;
    this.prediction.decay(STEP);

    this.seq = seq(this.seq + 1);
    const input = { seq: this.seq, tick: this.lastTick, ...controls };
    const bullet = this.predict ? this.prediction.apply(input) : null;
    if (bullet) {
      this.ghosts.push({
        bullet,
        seq16: toSeq16(input.seq),
        born: performance.now(),
        confirmed: false,
      });
      this.bus.emit('fired', { x: bullet.pos.x, y: bullet.pos.y, owner: bullet.owner });
    }

    this.connection.sendInput(input, this.codec);
    this.stats.pending = this.prediction.pending.length;
  }

  // що малювати цього кадру: свій корабель з передбачення, решта з інтерполяції
  renderEntities(now: number): RenderEntity[] {
    const out: RenderEntity[] = [];

    for (const r of this.interpolator.sample(now)) {
      const pos = { x: r.x, y: r.y };
      const common = { pos, prevPos: pos, angle: r.angle, prevAngle: r.angle };

      switch (r.kind) {
        case Kind.SHIP:
          if (this.predict && r.id === this.you) break;
          if (!r.alive) break;
          out.push({
            ...common,
            kind: 'ship',
            isMe: r.id === this.you,
            radius: 12,
            thrusting: r.thrusting,
          });
          break;
        case Kind.BULLET:
          if (r.owner === this.you && this.#hasGhost(r.seq)) break;
          out.push({ ...common, kind: 'bullet', radius: 3 });
          break;
        case Kind.ASTEROID:
          out.push({ ...common, kind: 'asteroid', radius: r.radius, homing: r.homing });
          break;
        case Kind.PICKUP:
          out.push({ ...common, kind: 'pickup', radius: 10, effect: effectName(r.effect) });
          break;
        default:
          assertNever(r);
      }
    }

    if (this.predict && this.prediction?.ship.alive) out.push(this.prediction.renderShip());
    for (const ghost of this.ghosts) out.push(ghost.bullet);
    return out;
  }

  #hasGhost(seq16: Seq16): boolean {
    return this.ghosts.some((g) => g.seq16 === seq16);
  }
}
