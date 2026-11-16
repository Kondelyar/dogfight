import type { ControlInput, ShipRecord } from '../messages.ts';
import { Entity } from './entity.ts';
import { Vector2 } from './vector.ts';
import { obtainBullet, type Bullet } from './bullet.ts';
import { wrapCoord } from './arena.ts';
import { ARENA } from './constants.ts';

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

    // Скалярна арифметика замість ланцюжка add/scale/normalize: ті самі операції в тому самому
    // порядку (результат бітово однаковий, хеш детермінізму не змінюється), але 2 алокації на крок.
    let vx = this.vel.x;
    let vy = this.vel.y;
    if (this.thrusting) {
      const push = THRUST * dt;
      vx += Math.cos(this.angle) * push;
      vy += Math.sin(this.angle) * push;
    }

    const drag = 1 - DRAG * dt;
    vx *= drag;
    vy *= drag;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      const inverse = 1 / speed;
      vx = vx * inverse * MAX_SPEED;
      vy = vy * inverse * MAX_SPEED;
    }
    this.vel = new Vector2(vx, vy);

    const nx = this.pos.x + vx * dt;
    const ny = this.pos.y + vy * dt;
    const wx = wrapCoord(nx, ARENA.width);
    const wy = wrapCoord(ny, ARENA.height);
    this.pos = new Vector2(wx, wy);
    if (wx !== nx || wy !== ny) this.prevPos = this.pos;

    if (this.#fireSteps > 0) this.#fireSteps--;
    if (this.rapidSteps > 0) this.rapidSteps--;
    return input.fire ? this.fire() : null;
  }

  // поле-стрілка (Lab 2): this завжди ship, навіть якщо передати fire окремо
  fire = (): Bullet | null => {
    if (this.#fireSteps > 0) return null;
    this.#fireSteps = this.rapidSteps > 0 ? RAPID_FIRE_STEPS : FIRE_STEPS;

    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const noseX = this.pos.x + cos * this.radius;
    const noseY = this.pos.y + sin * this.radius;
    const vel = new Vector2(this.vel.x + cos * BULLET_SPEED, this.vel.y + sin * BULLET_SPEED);
    return obtainBullet(noseX, noseY, vel, this.angle, this.id);
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
