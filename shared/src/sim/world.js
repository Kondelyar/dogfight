import { Vector2 } from './vector.js';
import { STEP, ARENA, RULES } from './constants.js';
import { mulberry32 } from '../prng.js';
import { Ship } from './ship.js';
import { Asteroid } from './asteroid.js';
import { createPickup, applyPickup } from './pickup.js';
import { findCollisions } from './collision.js';
import { toRecord } from './snapshot.js';

export class World extends EventTarget {
  #entities = new Map();
  #nextId = 1;
  #respawns = new Map(); // id корабля -> скільки кроків лишилось до відродження
  #rng;
  tick = 0;

  constructor({ seed = 1 } = {}) {
    super();
    this.#rng = mulberry32(seed);
  }

  get size() {
    return this.#entities.size;
  }

  get(id) {
    return this.#entities.get(id);
  }

  [Symbol.iterator]() {
    return this.#entities.values();
  }

  *ofKind(kind) {
    for (const e of this) if (e.kind === kind) yield e;
  }

  // id: 1..65535 по колу, пропускаємо зайняті (у знімку id це Uint16)
  #allocId() {
    while (this.#entities.has(this.#nextId)) this.#nextId = (this.#nextId % 65535) + 1;
    const id = this.#nextId;
    this.#nextId = (this.#nextId % 65535) + 1;
    return id;
  }

  spawn(entity) {
    entity.id = this.#allocId();
    this.#entities.set(entity.id, entity);
    return entity;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #random(min, max) {
    return min + this.#rng() * (max - min);
  }

  #edgePoint() {
    const edge = Math.floor(this.#random(0, 4));
    const x = edge === 0 ? 0 : edge === 1 ? ARENA.width : this.#random(0, ARENA.width);
    const y = edge === 2 ? 0 : edge === 3 ? ARENA.height : this.#random(0, ARENA.height);
    return new Vector2(x, y);
  }

  #spawnAsteroid(homing) {
    const at = this.#edgePoint();
    const radius = this.#random(14, 34);
    const vel = Vector2.fromAngle(this.#random(0, Math.PI * 2), this.#random(30, 90));
    const spin = this.#random(-0.75, 0.75);
    return this.spawn(new Asteroid(at.x, at.y, { radius, vel, spin, homing }));
  }

  populate() {
    for (let i = 0; i < RULES.asteroids; i++) this.#spawnAsteroid(false);
    for (let i = 0; i < RULES.hunters; i++) this.#spawnAsteroid(true);
  }

  // місце відродження подалі від астероїдів і інших кораблів
  #safeSpot() {
    let spot;
    for (let i = 0; i < 10; i++) {
      spot = new Vector2(this.#random(80, ARENA.width - 80), this.#random(80, ARENA.height - 80));
      const clear = [...this].every(
        (e) => e.kind === 'bullet' || e.kind === 'pickup' || e.pos.sub(spot).length() > 140,
      );
      if (clear) break;
    }
    return spot;
  }

  addShip() {
    const spot = this.#safeSpot();
    return this.spawn(new Ship(spot.x, spot.y));
  }

  removeShip(id) {
    this.#entities.delete(id);
    this.#respawns.delete(id);
  }

  nearestShip(pos) {
    let best = null;
    let bestDist = Infinity;
    for (const ship of this.ofKind('ship')) {
      if (!ship.alive) continue;
      const dist = ship.pos.sub(pos).length();
      if (dist < bestDist) {
        best = ship;
        bestDist = dist;
      }
    }
    return best;
  }

  applyInput(ship, input) {
    const bullet = ship.applyInput(input, STEP);
    if (!bullet) return;
    bullet.seq = input.seq;
    this.spawn(bullet);
    this.emit('fired', { x: bullet.pos.x, y: bullet.pos.y, owner: ship.id });
  }

  #score(ownerId, points, at) {
    const owner = this.get(ownerId);
    if (owner?.kind !== 'ship') return;
    owner.score += points;
    this.emit('scored', { points, x: at.x, y: at.y, owner: ownerId });
  }

  #killShip(ship, killerId) {
    ship.alive = false;
    this.#respawns.set(ship.id, RULES.respawnSteps);
    this.emit('exploded', { kind: 'ship', x: ship.pos.x, y: ship.pos.y });
    if (killerId !== ship.id) this.#score(killerId, RULES.killScore, ship.pos);
  }

  #resolve(a, b) {
    const bullet = a.kind === 'bullet' ? a : b.kind === 'bullet' ? b : null;
    const other = bullet === a ? b : a;

    if (bullet && other.kind === 'asteroid') {
      other.hp -= bullet.damage;
      bullet.alive = false;
      if (other.hp <= 0) {
        other.alive = false;
        this.emit('exploded', { kind: 'asteroid', x: other.pos.x, y: other.pos.y });
        this.#score(bullet.owner, RULES.asteroidScore, other.pos);
      } else {
        this.emit('hit', { x: other.pos.x, y: other.pos.y });
      }
      return;
    }

    if (bullet && other.kind === 'ship' && bullet.owner !== other.id) {
      other.damage(bullet.damage);
      bullet.alive = false;
      this.emit('hit', { x: other.pos.x, y: other.pos.y });
      if (other.hp === 0) this.#killShip(other, bullet.owner);
      return;
    }

    const ship = a.kind === 'ship' ? a : b.kind === 'ship' ? b : null;
    if (!ship) return;
    const rest = ship === a ? b : a;

    if (rest.kind === 'asteroid') {
      ship.damage(20);
      rest.alive = false;
      this.emit('exploded', { kind: 'asteroid', x: rest.pos.x, y: rest.pos.y });
      if (ship.hp === 0) this.#killShip(ship, ship.id);
      return;
    }

    if (rest.kind === 'pickup') {
      applyPickup(ship, rest.effect);
      rest.alive = false;
    }
  }

  // кораблі рухаються через applyInput; тут - решта світу
  step() {
    for (const e of this) {
      if (e.kind !== 'ship') e.update(STEP, this);
    }

    for (const [a, b] of findCollisions(this)) this.#resolve(a, b);

    for (const e of [...this]) {
      if (!e.alive && e.kind !== 'ship') this.#entities.delete(e.id);
    }

    for (const [id, left] of this.#respawns) {
      if (left > 1) {
        this.#respawns.set(id, left - 1);
        continue;
      }
      this.#respawns.delete(id);
      const spot = this.#safeSpot();
      this.get(id)?.respawn(spot.x, spot.y);
    }

    this.tick += 1;

    if (this.tick % 60 === 0) {
      const have = [...this.ofKind('asteroid')].filter((a) => !a.homing).length;
      if (have < RULES.asteroids) this.#spawnAsteroid(false);
    }
    if (
      this.tick % RULES.pickupEverySteps === 0 &&
      [...this.ofKind('pickup')].length < RULES.maxPickups
    ) {
      const effect = this.#rng() < 0.5 ? 'shield' : 'rapidfire';
      this.spawn(
        createPickup(
          this.#random(60, ARENA.width - 60),
          this.#random(60, ARENA.height - 60),
          effect,
        ),
      );
    }
  }

  records() {
    return [...this].map(toRecord).filter(Boolean);
  }
}
