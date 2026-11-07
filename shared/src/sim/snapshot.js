import { Kind, Effect } from '../protocol.js';

// сутність -> плоский запис знімка. Однаковий для JSON і для бінарного кодека.
export function toRecord(e) {
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
      return { ...base, kind: Kind.BULLET, owner: e.owner, seq: e.seq & 0xffff };
    case 'asteroid':
      return { ...base, kind: Kind.ASTEROID, radius: Math.round(e.radius), homing: e.homing };
    case 'pickup':
      return { ...base, kind: Kind.PICKUP, effect: Effect[e.effect] };
    default:
      return null;
  }
}
