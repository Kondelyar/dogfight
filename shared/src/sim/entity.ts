import { NO_ENTITY, type EntityId } from '../brand.ts';
import { Vector2 } from './vector.ts';

// те, що сутності потрібно знати про світ (щоб не тягнути сюди весь World)
export interface WorldView {
  nearestShip(pos: Vector2): { readonly pos: Vector2 } | null;
}

export interface EntityInit {
  x?: number;
  y?: number;
  radius?: number;
}

// id видає World (а не лічильник у класі): так він детермінований для матчу й влазить у Uint16
export abstract class Entity {
  abstract readonly kind: string;
  id: EntityId = NO_ENTITY;
  pos: Vector2;
  prevPos: Vector2;
  vel = new Vector2();
  angle = 0;
  prevAngle = 0;
  readonly radius: number;
  alive = true;

  constructor({ x = 0, y = 0, radius = 10 }: EntityInit = {}) {
    this.pos = new Vector2(x, y);
    this.prevPos = this.pos;
    this.radius = radius;
  }

  update(dt: number, _world: WorldView): void {
    this.prevPos = this.pos;
    this.pos = this.pos.add(this.vel.scale(dt));
  }
}
