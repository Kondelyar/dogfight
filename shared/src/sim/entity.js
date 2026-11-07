import { Vector2 } from './vector.js';

// id видає World (а не лічильник у класі): так він детермінований для матчу й влазить у Uint16
export class Entity {
  constructor({ x = 0, y = 0, radius = 10, kind = 'entity' } = {}) {
    this.id = 0;
    this.pos = new Vector2(x, y);
    this.prevPos = this.pos;
    this.vel = new Vector2();
    this.angle = 0;
    this.prevAngle = 0;
    this.radius = radius;
    this.kind = kind;
    this.alive = true;
  }

  update(dt) {
    this.prevPos = this.pos;
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
