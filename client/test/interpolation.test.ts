import { describe, expect, it } from 'vitest';
import {
  ARENA,
  EventType,
  Kind,
  TICK_MS,
  entityId,
  seq,
  tick,
  type EntityRecord,
  type Snapshot,
} from 'shared';
import { Interpolator, lerpAngleBetween, lerpX, lerpY } from '../src/net/interpolation.ts';

function rock(id: number, x: number, y: number, angle = 0): EntityRecord {
  return {
    id: entityId(id),
    kind: Kind.ASTEROID,
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    radius: 20,
    homing: false,
  };
}

const snap = (n: number, entities: EntityRecord[]): Snapshot => ({
  tick: tick(n),
  ack: seq(0),
  entities,
  events: [{ type: EventType.HIT, x: 0, y: 0 }],
});

describe('lerp-функції по колу', () => {
  it('lerpX іде найкоротшим шляхом через край арени', () => {
    expect(lerpX(1270, 10, 0.5)).toBeCloseTo(0, 9); // 1270 -> 1290 (=10), середина на краю
    expect(lerpX(100, 200, 0.25)).toBe(125);
  });

  it('lerpY теж загортається', () => {
    expect(lerpY(710, 10, 0.5)).toBeCloseTo(0, 9);
    expect(lerpY(0, 0, 0.7)).toBe(0);
  });

  it('lerpAngleBetween не крутить «довгим» шляхом', () => {
    expect(lerpAngleBetween(3, -3, 0.5)).toBeCloseTo(3 + (2 * Math.PI - 6) / 2, 9);
    expect(lerpAngleBetween(0, 1, 0.5)).toBe(0.5);
  });

  it('результат завжди в межах арени', () => {
    for (let x = -50; x < 1330; x += 37) {
      const v = lerpX(x, x + 400, 0.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(ARENA.width);
    }
  });
});

describe('Interpolator', () => {
  it('без знімків нічого не показує', () => {
    expect(new Interpolator().sample(1000)).toEqual([]);
  });

  it('малює між двома знімками, що оточують (now - delay)', () => {
    const interp = new Interpolator();
    interp.delay = 0;
    interp.push(snap(10, [rock(1, 100, 100)]), 1000);
    interp.push(snap(11, [rock(1, 200, 100)]), 1000 + TICK_MS);
    // серверний час першого знімка 10*TICK_MS, offset = max(time - now)
    const mid = interp.sample(1000 + TICK_MS / 2);
    expect(mid).toHaveLength(1);
    expect(mid[0]?.x).toBeCloseTo(150, 6);
  });

  it('якщо знімки закінчились, стоїть на останньому і не екстраполює', () => {
    const interp = new Interpolator();
    interp.delay = 0;
    interp.push(snap(1, [rock(1, 50, 50)]), 0);
    const result = interp.sample(10_000);
    expect(result[0]?.x).toBe(50);
  });

  it('сутність, що зникла у наступному знімку, лишається на місці', () => {
    const interp = new Interpolator();
    interp.delay = 0;
    interp.push(snap(1, [rock(1, 10, 10), rock(2, 20, 20)]), 0);
    interp.push(snap(2, [rock(1, 30, 10)]), TICK_MS);
    const ids = interp.sample(TICK_MS / 2).map((e) => e.id);
    expect(ids).toEqual([1, 2]);
  });

  it('visit віддає пари без створення проміжних записів', () => {
    const interp = new Interpolator();
    interp.delay = 0;
    const a = rock(1, 0, 0);
    const b = rock(1, 100, 0);
    interp.push(snap(1, [a]), 0);
    interp.push(snap(2, [b]), TICK_MS);
    const seen: [EntityRecord, EntityRecord | undefined, number][] = [];
    interp.visit(TICK_MS / 2, (x, y, t) => seen.push([x, y, t]));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(a); // той самий об'єкт, не копія
    expect(seen[0]?.[1]).toBe(b);
    expect(seen[0]?.[2]).toBeCloseTo(0.5, 6);
  });

  it('reset забуває знімки, а старі знімки відкидаються (пам’ять не росте)', () => {
    const interp = new Interpolator();
    for (let i = 1; i <= 200; i++) interp.push(snap(i, [rock(1, i, 0)]), i * TICK_MS);
    expect(interp.sample(200 * TICK_MS).length).toBe(1);
    interp.reset();
    expect(interp.sample(200 * TICK_MS)).toEqual([]);
  });

  it('перевикористовує Map-и між знімками (пул)', () => {
    const interp = new Interpolator();
    interp.delay = 0;
    for (let i = 1; i <= 50; i++) interp.push(snap(i, [rock(1, i, 0), rock(2, 0, i)]), i * TICK_MS);
    const out = interp.sample(50 * TICK_MS);
    expect(out.map((e) => e.id).sort()).toEqual([1, 2]);
  });
});
