import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  World,
  codecs,
  Kind,
  EventType,
  scriptedInput,
  seq,
  tick,
  entityId,
  type Snapshot,
  type ControlInput,
  type Turn,
} from '../src/index.ts';

const { binary, json } = codecs;

function sampleSnapshot(): Snapshot {
  const world = new World({ seed: 3 });
  world.populate();
  const ships = [world.addShip(), world.addShip()];
  for (let i = 0; i < 120; i++) {
    ships.forEach((s, n) =>
      world.applyInput(s, { ...scriptedInput(i + n * 5), fire: i % 6 === 0 }),
    );
    world.step();
  }
  return {
    tick: world.tick,
    ack: seq(4_000_000_000),
    entities: world.records(),
    events: [
      { type: EventType.FIRED, x: 10.5, y: 20.25, owner: entityId(3) },
      { type: EventType.SCORED, x: 100, y: 200, owner: entityId(2), points: 50 },
    ],
  };
}

const near = (a: number, b: number, tol: number, label: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
}

test('input: decode(encode(x)) повертає те саме', () => {
  const turns: Turn[] = [-1, 0, 1];
  for (const turn of turns) {
    const input: ControlInput = {
      seq: seq(4_294_967_295),
      tick: tick(77),
      turn,
      thrust: true,
      fire: turn === 0,
    };
    assert.deepEqual(unwrap(binary.decodeInput(binary.encodeInput(input))), input);
  }
});

test('input: сміття, чужа версія і turn поза діапазоном відхиляються', () => {
  assert.equal(binary.decodeInput(new ArrayBuffer(5)).ok, false);
  const good: ControlInput = {
    seq: seq(1),
    tick: tick(1),
    turn: 0,
    thrust: false,
    fire: false,
  };

  const wrongVersion = new Uint8Array(binary.encodeInput(good));
  wrongVersion[1] = 9;
  assert.equal(binary.decodeInput(wrongVersion).ok, false);

  const cheat = new Uint8Array(binary.encodeInput(good));
  cheat[11] = 100;
  assert.equal(binary.decodeInput(cheat).ok, false);
});

test('snapshot: round-trip у межах квантування (float32, кут 0.0005 рад)', () => {
  const snap = sampleSnapshot();
  assert.ok(
    snap.entities.some((e) => e.kind === Kind.BULLET),
    'у знімку є кулі',
  );

  const back = unwrap(binary.decodeSnapshot(binary.encodeSnapshot(snap)));
  assert.equal(back.tick, snap.tick);
  assert.equal(back.ack, snap.ack);
  assert.deepEqual(back.events, snap.events);
  assert.equal(back.entities.length, snap.entities.length);

  snap.entities.forEach((e, i) => {
    const d = back.entities[i];
    assert.ok(d, 'сутність декодована');
    for (const [key, value] of Object.entries(e)) {
      if (key === 'x' || key === 'y' || key === 'vx' || key === 'vy') {
        const actual: unknown = Reflect.get(d, key);
        assert.equal(typeof actual, 'number');
        near(Number(actual), Number(value), Math.abs(Number(value)) * 1e-6 + 1e-6, key);
      } else if (key === 'angle') {
        const wrapped = Math.atan2(Math.sin(e.angle), Math.cos(e.angle));
        near(d.angle, wrapped, 0.0006, 'angle');
      } else {
        assert.equal(Reflect.get(d, key), value, `${key} у сутності ${e.id}`);
      }
    }
  });
});

test('snapshot: обрізаний, порожній або чужий кадр дає помилку, а не виняток', () => {
  const buf = binary.encodeSnapshot(sampleSnapshot());
  assert.equal(binary.decodeSnapshot(buf.slice(0, buf.byteLength - 3)).ok, false);
  assert.equal(binary.decodeSnapshot(new ArrayBuffer(0)).ok, false);
  assert.equal(binary.decodeSnapshot(new ArrayBuffer(4)).ok, false);

  const wrongVersion = new Uint8Array(buf);
  wrongVersion[1] = 7;
  assert.equal(binary.decodeSnapshot(wrongVersion).ok, false);

  const badKind = new Uint8Array(buf);
  badKind[13 + 2] = 99; // kind першої сутності
  assert.equal(binary.decodeSnapshot(badKind).ok, false);
});

test('json-кодек повертає той самий зміст, а бінарний помітно менший', () => {
  const snap = sampleSnapshot();
  const text = json.encodeSnapshot(snap);
  assert.deepEqual(unwrap(json.decodeSnapshot(text)), snap);
  assert.equal(json.decodeSnapshot('{oops').ok, false);
  const jsonBytes = new TextEncoder().encode(text).length;
  assert.ok(binary.encodeSnapshot(snap).byteLength * 3 < jsonBytes);
});
