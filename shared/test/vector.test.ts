import { describe, expect, it } from 'vitest';
import { Vector2 } from '../src/index.ts';

describe('Vector2', () => {
  it('за замовчуванням нульовий', () => {
    const v = new Vector2();
    expect([v.x, v.y]).toEqual([0, 0]);
  });

  it('add і sub повертають нові вектори й не міняють оригінали', () => {
    const a = new Vector2(1, 2);
    const b = new Vector2(10, 20);
    const sum = a.add(b);
    expect([sum.x, sum.y]).toEqual([11, 22]);
    const diff = b.sub(a);
    expect([diff.x, diff.y]).toEqual([9, 18]);
    expect([a.x, a.y, b.x, b.y]).toEqual([1, 2, 10, 20]);
  });

  it('scale множить обидві компоненти', () => {
    const v = new Vector2(3, -4).scale(2);
    expect([v.x, v.y]).toEqual([6, -8]);
  });

  it('length це довжина гіпотенузи', () => {
    expect(new Vector2(3, 4).length()).toBe(5);
  });

  it('normalize дає одиничний вектор, а нульовий лишається нульовим', () => {
    const n = new Vector2(0, 10).normalize();
    expect([n.x, n.y]).toEqual([0, 1]);
    const zero = new Vector2().normalize();
    expect([zero.x, zero.y]).toEqual([0, 0]);
  });

  it('rotate на чверть оберту міняє осі місцями', () => {
    const r = new Vector2(1, 0).rotate(Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
  });

  it('dot: перпендикулярні дають 0, паралельні добуток довжин', () => {
    expect(new Vector2(1, 0).dot(new Vector2(0, 5))).toBe(0);
    expect(new Vector2(2, 0).dot(new Vector2(3, 0))).toBe(6);
  });

  it('fromAngle будує вектор потрібної довжини під кутом', () => {
    const v = Vector2.fromAngle(Math.PI, 5);
    expect(v.x).toBeCloseTo(-5, 12);
    expect(v.y).toBeCloseTo(0, 12);
    expect(Vector2.fromAngle(1.2).length()).toBeCloseTo(1, 12);
  });
});
