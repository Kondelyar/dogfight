import { seq, type EntityId, type Seq, type Tick } from './brand.ts';
import { mulberry32 } from './prng.ts';
import { Kind } from './protocol.ts';
import type { ControlInput, EntityRecord, ShipRecord, Snapshot, Turn } from './messages.ts';
import { ARENA } from './sim/constants.ts';
import { wrapAngle, wrapDelta } from './sim/arena.ts';

const AIM_TOLERANCE = 0.12; // рад: так близько до цілі вже не крутимось
const FIRE_CONE = 0.3; // рад: у такому конусі стріляємо
const FIRE_RANGE = 520;
const KEEP_DISTANCE = 140;

function isTarget(e: EntityRecord, you: EntityId): boolean {
  if (e.id === you) return false;
  if (e.kind === Kind.SHIP) return e.alive;
  return e.kind === Kind.ASTEROID;
}

// Мозок бота: з останнього знімка вирішує, що натиснути. Видає такий самий ControlInput,
// що й людина: сервер не відрізняє бота від клавіатури. Детермінований від seed.
export class BotBrain {
  #rng: () => number;
  #seq = 0;

  constructor(seed: number) {
    this.#rng = mulberry32(seed);
  }

  get lastSeq(): Seq {
    return seq(this.#seq);
  }

  #nextInput(tick: Tick, turn: Turn, thrust: boolean, fire: boolean): ControlInput {
    this.#seq += 1;
    return { seq: seq(this.#seq), tick, turn, thrust, fire };
  }

  #findMe(snapshot: Snapshot, you: EntityId): ShipRecord | null {
    for (const e of snapshot.entities) {
      if (e.kind === Kind.SHIP && e.id === you) return e;
    }
    return null;
  }

  decide(snapshot: Snapshot, you: EntityId): ControlInput {
    const me = this.#findMe(snapshot, you);
    if (!me || !me.alive) return this.#nextInput(snapshot.tick, 0, false, false);

    let best: EntityRecord | null = null;
    let bestDist = Infinity;
    for (const e of snapshot.entities) {
      if (!isTarget(e, you)) continue;
      const dx = wrapDelta(e.x - me.x, ARENA.width);
      const dy = wrapDelta(e.y - me.y, ARENA.height);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    if (!best) return this.#nextInput(snapshot.tick, 0, true, false);

    const dx = wrapDelta(best.x - me.x, ARENA.width);
    const dy = wrapDelta(best.y - me.y, ARENA.height);
    const diff = wrapAngle(Math.atan2(dy, dx) - me.angle);

    const turn: Turn = Math.abs(diff) < AIM_TOLERANCE ? 0 : diff > 0 ? 1 : -1;
    const thrust = bestDist > KEEP_DISTANCE && this.#rng() < 0.85;
    const fire = Math.abs(diff) < FIRE_CONE && bestDist < FIRE_RANGE && this.#rng() < 0.7;
    return this.#nextInput(snapshot.tick, turn, thrust, fire);
  }
}
