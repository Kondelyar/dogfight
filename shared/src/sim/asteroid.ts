import { Entity, type WorldView } from './entity.ts';
import { Vector2 } from './vector.ts';
import { ARENA } from './constants.ts';
import { steerToward } from './homing.ts';

const HUNTER_TURN = 1.2;

export interface AsteroidInit {
  radius: number;
  vel: Vector2;
  spin: number;
  homing?: boolean;
}

// усі випадкові значення приходять ззовні (з seeded PRNG світу)
export class Asteroid extends Entity {
  readonly kind = 'asteroid';
  spin: number;
  homing: boolean;
  hp: number;

  constructor(x: number, y: number, { radius, vel, spin, homing = false }: AsteroidInit) {
    super({ x, y, radius });
    this.vel = vel;
    this.spin = spin;
    this.homing = homing;
    this.hp = radius * 2;
  }

  override update(dt: number, world: WorldView): void {
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
