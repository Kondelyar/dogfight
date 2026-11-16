import { NO_ENTITY, seq as toSeq, type EntityId, type Seq } from '../brand.ts';
import { Pool } from '../pool.ts';
import { Entity } from './entity.ts';
import { Vector2 } from './vector.ts';
import { wrapCoord } from './arena.ts';
import { ARENA } from './constants.ts';

const TTL = 1.1;
const DAMAGE = 18;
const ZERO = new Vector2();

export class Bullet extends Entity {
  readonly kind = 'bullet';
  owner: EntityId = NO_ENTITY;
  seq: Seq = toSeq(0);
  ttl = TTL;
  damage = DAMAGE;

  constructor(x: number, y: number, vel: Vector2, angle: number, owner: EntityId = NO_ENTITY) {
    super({ x, y, radius: 3 });
    this.init(x, y, vel, angle, owner);
  }

  // Повна (пере)ініціалізація: однаково для нової кулі і для кулі з пулу.
  init(x: number, y: number, vel: Vector2, angle: number, owner: EntityId): this {
    this.id = NO_ENTITY;
    this.pos = new Vector2(x, y);
    this.prevPos = this.pos;
    this.vel = vel;
    this.angle = angle;
    this.prevAngle = angle;
    this.owner = owner;
    this.seq = toSeq(0);
    this.ttl = TTL;
    this.damage = DAMAGE;
    this.alive = true;
    return this;
  }

  override update(dt: number): void {
    const old = this.pos;
    const nx = old.x + this.vel.x * dt;
    const ny = old.y + this.vel.y * dt;
    const wx = wrapCoord(nx, ARENA.width);
    const wy = wrapCoord(ny, ARENA.height);
    // скалярна арифметика замість add/scale: той самий результат, але одна алокація замість трьох
    const wrapped = wx !== nx || wy !== ny;
    this.pos = new Vector2(wx, wy);
    this.prevPos = wrapped ? this.pos : old;
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
  }
}

// Кулі стріляються постійно (кожен корабель до 4 разів на секунду на сервері і на клієнті
// для передбачення), тому беремо їх з пулу.
const bullets = new Pool<Bullet>(() => new Bullet(0, 0, ZERO, 0));

export function obtainBullet(
  x: number,
  y: number,
  vel: Vector2,
  angle: number,
  owner: EntityId,
): Bullet {
  return bullets.acquire().init(x, y, vel, angle, owner);
}

// Повертати можна лише кулю, яку вже ніхто не тримає (прибрана зі світу чи зі списку привидів).
export function releaseBullet(bullet: Bullet): void {
  bullet.alive = false;
  bullets.release(bullet);
}

export const bulletPool = bullets;
