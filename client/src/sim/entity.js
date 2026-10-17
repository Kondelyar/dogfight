import { Vector2 } from './vector.js';

export class Entity {
  static #nextId = 1;
  #id = Entity.#nextId++;

  constructor({ x = 0, y = 0, radius = 10, kind = 'entity' } = {}) {
    this.pos = new Vector2(x, y);
    this.prevPos = this.pos;
    this.vel = new Vector2();
    this.angle = 0;
    this.prevAngle = 0;
    this.radius = radius;
    this.kind = kind;
    this.alive = true;
  }

  get id() {
    return this.#id;
  }

  // базовий update годиться й для нерухомих речей (pickup): vel = 0
  update(dt) {
    this.prevPos = this.pos;
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
