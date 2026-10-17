import { Entity } from './entity.js';
import { Vector2 } from './vector.js';

const TTL = 0.6;
const PARTICLE_COUNT = 16;

export class Explosion extends Entity {
  constructor(x, y) {
    super({ x, y, radius: 1, kind: 'explosion' });
    this.ttl = TTL;
    this.particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      offset: new Vector2(),
      vel: Vector2.fromAngle(Math.random() * Math.PI * 2, 60 + Math.random() * 120),
    }));
  }

  update(dt) {
    this.prevPos = this.pos;
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.alive = false;
      return;
    }
    for (const p of this.particles) {
      p.offset = p.offset.add(p.vel.scale(dt));
    }
  }
}
