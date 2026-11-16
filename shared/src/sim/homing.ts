import { Vector2 } from './vector.ts';
import { wrapAngle } from './arena.ts';

interface Steerable {
  pos: Vector2;
  vel: Vector2;
  angle: number;
}

// наведення як окрема поведінка: працює для будь-якої сутності з angle/vel (Lab 2, M4)
export function steerToward(
  entity: Steerable,
  target: { readonly pos: Vector2 },
  turnSpeed: number,
  dt: number,
): void {
  const to = target.pos.sub(entity.pos);
  const diff = wrapAngle(Math.atan2(to.y, to.x) - entity.angle);
  entity.angle += Math.sign(diff) * Math.min(Math.abs(diff), turnSpeed * dt);
  entity.vel = Vector2.fromAngle(entity.angle, entity.vel.length());
}
