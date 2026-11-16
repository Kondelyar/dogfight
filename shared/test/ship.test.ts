import { describe, expect, it } from 'vitest';
import {
  Kind,
  STEP,
  Ship,
  entityId,
  seq,
  tick,
  type ControlInput,
  type ShipRecord,
} from '../src/index.ts';

const idle: ControlInput = { seq: seq(1), tick: tick(0), turn: 0, thrust: false, fire: false };
const input = (patch: Partial<ControlInput>): ControlInput => ({ ...idle, ...patch });

function newShip(): Ship {
  const ship = new Ship(640, 360);
  ship.id = entityId(1);
  return ship;
}

describe('Ship.applyInput (integrate)', () => {
  it('без керування корабель стоїть', () => {
    const ship = newShip();
    ship.applyInput(idle, STEP);
    expect([ship.pos.x, ship.pos.y]).toEqual([640, 360]);
  });

  it('тяга розганяє корабель уздовж носа (початковий кут вгору)', () => {
    const ship = newShip();
    for (let i = 0; i < 10; i++) ship.applyInput(input({ thrust: true }), STEP);
    expect(ship.vel.y).toBeLessThan(0);
    expect(Math.abs(ship.vel.x)).toBeLessThan(1e-9);
    expect(ship.pos.y).toBeLessThan(360);
    expect(ship.thrusting).toBe(true);
  });

  it('поворот міняє кут із правильним знаком', () => {
    const ship = newShip();
    const before = ship.angle;
    ship.applyInput(input({ turn: 1 }), STEP);
    expect(ship.angle).toBeGreaterThan(before);
    ship.applyInput(input({ turn: -1 }), STEP);
    ship.applyInput(input({ turn: -1 }), STEP);
    expect(ship.angle).toBeLessThan(before);
  });

  it('опір повітря гасить швидкість без тяги', () => {
    const ship = newShip();
    for (let i = 0; i < 30; i++) ship.applyInput(input({ thrust: true }), STEP);
    const fast = ship.vel.length();
    for (let i = 0; i < 30; i++) ship.applyInput(idle, STEP);
    expect(ship.vel.length()).toBeLessThan(fast);
  });

  it('швидкість обмежена MAX_SPEED', () => {
    const ship = newShip();
    for (let i = 0; i < 2000; i++) ship.applyInput(input({ thrust: true }), STEP);
    expect(ship.vel.length()).toBeLessThanOrEqual(420 + 1e-9);
  });

  it('корабель завжди лишається в межах арени', () => {
    const ship = new Ship(1, 360);
    ship.id = entityId(1);
    for (let i = 0; i < 600; i++) {
      ship.applyInput(input({ turn: i % 40 < 20 ? 1 : -1, thrust: true }), STEP);
      expect(ship.pos.x).toBeGreaterThanOrEqual(0);
      expect(ship.pos.x).toBeLessThan(1280);
      expect(ship.pos.y).toBeGreaterThanOrEqual(0);
      expect(ship.pos.y).toBeLessThan(720);
    }
  });

  it('мертвий корабель не реагує на інпут', () => {
    const ship = newShip();
    ship.alive = false;
    const bullet = ship.applyInput(input({ thrust: true, fire: true }), STEP);
    expect(bullet).toBeNull();
    expect([ship.pos.x, ship.pos.y]).toEqual([640, 360]);
  });
});

describe('стрільба', () => {
  it('куля летить уздовж носа і належить кораблю', () => {
    const ship = newShip();
    const bullet = ship.applyInput(input({ fire: true }), STEP);
    expect(bullet).not.toBeNull();
    expect(bullet?.owner).toBe(1);
    expect(bullet?.vel.y).toBeLessThan(0);
    expect(bullet?.damage).toBe(18);
  });

  it('перезарядка 8 кроків, лише потім наступний постріл', () => {
    const ship = newShip();
    const shots = Array.from({ length: 9 }, () => ship.applyInput(input({ fire: true }), STEP));
    expect(shots.filter(Boolean)).toHaveLength(2);
    expect(shots[0]).not.toBeNull();
    expect(shots[8]).not.toBeNull();
  });

  it('rapidfire скорочує перезарядку до 4 кроків', () => {
    const ship = newShip();
    ship.rapidSteps = 100;
    const shots = Array.from({ length: 9 }, () => ship.applyInput(input({ fire: true }), STEP));
    expect(shots.filter(Boolean)).toHaveLength(3);
  });

  it('fire працює відірваним від корабля (поле-стрілка зберігає this)', () => {
    const ship = newShip();
    const { fire } = ship;
    expect(fire()?.owner).toBe(1);
  });
});

describe('здоров’я і стан зі знімка', () => {
  it('damage не опускає hp нижче нуля, heal не піднімає вище 100', () => {
    const ship = newShip();
    ship.damage(250);
    expect(ship.hp).toBe(0);
    ship.heal(1000);
    expect(ship.hp).toBe(100);
  });

  it('respawn повертає hp, нуль швидкості й життя', () => {
    const ship = newShip();
    ship.damage(60);
    ship.alive = false;
    ship.respawn(10, 20);
    expect([ship.hp, ship.pos.x, ship.pos.y, ship.vel.length(), ship.alive]).toEqual([
      100,
      10,
      20,
      0,
      true,
    ]);
  });

  it('fromSnapshot відтворює корабель із запису знімка', () => {
    const rec: ShipRecord = {
      id: entityId(7),
      x: 5,
      y: 6,
      vx: 1,
      vy: 2,
      angle: 0.5,
      kind: Kind.SHIP,
      alive: true,
      thrusting: true,
      hp: 55,
      score: 120,
      cooldown: 3,
      rapid: 9,
    };
    const ship = Ship.fromSnapshot(rec);
    expect([ship.id, ship.pos.x, ship.hp, ship.score, ship.fireSteps, ship.rapidSteps]).toEqual([
      7, 5, 55, 120, 3, 9,
    ]);
    expect(ship.thrusting).toBe(true);
  });
});
