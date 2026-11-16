import { describe, expect, it } from 'vitest';
import { ARENA, Vector2, wrapAngle, wrapDelta, wrapPosition } from '../src/index.ts';

describe('wrapPosition', () => {
  it('усередині арени повертає той самий об’єкт (без виділення пам’яті)', () => {
    const p = new Vector2(100, 200);
    expect(wrapPosition(p)).toBe(p);
  });

  it('виліт за правий і нижній край повертає з протилежного боку', () => {
    const p = wrapPosition(new Vector2(ARENA.width + 10, ARENA.height + 5));
    expect([p.x, p.y]).toEqual([10, 5]);
  });

  it('виліт за лівий і верхній край теж загортається', () => {
    const p = wrapPosition(new Vector2(-10, -5));
    expect([p.x, p.y]).toEqual([ARENA.width - 10, ARENA.height - 5]);
  });

  it('точно на краю (x = width) вже вважається за межами', () => {
    expect(wrapPosition(new Vector2(ARENA.width, 0)).x).toBe(0);
  });
});

describe('wrapDelta', () => {
  it('найкоротша різниця на колі: 1270 -> 10 це +20', () => {
    expect(wrapDelta(10 - 1270, ARENA.width)).toBe(20);
    expect(wrapDelta(1270 - 10, ARENA.width)).toBe(-20);
  });

  it('малі різниці не чіпає', () => {
    expect(wrapDelta(30, ARENA.width)).toBe(30);
    expect(wrapDelta(-30, ARENA.width)).toBe(-30);
  });
});

describe('wrapAngle', () => {
  it('зводить кут у проміжок від -π до π', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapAngle(0.5)).toBe(0.5);
    expect(wrapAngle(2 * Math.PI + 0.25)).toBeCloseTo(0.25, 12);
  });
});
