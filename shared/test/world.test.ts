import { describe, expect, it } from 'vitest';
import {
  Asteroid,
  Bullet,
  Kind,
  Pickup,
  RULES,
  STEP,
  TICK_MS,
  Vector2,
  World,
  type WorldEvents,
  scriptedInput,
} from '../src/index.ts';

const still = (radius: number, x: number, y: number, homing = false): Asteroid =>
  new Asteroid(x, y, { radius, vel: new Vector2(), spin: 0, homing });

// збирає події світу в масив пар [назва, дані]
function record(world: World): [keyof WorldEvents, unknown][] {
  const seen: [keyof WorldEvents, unknown][] = [];
  world.on('fired', (d) => seen.push(['fired', d]));
  world.on('hit', (d) => seen.push(['hit', d]));
  world.on('exploded', (d) => seen.push(['exploded', d]));
  world.on('scored', (d) => seen.push(['scored', d]));
  return seen;
}

describe('World: наповнення і id', () => {
  it('populate додає 5 астероїдів і 1 мисливця', () => {
    const world = new World({ seed: 1 });
    world.populate();
    const asteroids = [...world.ofKind('asteroid')];
    expect(asteroids).toHaveLength(RULES.asteroids + RULES.hunters);
    expect(asteroids.filter((a) => a.homing)).toHaveLength(RULES.hunters);
  });

  it('id унікальні й вкладаються в Uint16', () => {
    const world = new World({ seed: 1 });
    world.populate();
    world.addShip();
    world.addShip();
    const ids = [...world].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id >= 1 && id <= 65535)).toBe(true);
  });

  it('addShip ставить корабель усередину арени', () => {
    const world = new World({ seed: 3 });
    const ship = world.addShip();
    expect(ship.pos.x).toBeGreaterThanOrEqual(80);
    expect(ship.pos.x).toBeLessThanOrEqual(1200);
    expect(world.get(ship.id)).toBe(ship);
  });

  it('removeShip прибирає корабель зі світу', () => {
    const world = new World({ seed: 3 });
    const ship = world.addShip();
    world.removeShip(ship.id);
    expect(world.get(ship.id)).toBeUndefined();
    expect(world.size).toBe(0);
  });

  it('ofKind віддає лише потрібний вид', () => {
    const world = new World({ seed: 1 });
    world.populate();
    world.addShip();
    expect([...world.ofKind('ship')]).toHaveLength(1);
    expect([...world.ofKind('bullet')]).toHaveLength(0);
  });
});

