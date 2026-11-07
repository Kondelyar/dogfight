import { Entity } from './entity.js';
import { Vector2 } from './vector.js';
import { ARENA } from './constants.js';
import { steerToward } from './homing.js';

const HUNTER_TURN = 1.2;

// усі випадкові значення приходять ззовні (з seeded PRNG світу)
export class Asteroid extends Entity {
  constructor(x, y, { radius, vel, spin, homing = false }) {
    super({ x, y, radius, kind: 'asteroid' });
    this.vel = vel;
    this.spin = spin;
    this.homing = homing;
    this.hp = radius * 2;
  }

  update(dt, world) {
    this.prevPos = this.pos;
    this.prevAngle = this.angle;
    this.angle += this.spin * dt;

    if (this.homing) {
      const target = world.nearestShip(this.pos);
      if (target) steerToward(this, target, HUNTER_TURN, dt);
    }

    this.pos = this.pos.add(this.vel.scale(dt));

    // відбиваємось лише коли летимо назовні, інакше застрягнемо біля краю
    const { x, y } = this.pos;
    let { x: vx, y: vy } = this.vel;
    if ((x < 0 && vx < 0) || (x > ARENA.width && vx > 0)) vx = -vx;
    if ((y < 0 && vy < 0) || (y > ARENA.height && vy > 0)) vy = -vy;
    if (vx !== this.vel.x || vy !== this.vel.y) this.vel = new Vector2(vx, vy);
  }
}
