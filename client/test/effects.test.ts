import { describe, expect, it } from 'vitest';
import { ARENA } from 'shared';
import { EXPLOSION_TTL, Explosions, makeStars } from '../src/effects.ts';

describe('Explosions (пул вибухів і частинок)', () => {
  it('spawn дає вибух із 16 частинками в потрібній точці', () => {
    const ex = new Explosions();
    const e = ex.spawn(10, 20);
    expect(e.pos).toEqual({ x: 10, y: 20 });
    expect(e.particles).toHaveLength(16);
    expect(e.ttl).toBe(EXPLOSION_TTL);
    expect(ex.active).toHaveLength(1);
  });

  it('update розсуває частинки і зменшує ttl', () => {
    const ex = new Explosions();
    const e = ex.spawn(0, 0);
    ex.update(0.1);
    expect(e.ttl).toBeCloseTo(EXPLOSION_TTL - 0.1, 9);
    expect(e.particles.some((p) => p.offset.x !== 0 || p.offset.y !== 0)).toBe(true);
  });

  it('після закінчення ttl вибух зникає з active і повертається в пул', () => {
    const ex = new Explosions();
    ex.spawn(0, 0);
    ex.update(EXPLOSION_TTL + 0.01);
    expect(ex.active).toHaveLength(0);
    expect(ex.pool.available).toBe(1);
  });

  it('наступний вибух бере той самий об’єкт з пулу, скинутий до нуля', () => {
    const ex = new Explosions();
    const first = ex.spawn(5, 5);
    ex.update(0.3);
    ex.update(1); // догорів
    const again = ex.spawn(50, 60);
    expect(again).toBe(first);
    expect(again.pos).toEqual({ x: 50, y: 60 });
    expect(again.ttl).toBe(EXPLOSION_TTL);
    expect(again.particles.every((p) => p.offset.x === 0 && p.offset.y === 0)).toBe(true);
  });

  it('1000 вибухів підряд не створюють 1000 об’єктів', () => {
    const ex = new Explosions();
    for (let i = 0; i < 1000; i++) {
      ex.spawn(i, i);
      ex.update(1);
    }
    expect(ex.pool.created).toBeLessThanOrEqual(2);
  });

  it('частина вибухів живе довше за інші: догоряють по черзі, порядок решти зберігається', () => {
    const ex = new Explosions();
    const a = ex.spawn(1, 1);
    ex.update(0.4);
    const b = ex.spawn(2, 2);
    ex.update(0.3); // a догорів (0.7 > 0.6), b живий
    expect(ex.active).toEqual([b]);
    expect(ex.active[0]).toBe(b);
    expect(a.ttl).toBeLessThan(0);
  });
});

describe('makeStars', () => {
  it('однаковий seed дає однакове небо, різний - інше', () => {
    expect(makeStars(7)).toEqual(makeStars(7));
    expect(makeStars(7)).not.toEqual(makeStars(8));
  });

  it('зірки всередині арени, розміру 1 або 2', () => {
    for (const s of makeStars(3, 300)) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(ARENA.width);
      expect(s.y).toBeLessThan(ARENA.height);
      expect([1, 2]).toContain(s.size);
    }
  });
});