describe('World: крок і події', () => {
  it('step збільшує tick, applyInput зі стрільбою створює кулю й подію fired', () => {
    const world = new World({ seed: 1 });
    const ship = world.addShip();
    const seen = record(world);
    world.applyInput(ship, { ...scriptedInput(0), fire: true });
    world.step();
    expect(world.tick).toBe(1);
    expect([...world.ofKind('bullet')]).toHaveLength(1);
    expect(seen.map(([name]) => name)).toEqual(['fired']);
  });

  it('куля згасає за ttl (~1.1 с)', () => {
    const world = new World({ seed: 1 });
    const ship = world.addShip();
    world.applyInput(ship, { ...scriptedInput(0), fire: true });
    for (let i = 0; i < 40; i++) world.step();
    expect([...world.ofKind('bullet')]).toHaveLength(0);
  });

  it('куля влучає в астероїд: hit, потім знищення і 10 очок власнику', () => {
    const world = new World({ seed: 1 });
    const ship = world.addShip();
    const seen = record(world);
    const asteroid = world.spawn(still(14, 100, 100));
    asteroid.hp = 20;

    world.spawn(new Bullet(100, 100, new Vector2(), 0, ship.id));
    world.step();
    expect(seen.map(([name]) => name)).toEqual(['hit']);
    expect(asteroid.hp).toBe(2);

    world.spawn(new Bullet(100, 100, new Vector2(), 0, ship.id));
    world.step();
    expect(seen.map(([name]) => name)).toEqual(['hit', 'exploded', 'scored']);
    expect(ship.score).toBe(RULES.asteroidScore);
    expect(world.get(asteroid.id)).toBeUndefined();
  });

  it('куля чужого корабля завдає шкоди, власна куля не шкодить', () => {
    const world = new World({ seed: 1 });
    const a = world.addShip();
    const b = world.addShip();
    b.respawn(500, 500);

    world.spawn(new Bullet(500, 500, new Vector2(), 0, b.id));
    world.step();
    expect(b.hp).toBe(100);

    world.spawn(new Bullet(500, 500, new Vector2(), 0, a.id));
    world.step();
    expect(b.hp).toBe(82);
  });

  it('вбивство: вибух корабля, 50 очок убивці, відродження через 60 кроків', () => {
    const world = new World({ seed: 1 });
    const killer = world.addShip();
    const victim = world.addShip();
    victim.respawn(500, 500);
    victim.damage(90);
    const seen = record(world);

    world.spawn(new Bullet(500, 500, new Vector2(), 0, killer.id));
    world.step();
    expect(victim.alive).toBe(false);
    expect(killer.score).toBe(RULES.killScore);
    expect(seen.map(([name]) => name)).toContain('exploded');

    for (let i = 0; i < RULES.respawnSteps; i++) world.step();
    expect(victim.alive).toBe(true);
    expect(victim.hp).toBe(100);
  });

  it('зіткнення з астероїдом: -20 hp, астероїд зникає', () => {
    const world = new World({ seed: 1 });
    const ship = world.addShip();
    ship.respawn(300, 300);
    const asteroid = world.spawn(still(20, 300, 300));
    world.step();
    expect(ship.hp).toBe(80);
    expect(world.get(asteroid.id)).toBeUndefined();
  });

  it('pickup: rapidfire вмикає прискорену стрільбу, shield лікує', () => {
    const world = new World({ seed: 1 });
    const ship = world.addShip();
    ship.respawn(300, 300);
    ship.damage(50);

    const rapid = world.spawn(new Pickup(300, 300, 'rapidfire'));
    world.step();
    expect(ship.rapidSteps).toBe(RULES.rapidSteps);
    expect(world.get(rapid.id)).toBeUndefined();

    world.spawn(new Pickup(300, 300, 'shield'));
    world.step();
    expect(ship.hp).toBe(50 + RULES.shieldHeal);
  });

  it('мисливець наближається до корабля', () => {
    const world = new World({ seed: 1 });
    const ship = world.addShip();
    ship.respawn(900, 360);
    const hunter = world.spawn(
      new Asteroid(100, 360, { radius: 20, vel: new Vector2(60, 0), spin: 0, homing: true }),
    );
    const before = hunter.pos.sub(ship.pos).length();
    for (let i = 0; i < 30; i++) world.step();
    expect(hunter.pos.sub(ship.pos).length()).toBeLessThan(before);
  });

  it('астероїд відбивається від краю арени, а не вилітає назовні', () => {
    const world = new World({ seed: 1 });
    world.spawn(new Asteroid(5, 360, { radius: 14, vel: new Vector2(-300, 0), spin: 0 }));
    for (let i = 0; i < 20; i++) world.step();
    const [a] = world.ofKind('asteroid');
    expect(a).toBeDefined();
    expect(a?.vel.x).toBeGreaterThan(0);
  });

  it('кожні 8 с (240 кроків) з’являється pickup, але не більше трьох', () => {
    const world = new World({ seed: 5 });
    for (let i = 0; i < RULES.pickupEverySteps * 6; i++) world.step();
    const pickups = [...world.ofKind('pickup')];
    expect(pickups.length).toBeGreaterThan(0);
    expect(pickups.length).toBeLessThanOrEqual(RULES.maxPickups);
  });

  it('поповнює астероїди, якщо їх стало менше за норму', () => {
    const world = new World({ seed: 9 });
    for (let i = 0; i < 120; i++) world.step();
    expect([...world.ofKind('asteroid')].length).toBeGreaterThan(0);
  });
});

describe('World: знімок і детермінізм', () => {
  it('records дає запис для кожної сутності зі своїм kind', () => {
    const world = new World({ seed: 2 });
    world.populate();
    world.addShip();
    const records = world.records();
    expect(records).toHaveLength(world.size);
    expect(records.filter((r) => r.kind === Kind.SHIP)).toHaveLength(1);
    expect(records.filter((r) => r.kind === Kind.ASTEROID)).toHaveLength(6);
  });

  it('два світи з однаковим seed і інпутами дають однакові знімки', () => {
    const run = () => {
      const world = new World({ seed: 11 });
      world.populate();
      const ships = [world.addShip(), world.addShip()];
      for (let i = 0; i < 200; i++) {
        ships.forEach((s, n) => world.applyInput(s, scriptedInput(i + n * 3)));
        world.step();
      }
      return JSON.stringify(world.records());
    };
    expect(run()).toBe(run());
  });

  it('константи узгоджені: STEP і TICK_MS описують одну частоту', () => {
    expect(STEP * 1000).toBeCloseTo(TICK_MS, 10);
  });
});
