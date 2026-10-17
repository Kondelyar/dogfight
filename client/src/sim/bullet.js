import { Entity } from './entity.js';

const TTL = 1.1;

export class Bullet extends Entity {
  constructor(x, y, vel, angle) {
    super({ x, y, radius: 3, kind: 'bullet' });
    this.vel = vel;
    this.angle = angle;
    this.prevAngle = angle;
    this.ttl = TTL;
    this.damage = 18;
    this.owner = null;
  }

  update(dt) {
    this.prevPos = this.pos;
    this.pos = this.pos.add(this.vel.scale(dt));
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}
