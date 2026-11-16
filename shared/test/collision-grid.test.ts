import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  Asteroid,
  Vector2,
  World,
  findCollisions,
  findCollisionsGrid,
  findCollisionsNaive,
  GRID_THRESHOLD,
  scriptedInput,
  type SimEntity,
} from '../src/index.ts';

const rock = (x: number, y: number, radius: number): Asteroid =>
  new Asteroid(x, y, { radius, vel: new Vector2(), spin: 0 });

const indexPairs = (
  list: SimEntity[],
  finder: (w: Iterable<SimEntity>) => Generator<[SimEntity, SimEntity]>,
  killSecond = false,
): [number, number][] => {
  const out: [number, number][] = [];
  for (const [a, b] of finder(list)) {
    out.push([list.indexOf(a), list.indexOf(b)]);
    if (killSecond) b.alive = false; // як World.#resolve після влучання
  }
  return out;
};

const circle = fc.record({
  x: fc.double({ min: -50, max: 1330, noNaN: true }),
  y: fc.double({ min: -50, max: 770, noNaN: true }),
  radius: fc.double({ min: 1, max: 40, noNaN: true }),
  alive: fc.boolean(),
});

describe('просторовий хеш проти наївного обходу', () => {
  it('віддає ті самі пари в тому самому порядку (fast-check)', () => {
    fc.assert(
      fc.property(fc.array(circle, { maxLength: 260 }), (circles) => {
        const make = () =>
          circles.map((c) => {
            const e = rock(c.x, c.y, c.radius);
            e.alive = c.alive;
            return e;
          });
        const naive = indexPairs(make(), findCollisionsNaive);
        const grid = indexPairs(make(), findCollisions);
        expect(grid).toEqual(naive);
      }),
      { numRuns: 300 },
    );
  });

  it('те саме, якщо після кожної пари другий учасник гине (ледача видача)', () => {
    fc.assert(
      fc.property(fc.array(circle, { maxLength: 260 }), (circles) => {
        const make = () => circles.map((c) => rock(c.x, c.y, c.radius));
        expect(indexPairs(make(), findCollisions, true)).toEqual(
          indexPairs(make(), findCollisionsNaive, true),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('примусова сітка дає той самий результат навіть на малих сценах', () => {
    const items = Array.from({ length: 10 }, (_, i) => rock(i * 4, 0, 10));
    expect(indexPairs(items, findCollisionsGrid)).toEqual(indexPairs(items, findCollisionsNaive));
  });

  it('малі сцени (< GRID_THRESHOLD) іде наївним шляхом, великі - сіткою, результат однаковий', () => {
    const small = Array.from({ length: GRID_THRESHOLD - 1 }, (_, i) => rock(i * 3, 0, 10));
    const big = Array.from({ length: GRID_THRESHOLD + 1 }, (_, i) => rock(i * 3, 0, 10));
    expect(indexPairs(small, findCollisions)).toEqual(indexPairs(small, findCollisionsNaive));
    expect(indexPairs(big, findCollisions)).toEqual(indexPairs(big, findCollisionsNaive));
  });

  it('сутності за краєм арени (від’ємні координати) теж знаходяться', () => {
    const a = rock(-10, -10, 20);
    const b = rock(-5, -5, 20);
    expect([...findCollisions([a, b])]).toEqual([[a, b]]);
  });

  it('два обходи одночасно не заважають одне одному', () => {
    const items = [rock(0, 0, 10), rock(5, 0, 10), rock(500, 500, 10), rock(505, 500, 10)];
    const outer = findCollisions(items);
    const first = outer.next();
    const inner = [...findCollisions(items)];
    expect(inner).toHaveLength(2);
    expect(first.done).toBe(false);
    expect([...outer]).toHaveLength(1);
  });

  it('гра з хешем дає той самий стан світу, що й раніше (хеш детермінізму не змінився)', () => {
    const world = new World({ seed: 21 });
    world.populate();
    const ships = [world.addShip(), world.addShip(), world.addShip()];
    for (let i = 0; i < 400; i++) {
      ships.forEach((s, n) =>
        world.applyInput(s, { ...scriptedInput(i + n * 5), fire: i % 4 === 0 }),
      );
      world.step();
    }
    expect(world.tick).toBe(400);
    expect(world.size).toBeGreaterThan(0);
  });
});
