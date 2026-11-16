import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ARENA,
  STEP,
  Ship,
  Vector2,
  World,
  entityId,
  parseClientMessage,
  seq,
  tick,
  wrapDelta,
  wrapPosition,
  type ControlInput,
  type Turn,
} from '../src/index.ts';

const turn: fc.Arbitrary<Turn> = fc.constantFrom<Turn[]>(-1, 0, 1);
const control = fc.record({ turn, thrust: fc.boolean(), fire: fc.boolean() });

const toInput = (c: { turn: Turn; thrust: boolean; fire: boolean }, i: number): ControlInput => ({
  seq: seq(i + 1),
  tick: tick(0),
  ...c,
});

describe('симуляція (fast-check)', () => {
  it('корабель лишається в арені за будь-якої послідовності інпутів', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: ARENA.width - 1, noNaN: true }),
        fc.double({ min: 0, max: ARENA.height - 1, noNaN: true }),
        fc.array(control, { minLength: 1, maxLength: 300 }),
        (x, y, controls) => {
          const ship = new Ship(x, y);
          ship.id = entityId(1);
          controls.forEach((c, i) => {
            ship.applyInput(toInput(c, i), STEP);
            expect(ship.pos.x).toBeGreaterThanOrEqual(0);
            expect(ship.pos.x).toBeLessThan(ARENA.width);
            expect(ship.pos.y).toBeGreaterThanOrEqual(0);
            expect(ship.pos.y).toBeLessThan(ARENA.height);
            expect(ship.vel.length()).toBeLessThanOrEqual(420 + 1e-9);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('wrapPosition завжди повертає точку всередині арени', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        (x, y) => {
          const p = wrapPosition(new Vector2(x, y));
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThan(ARENA.width);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThan(ARENA.height);
        },
      ),
    );
  });

  it('wrapDelta ніколи не більший за пів арени', () => {
    fc.assert(
      fc.property(fc.double({ min: -ARENA.width, max: ARENA.width, noNaN: true }), (d) => {
        expect(Math.abs(wrapDelta(d, ARENA.width))).toBeLessThanOrEqual(ARENA.width / 2 + 1e-9);
      }),
    );
  });

  it('світ детермінований: той самий seed і інпути дають той самий результат', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.array(control, { minLength: 1, maxLength: 80 }),
        (seed, controls) => {
          const run = (): string => {
            const world = new World({ seed });
            world.populate();
            const ship = world.addShip();
            controls.forEach((c, i) => {
              world.applyInput(ship, toInput(c, i));
              world.step();
            });
            return JSON.stringify(world.records());
          };
          expect(run()).toBe(run());
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('розбір повідомлень (fast-check)', () => {
  const validInput = fc.record({
    v: fc.constant(1),
    type: fc.constant('input'),
    seq: fc.integer({ min: 0, max: 4_294_967_295 }),
    tick: fc.integer({ min: 0, max: 4_294_967_295 }),
    turn,
    thrust: fc.boolean(),
    fire: fc.boolean(),
  });

  it('приймає правильне повідомлення', () => {
    fc.assert(
      fc.property(validInput, (msg) => {
        expect(parseClientMessage(msg).ok).toBe(true);
      }),
    );
  });

  it('відхиляє зіпсоване: turn поза діапазоном, від’ємний seq, не-булеві прапорці', () => {
    const corrupted = fc.oneof(
      fc.tuple(validInput, fc.integer({ min: 2, max: 1000 })).map(([m, t]) => ({ ...m, turn: t })),
      fc.tuple(validInput, fc.integer({ min: -1000, max: -1 })).map(([m, s]) => ({ ...m, seq: s })),
      fc.tuple(validInput, fc.string()).map(([m, f]) => ({ ...m, fire: f })),
      fc.tuple(validInput, fc.integer({ min: 2, max: 9 })).map(([m, v]) => ({ ...m, v })),
    );
    fc.assert(
      fc.property(corrupted, (msg) => {
        expect(parseClientMessage(msg).ok).toBe(false);
      }),
    );
  });

  it('довільний текст ніколи не кидає виняток', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => parseClientMessage(text)).not.toThrow();
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseClientMessage(value)).not.toThrow();
      }),
    );
  });
});
