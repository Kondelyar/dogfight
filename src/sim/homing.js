import { Vector2 } from './vector.js';

// причепити до будь-якої сутності з .pos/.angle/.vel - кулі чи астероїда,
// без того щоб писати HomingBullet extends Bullet і HomingAsteroid extends Asteroid
export function withHoming(entity, getTarget, turnSpeed = 2.5) {
  const baseUpdate = entity.update.bind(entity);
  entity.homing = true;

  entity.update = (dt, ...rest) => {
    const target = getTarget();
    if (target && target.alive) {
      const toTarget = target.pos.sub(entity.pos);
      const desiredAngle = Math.atan2(toTarget.y, toTarget.x);

      let diff = desiredAngle - entity.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      entity.angle += Math.sign(diff) * Math.min(Math.abs(diff), turnSpeed * dt);

      const speed = entity.vel.length();
      entity.vel = Vector2.fromAngle(entity.angle, speed);
    }

    baseUpdate(dt, ...rest);
  };

  return entity;
}
