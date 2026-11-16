import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EventType,
  Kind,
  codecs,
  entityId,
  seq,
  seq16,
  tick,
  type ControlInput,
  type EntityRecord,
  type Snapshot,
  type SnapshotEvent,
  type Turn,
} from '../src/index.ts';

const { binary } = codecs;

// ---------- Генератори даних ----------

const u8 = fc.integer({ min: 0, max: 255 });
const u16 = fc.integer({ min: 0, max: 65535 });
const u32 = fc.integer({ min: 0, max: 4_294_967_295 });
const f32 = fc.float({ noNaN: true, noDefaultInfinity: true, min: -5000, max: 5000 }); // вже float32
const angle = fc.double({ noNaN: true, min: -Math.PI, max: Math.PI });
const turn: fc.Arbitrary<Turn> = fc.constantFrom<Turn[]>(-1, 0, 1);
const id = u16.map(entityId);

const base = fc.record({ id, x: f32, y: f32, vx: f32, vy: f32, angle });

const ship: fc.Arbitrary<EntityRecord> = fc
  .tuple(base, fc.boolean(), fc.boolean(), u16, u16, u8, u8)
  .map(([b, alive, thrusting, hp, score, cooldown, rapid]) => ({
    ...b,
    kind: Kind.SHIP,
    alive,
    thrusting,
    hp,
    score,
    cooldown,
    rapid,
  }));
const bullet: fc.Arbitrary<EntityRecord> = fc
  .tuple(base, id, u16)
  .map(([b, owner, s]) => ({ ...b, kind: Kind.BULLET, owner, seq: seq16(s) }));
const asteroid: fc.Arbitrary<EntityRecord> = fc
  .tuple(base, u16, fc.boolean())
  .map(([b, radius, homing]) => ({ ...b, kind: Kind.ASTEROID, radius, homing }));
const pickup: fc.Arbitrary<EntityRecord> = fc
  .tuple(base, fc.constantFrom<(1 | 2)[]>(1, 2))
  .map(([b, effect]) => ({ ...b, kind: Kind.PICKUP, effect }));

const anyEntity = fc.oneof(ship, bullet, asteroid, pickup);

const event: fc.Arbitrary<SnapshotEvent> = fc.oneof(
  fc.tuple(f32, f32, id).map(([x, y, owner]) => ({ type: EventType.FIRED, x, y, owner })),
  fc.tuple(f32, f32).map(([x, y]) => ({ type: EventType.HIT, x, y })),
  fc
    .tuple(f32, f32, fc.constantFrom<('ship' | 'asteroid')[]>('ship', 'asteroid'))
    .map(([x, y, what]) => ({ type: EventType.EXPLODED, x, y, what })),
  fc
    .tuple(f32, f32, id, u16)
    .map(([x, y, owner, points]) => ({ type: EventType.SCORED, x, y, owner, points })),
);

const snapshot: fc.Arbitrary<Snapshot> = fc
  .tuple(u32, u32, fc.array(anyEntity, { maxLength: 40 }), fc.array(event, { maxLength: 12 }))
  .map(([t, ack, entities, events]) => ({ tick: tick(t), ack: seq(ack), entities, events }));

const controlInput: fc.Arbitrary<ControlInput> = fc
  .tuple(u32, u32, turn, fc.boolean(), fc.boolean())
  .map(([s, t, tr, thrust, fire]) => ({ seq: seq(s), tick: tick(t), turn: tr, thrust, fire }));

// ---------- Властивості ----------

describe('бінарний кодек (fast-check)', () => {
  it('після декодування виходить те саме повідомлення (з округленням кута)', () => {
    fc.assert(
      fc.property(snapshot, (snap) => {
        const decoded = binary.decodeSnapshot(binary.encodeSnapshot(snap));
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) return;
        expect(decoded.value.tick).toBe(snap.tick);
        expect(decoded.value.ack).toBe(snap.ack);
        expect(decoded.value.events).toEqual(snap.events);
        expect(decoded.value.entities).toHaveLength(snap.entities.length);
        snap.entities.forEach((e, i) => {
          const d = decoded.value.entities[i];
          expect(d).toBeDefined();
          if (!d) return;
          expect(Math.abs(d.angle - e.angle)).toBeLessThanOrEqual(0.0005 + 1e-12);
          // усі інші поля збігаються точно: числа вже представлені у float32
          expect({ ...d, angle: 0 }).toEqual({ ...e, angle: 0 });
        });
      }),
      { numRuns: 200 },
    );
  });

  it('довжина кадру збігається з описом формату: 13 + 28·сутностей + 13·подій', () => {
    fc.assert(
      fc.property(snapshot, (snap) => {
        const frame = binary.encodeSnapshot(snap);
        expect(frame.byteLength).toBe(13 + 28 * snap.entities.length + 13 * snap.events.length);
      }),
    );
  });

  it('інпут завжди 12 байт, і round-trip повертає той самий інпут', () => {
    fc.assert(
      fc.property(controlInput, (input) => {
        const frame = binary.encodeInput(input);
        expect(frame.byteLength).toBe(12);
        const decoded = binary.decodeInput(frame);
        expect(decoded).toEqual({ ok: true, value: input });
      }),
    );
  });

  it('довільний битий буфер дає помилку або знімок, але ніколи не падіння', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), (bytes) => {
        expect(() => binary.decodeSnapshot(bytes)).not.toThrow();
        expect(() => binary.decodeInput(bytes)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it('зіпсований справжній кадр: або відхилений, або коректно розібраний', () => {
    fc.assert(
      fc.property(
        snapshot,
        fc.array(fc.tuple(fc.nat(2000), u8), { minLength: 1, maxLength: 6 }),
        (snap, edits) => {
          const bytes = new Uint8Array(binary.encodeSnapshot(snap));
          for (const [at, value] of edits) bytes[at % bytes.length] = value;
          const result = binary.decodeSnapshot(bytes);
          // якщо декодер здався - причина названа; якщо пропустив - довжини узгоджені
          if (result.ok) expect(result.value.entities.length).toBeLessThanOrEqual(65535);
          else expect(result.error.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('обрізаний на будь-якому місці кадр завжди відхиляється', () => {
    fc.assert(
      fc.property(snapshot, fc.nat(), (snap, cut) => {
        const frame = binary.encodeSnapshot(snap);
        const end = cut % frame.byteLength; // строго менше за повну довжину
        expect(binary.decodeSnapshot(frame.slice(0, end)).ok).toBe(false);
      }),
    );
  });
});
