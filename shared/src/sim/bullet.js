import { Entity } from './entity.js';
import { wrapPosition } from './arena.js';

const TTL = 1.1;

export class Bullet extends Entity {
  constructor(x, y, vel, angle, owner = 0) {
    super({ x, y, radius: 3, kind: 'bullet' });
    this.vel = vel;
    this.angle = angle;
    this.prevAngle = angle;
    this.owner = owner;
    this.seq = 0;
    this.ttl = TTL;
    this.damage = 18;
  }

  update(dt) {
    this.prevPos = this.pos;
    const next = this.pos.add(this.vel.scale(dt));
    this.pos = wrapPosition(next);
    if (this.pos !== next) this.prevPos = this.pos;
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}
