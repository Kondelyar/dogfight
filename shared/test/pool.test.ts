import { describe, expect, it } from 'vitest';
import {
  FrameArena,
  Pool,
  Vector2,
  bulletPool,
  entityId,
  obtainBullet,
  releaseBullet,
} from '../src/index.ts';

describe('Pool', () => {
  it('створює об’єкти лише коли пул порожній і віддає назад повернуті', () => {
    const pool = new Pool(() => ({ n: 0 }));
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.created).toBe(2);
    pool.release(a);
    expect(pool.available).toBe(1);
    expect(pool.acquire()).toBe(a);
    expect(pool.created).toBe(2);
    pool.release(b);
  });

  it('не тримає більше за max вільних об’єктів', () => {
    const pool = new Pool(() => ({}), { max: 2 });
    const items = [pool.acquire(), pool.acquire(), pool.acquire()];
    items.forEach((i) => pool.release(i));
    expect(pool.available).toBe(2);
  });
});

describe('FrameArena', () => {
  it('після reset віддає ті самі об’єкти, нових не створює', () => {
    let created = 0;
    const arena = new FrameArena(() => ({ id: ++created }));
    const first = [arena.next(), arena.next(), arena.next()];
    expect(arena.used).toBe(3);
    arena.reset();
    expect(arena.used).toBe(0);
    const second = [arena.next(), arena.next(), arena.next()];
    expect(second).toEqual(first);
    expect(second[0]).toBe(first[0]);
    expect(created).toBe(3);
    expect(arena.capacity).toBe(3);
  });

  it('росте, коли на кадрі потрібно більше об’єктів, ніж було', () => {
    const arena = new FrameArena(() => ({}));
    arena.next();
    arena.reset();
    arena.next();
    arena.next();
    expect(arena.capacity).toBe(2);
  });
});

describe('пул куль', () => {
  it('куля після release повертається повністю скинутою', () => {
    const owner = entityId(3);
    const bullet = obtainBullet(10, 20, new Vector2(5, 6), 1, owner);
    bullet.ttl = 0.01;
    bullet.alive = false;
    bullet.damage = 999;
    bullet.id = entityId(77);
    releaseBullet(bullet);

    const again = obtainBullet(1, 2, new Vector2(), 0.5, entityId(4));
    expect(again).toBe(bullet);
    expect([again.pos.x, again.pos.y, again.owner, again.alive, again.damage, again.id]).toEqual([
      1,
      2,
      4,
      true,
      18,
      0,
    ]);
    expect(again.ttl).toBeCloseTo(1.1, 12);
    releaseBullet(again);
  });

  it('пул не росте, якщо кулі повертають: 1000 пострілів - кілька об’єктів', () => {
    const before = bulletPool.created;
    for (let i = 0; i < 1000; i++) releaseBullet(obtainBullet(0, 0, new Vector2(), 0, entityId(1)));
    expect(bulletPool.created - before).toBeLessThanOrEqual(1);
  });
});
