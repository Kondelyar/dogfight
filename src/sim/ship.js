import { Entity } from './entity.js';
import { Vector2 } from './vector.js';
import { Bullet } from './bullet.js';

const TURN_SPEED = 3.2;
const THRUST = 260;
const DRAG = 0.6;
const MAX_SPEED = 420;
const FIRE_COOLDOWN = 0.25;
const MAX_HP = 100;

export class Ship extends Entity {
  #hp = MAX_HP;
  #fireTimer = 0;

  constructor(x, y) {
    super({ x, y, radius: 12, kind: 'ship' });
    this.angle = -Math.PI / 2;
    this.prevAngle = this.angle;
    this.thrusting = false;
    this.score = 0;
  }

  get hp() {
    return this.#hp;
  }

  damage(amount) {
    this.#hp = Math.max(0, this.#hp - amount);
  }

  heal(amount) {
    this.#hp = Math.min(MAX_HP, this.#hp + amount);
  }

  update(dt, input) {
    this.prevPos = this.pos;
    this.prevAngle = this.angle;

    if (input.isDown('ArrowLeft') || input.isDown('KeyA')) this.angle -= TURN_SPEED * dt;
    if (input.isDown('ArrowRight') || input.isDown('KeyD')) this.angle += TURN_SPEED * dt;

    this.thrusting = input.isDown('ArrowUp') || input.isDown('KeyW');

    if (this.thrusting) {
      this.vel = this.vel.add(Vector2.fromAngle(this.angle, THRUST * dt));
    }

    this.vel = this.vel.scale(1 - DRAG * dt);
    if (this.vel.length() > MAX_SPEED) {
      this.vel = this.vel.normalize().scale(MAX_SPEED);
    }

    this.pos = this.pos.add(this.vel.scale(dt));

    if (this.#fireTimer > 0) this.#fireTimer -= dt;
  }

  // поле-стрілка, не метод на прототипі: this всередині завжди ship,
  // навіть якщо fire передати кудись окремо від самого ship
  // (причина і довша відповідь - README, розділ this-bug)
  fire = (world) => {
    if (this.#fireTimer > 0 || !this.alive) return null;
    
    // Перевіряємо, чи діє зараз бонус синьої кульки
    const hasRapidFire = this.rapidFireUntil && performance.now() < this.rapidFireUntil;
    
    // Якщо бонус активний - затримка стає 0.05с (в 5 разів швидше!), інакше стандартні 0.25с
    this.#fireTimer = hasRapidFire ? 0.05 : FIRE_COOLDOWN;

    const nose = this.pos.add(Vector2.fromAngle(this.angle, this.radius));
    const bulletVel = this.vel.add(Vector2.fromAngle(this.angle, 480));
    const bullet = new Bullet(nose.x, nose.y, bulletVel, this.angle);
    bullet.owner = this;
    world.spawn(bullet);
    return bullet;
  };
}
