import { Entity } from './entity.js';
import { Vector2 } from './vector.js';

export class Asteroid extends Entity {
  constructor(x, y) {
    const radius = 14 + Math.random() * 20;
    super({ x, y, radius, kind: 'asteroid' });
    const speed = 30 + Math.random() * 60;
    this.vel = Vector2.fromAngle(Math.random() * Math.PI * 2, speed);
    this.spin = (Math.random() - 0.5) * 1.5;
    this.hp = radius * 2;
  }

  update(dt, _input, bounds) {
    this.prevPos = this.pos;
    this.prevAngle = this.angle;

    this.angle += this.spin * dt;
    this.pos = this.pos.add(this.vel.scale(dt));

    if (this.pos.x < 0 || this.pos.x > bounds.width) {
      this.vel = new Vector2(-this.vel.x, this.vel.y);
    }
    if (this.pos.y < 0 || this.pos.y > bounds.height) {
      this.vel = new Vector2(this.vel.x, -this.vel.y);
    }
  }
}
