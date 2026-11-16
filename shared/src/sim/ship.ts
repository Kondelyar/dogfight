import type { ControlInput, ShipRecord } from '../messages.ts';
import { Entity } from './entity.ts';
import { Vector2 } from './vector.ts';
import { Bullet } from './bullet.ts';
import { wrapPosition } from './arena.ts';

const TURN_SPEED = 3.2;
const THRUST = 260;
const DRAG = 0.6;
const MAX_SPEED = 420;
const BULLET_SPEED = 480;
const FIRE_STEPS = 8; // перезарядка в кроках симуляції, не в секундах: так вона детермінована
const RAPID_FIRE_STEPS = 4;
const MAX_HP = 100;

export class Ship extends Entity {
  readonly kind = 'ship';
  #hp = MAX_HP;
  #fireSteps = 0;
  thrusting = false;
  score = 0;
  rapidSteps = 0;

  constructor(x: number, y: number) {
    super({ x, y, radius: 12 });
    this.angle = -Math.PI / 2;
    this.prevAngle = this.angle;
  }

  get hp(): number {
    return this.#hp;
  }

  get fireSteps(): number {
    return this.#fireSteps;
  }

  damage(amount: number): void {
    this.#hp = Math.max(0, this.#hp - amount);
  }

  heal(amount: number): void {
    this.#hp = Math.min(MAX_HP, this.#hp + amount);
  }

  respawn(x: number, y: number): void {
    this.pos = new Vector2(x, y);
    this.prevPos = this.pos;
    this.vel = new Vector2();
    this.#hp = MAX_HP;
    this.#fireSteps = 0;
    this.rapidSteps = 0;
    this.alive = true;
  }

  // один крок керування: чиста функція від стану й інпуту.
  // Її однаково викликають сервер (авторитетно) і клієнт (передбачення).
  applyInput(input: ControlInput, dt: number): Bullet | null {
    this.prevPos = this.pos;
    this.prevAngle = this.angle;
    if (!this.alive) return null;

    this.angle += input.turn * TURN_SPEED * dt;
    this.thrusting = input.thrust;
    if (this.thrusting) this.vel = this.vel.add(Vector2.fromAngle(this.angle, THRUST * dt));

    this.vel = this.vel.scale(1 - DRAG * dt);
    if (this.vel.length() > MAX_SPEED) this.vel = this.vel.normalize().scale(MAX_SPEED);

    const next = this.pos.add(this.vel.scale(dt));
    this.pos = wrapPosition(next);
    if (this.pos !== next) this.prevPos = this.pos;

    if (this.#fireSteps > 0) this.#fireSteps--;
    if (this.rapidSteps > 0) this.rapidSteps--;
    return input.fire ? this.fire() : null;
  }

  // поле-стрілка (Lab 2): this завжди ship, навіть якщо передати fire окремо
  fire = (): Bullet | null => {
    if (this.#fireSteps > 0) return null;
    this.#fireSteps = this.rapidSteps > 0 ? RAPID_FIRE_STEPS : FIRE_STEPS;

    const nose = this.pos.add(Vector2.fromAngle(this.angle, this.radius));
    const vel = this.vel.add(Vector2.fromAngle(this.angle, BULLET_SPEED));
    return new Bullet(nose.x, nose.y, vel, this.angle, this.id);
  };

  // стан, який сервер надсилає в знімку (звірка на клієнті)
  applyState(rec: ShipRecord): void {
    this.pos = new Vector2(rec.x, rec.y);
    this.prevPos = this.pos;
    this.vel = new Vector2(rec.vx, rec.vy);
    this.angle = rec.angle;
    this.prevAngle = rec.angle;
    this.alive = rec.alive;
    this.thrusting = rec.thrusting;
    this.#hp = rec.hp;
    this.score = rec.score;
    this.#fireSteps = rec.cooldown;
    this.rapidSteps = rec.rapid;
  }

  static fromSnapshot(rec: ShipRecord): Ship {
    const ship = new Ship(rec.x, rec.y);
    ship.id = rec.id;
    ship.applyState(rec);
    return ship;
  }
}
