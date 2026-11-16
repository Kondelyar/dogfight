import { NO_ENTITY, seq as toSeq, type EntityId, type Seq } from '../brand.ts';
import { Entity } from './entity.ts';
import { Vector2 } from './vector.ts';
import { wrapPosition } from './arena.ts';

const TTL = 1.1;

export class Bullet extends Entity {
  readonly kind = 'bullet';
  owner: EntityId;
  seq: Seq = toSeq(0);
  ttl = TTL;
  damage = 18;

  constructor(x: number, y: number, vel: Vector2, angle: number, owner: EntityId = NO_ENTITY) {
    super({ x, y, radius: 3 });
    this.vel = vel;
    this.angle = angle;
    this.prevAngle = angle;
    this.owner = owner;
  }

  override update(dt: number): void {
    this.prevPos = this.pos;
    const next = this.pos.add(this.vel.scale(dt));
    this.pos = wrapPosition(next);
    if (this.pos !== next) this.prevPos = this.pos;
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}
