import { entityId, tick, type EntityId, type Tick } from '../brand.ts';
import { Emitter } from '../emitter.ts';
import type { ControlInput, EntityRecord } from '../messages.ts';
import { Vector2 } from './vector.ts';
import { STEP, ARENA, RULES } from './constants.ts';
import { mulberry32 } from '../prng.ts';
import { Ship } from './ship.ts';
import { Bullet } from './bullet.ts';
import { Asteroid } from './asteroid.ts';
import { Pickup, applyPickup } from './pickup.ts';
import { findCollisions } from './collision.ts';
import { toRecord } from './snapshot.ts';

export type SimEntity = Ship | Bullet | Asteroid | Pickup;
export type EntityKind = SimEntity['kind'];
export type OfKind<K extends EntityKind> = Extract<SimEntity, { kind: K }>;

// Події світу: звук, HUD і мережевий шар слухають їх, сама симуляція про них нічого не знає.
export interface WorldEvents {
  fired: { x: number; y: number; owner: EntityId };
  hit: { x: number; y: number };
  exploded: { kind: 'ship' | 'asteroid'; x: number; y: number };
  scored: { points: number; x: number; y: number; owner: EntityId };
}

// предикат-звуження замість приведення типу: tsc вірить сигнатурі, а перевірка лишається в коді
function isKind<K extends EntityKind>(kind: K): (e: SimEntity) => e is OfKind<K> {
  return (e): e is OfKind<K> => e.kind === kind;
}

// знаходить у парі сутність потрібного виду й повертає її разом із другою
function pick<K extends EntityKind>(
  kind: K,
  a: SimEntity,
  b: SimEntity,
): [OfKind<K>, SimEntity] | null {
  const is = isKind(kind);
  if (is(a)) return [a, b];
  if (is(b)) return [b, a];
  return null;
}

export class World extends Emitter<WorldEvents> {
  #entities = new Map<EntityId, SimEntity>();
  #nextId = 1;
  #respawns = new Map<EntityId, number>(); // id корабля -> скільки кроків лишилось до відродження
  #rng: () => number;
  tick: Tick = tick(0);

  constructor({ seed = 1 }: { seed?: number } = {}) {
    super();
    this.#rng = mulberry32(seed);
  }

  get size(): number {
    return this.#entities.size;
  }

  get(id: EntityId): SimEntity | undefined {
    return this.#entities.get(id);
  }

  [Symbol.iterator](): IterableIterator<SimEntity> {
    return this.#entities.values();
  }

  *ofKind<K extends EntityKind>(kind: K): Generator<OfKind<K>> {
    const is = isKind(kind);
    for (const e of this) if (is(e)) yield e;
  }

  // id: 1..65535 по колу, пропускаємо зайняті (у знімку id це Uint16)
  #allocId(): EntityId {
    while (this.#entities.has(entityId(this.#nextId))) this.#nextId = (this.#nextId % 65535) + 1;
    const id = entityId(this.#nextId);
    this.#nextId = (this.#nextId % 65535) + 1;
    return id;
  }

  spawn<T extends SimEntity>(entity: T): T {
    entity.id = this.#allocId();
    this.#entities.set(entity.id, entity);
    return entity;
  }

  #random(min: number, max: number): number {
    return min + this.#rng() * (max - min);
  }

  #edgePoint(): Vector2 {
    const edge = Math.floor(this.#random(0, 4));
    const x = edge === 0 ? 0 : edge === 1 ? ARENA.width : this.#random(0, ARENA.width);
    const y = edge === 2 ? 0 : edge === 3 ? ARENA.height : this.#random(0, ARENA.height);
    return new Vector2(x, y);
  }

  #spawnAsteroid(homing: boolean): Asteroid {
    const at = this.#edgePoint();
    const radius = this.#random(14, 34);
    const vel = Vector2.fromAngle(this.#random(0, Math.PI * 2), this.#random(30, 90));
    const spin = this.#random(-0.75, 0.75);
    return this.spawn(new Asteroid(at.x, at.y, { radius, vel, spin, homing }));
  }

  populate(): void {
    for (let i = 0; i < RULES.asteroids; i++) this.#spawnAsteroid(false);
    for (let i = 0; i < RULES.hunters; i++) this.#spawnAsteroid(true);
  }

  #spotCandidate(): Vector2 {
    return new Vector2(this.#random(80, ARENA.width - 80), this.#random(80, ARENA.height - 80));
  }

  #isClear(spot: Vector2): boolean {
    return [...this].every(
      (e) => e.kind === 'bullet' || e.kind === 'pickup' || e.pos.sub(spot).length() > 140,
    );
  }

  // місце відродження подалі від астероїдів і інших кораблів (не більше 10 спроб)
  #safeSpot(): Vector2 {
    let spot = this.#spotCandidate();
    for (let i = 1; i < 10 && !this.#isClear(spot); i++) spot = this.#spotCandidate();
    return spot;
  }

  addShip(): Ship {
    const spot = this.#safeSpot();
    return this.spawn(new Ship(spot.x, spot.y));
  }

  removeShip(id: EntityId): void {
    this.#entities.delete(id);
    this.#respawns.delete(id);
  }

  nearestShip(pos: Vector2): Ship | null {
    let best: Ship | null = null;
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

  applyInput(ship: Ship, input: ControlInput): void {
    const bullet = ship.applyInput(input, STEP);
    if (!bullet) return;
    bullet.seq = input.seq;
    this.spawn(bullet);
    this.emit('fired', { x: bullet.pos.x, y: bullet.pos.y, owner: ship.id });
  }

  #score(ownerId: EntityId, points: number, at: Vector2): void {
    const owner = this.get(ownerId);
    if (owner?.kind !== 'ship') return;
    owner.score += points;
    this.emit('scored', { points, x: at.x, y: at.y, owner: ownerId });
  }

  #killShip(ship: Ship, killerId: EntityId): void {
    ship.alive = false;
    this.#respawns.set(ship.id, RULES.respawnSteps);
    this.emit('exploded', { kind: 'ship', x: ship.pos.x, y: ship.pos.y });
    if (killerId !== ship.id) this.#score(killerId, RULES.killScore, ship.pos);
  }

  #resolve(a: SimEntity, b: SimEntity): void {
    const withBullet = pick('bullet', a, b);
    if (withBullet) {
      const [bullet, other] = withBullet;

      if (other.kind === 'asteroid') {
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

      if (other.kind === 'ship' && bullet.owner !== other.id) {
        other.damage(bullet.damage);
        bullet.alive = false;
        this.emit('hit', { x: other.pos.x, y: other.pos.y });
        if (other.hp === 0) this.#killShip(other, bullet.owner);
        return;
      }
    }

    const withShip = pick('ship', a, b);
    if (!withShip) return;
    const [ship, rest] = withShip;

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
  step(): void {
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
      const ship = this.get(id);
      if (ship?.kind === 'ship') ship.respawn(spot.x, spot.y);
    }

    this.tick = tick(this.tick + 1);

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
        new Pickup(this.#random(60, ARENA.width - 60), this.#random(60, ARENA.height - 60), effect),
      );
    }
  }

  records(): EntityRecord[] {
    return [...this].map(toRecord);
  }
}
