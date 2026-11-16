import { describe, expect, it } from 'vitest';
import { Asteroid, Bullet, Vector2, findCollisions, type SimEntity } from '../src/index.ts';

const rock = (x: number, y: number, radius = 10): Asteroid =>
  new Asteroid(x, y, { radius, vel: new Vector2(), spin: 0 });

const pairs = (list: SimEntity[]): [SimEntity, SimEntity][] => [...findCollisions(list)];

describe('findCollisions', () => {
  it('знаходить пару кіл, що перекриваються', () => {
    const a = rock(0, 0);
    const b = rock(15, 0);
    expect(pairs([a, b])).toEqual([[a, b]]);
  });

  it('дотик рахується зіткненням (<=)', () => {
    expect(pairs([rock(0, 0), rock(20, 0)])).toHaveLength(1);
  });

  it('далекі сутності не стикаються', () => {
    expect(pairs([rock(0, 0), rock(100, 100)])).toHaveLength(0);
  });

  it('мертві сутності пропускаються', () => {
    const a = rock(0, 0);
    const b = rock(5, 0);
    b.alive = false;
    expect(pairs([a, b])).toHaveLength(0);
  });

  it('пари віддаються в порядку обходу (i < j)', () => {
    const a = rock(0, 0);
    const b = rock(5, 0);
    const c = rock(10, 0);
    expect(pairs([a, b, c]).map(([x, y]) => [list(a, b, c, x), list(a, b, c, y)])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it('ледача видача: загиблий друга учасник пари більше не потрапляє в наступні пари', () => {
    const a = rock(0, 0);
    const b = rock(5, 0);
    const c = rock(10, 0);
    const found: [SimEntity, SimEntity][] = [];
    for (const pair of findCollisions([a, b, c])) {
      found.push(pair);
      pair[1].alive = false; // як World.#resolve після влучання
    }
    // [a,b] -> b мертвий; [a,c] -> c мертвий; рядок b пропущено, пари [b,c] нема
    expect(found).toEqual([
      [a, b],
      [a, c],
    ]);
  });

  it('куля й астероїд різних радіусів: враховується сума радіусів', () => {
    const bullet = new Bullet(33, 0, new Vector2(), 0);
    const big = rock(0, 0, 30);
    expect(pairs([big, bullet])).toHaveLength(1);
    const far = new Bullet(34, 0, new Vector2(), 0);
    expect(pairs([big, far])).toHaveLength(0);
  });
});

function list(a: SimEntity, b: SimEntity, c: SimEntity, item: SimEntity): number {
  return [a, b, c].indexOf(item);
}
