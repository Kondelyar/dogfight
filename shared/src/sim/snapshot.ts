import { assertNever, toSeq16 } from '../brand.ts';
import { Effect, Kind } from '../protocol.ts';
import type { EntityRecord } from '../messages.ts';
import type { SimEntity } from './world.ts';

// сутність -> плоский запис знімка. Однаковий для JSON і для бінарного кодека.
// Порядок ключів важливий: від нього залежить хеш у determinism.ts
export function toRecord(e: SimEntity): EntityRecord {
  const base = { id: e.id, x: e.pos.x, y: e.pos.y, vx: e.vel.x, vy: e.vel.y, angle: e.angle };

  switch (e.kind) {
    case 'ship':
      return {
        ...base,
        kind: Kind.SHIP,
        alive: e.alive,
        thrusting: e.thrusting,
        hp: e.hp,
        score: Math.min(e.score, 65535),
        cooldown: e.fireSteps,
        rapid: e.rapidSteps,
      };
    case 'bullet':
      return { ...base, kind: Kind.BULLET, owner: e.owner, seq: toSeq16(e.seq) };
    case 'asteroid':
      return { ...base, kind: Kind.ASTEROID, radius: Math.round(e.radius), homing: e.homing };
    case 'pickup':
      return { ...base, kind: Kind.PICKUP, effect: Effect[e.effect] };
    default:
      return assertNever(e);
  }
}
