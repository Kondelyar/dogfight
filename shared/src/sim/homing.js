import { Vector2 } from './vector.js';
import { wrapAngle } from './arena.js';

// наведення як окрема поведінка: працює для будь-якої сутності з angle/vel (Lab 2, M4)
export function steerToward(entity, target, turnSpeed, dt) {
  const to = target.pos.sub(entity.pos);
  const diff = wrapAngle(Math.atan2(to.y, to.x) - entity.angle);
  entity.angle += Math.sign(diff) * Math.min(Math.abs(diff), turnSpeed * dt);
  entity.vel = Vector2.fromAngle(entity.angle, entity.vel.length());
}
