import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, codecs, Kind, scriptedInput } from '../src/index.js';

const { binary, json } = codecs;

function sampleSnapshot() {
  const world = new World({ seed: 3 });
  world.populate();
  const ships = [world.addShip(), world.addShip()];
  for (let i = 0; i < 120; i++) {
    ships.forEach((s, n) =>
      world.applyInput(s, { ...scriptedInput(i + n * 5), fire: i % 6 === 0 }),
    );
    world.step();
  }
  const events = [
    { type: 1, x: 10.5, y: 20.25, a: 3, b: 0 },
    { type: 4, x: 100, y: 200, a: 2, b: 50 },
  ];
  return { tick: world.tick, ack: 4_000_000_000, entities: world.records(), events };
}

const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);

test('input: decode(encode(x)) повертає те саме', () => {
  for (const turn of [-1, 0, 1]) {
    const input = { seq: 4_294_967_295, tick: 77, turn, thrust: true, fire: turn === 0 };
    assert.deepEqual(binary.decodeInput(binary.encodeInput(input)), input);
  }
});

test('input: сміття й чужа версія відхиляються', () => {
  assert.equal(binary.decodeInput(new ArrayBuffer(5)), null);
  const bad = new Uint8Array(
    binary.encodeInput({ seq: 1, tick: 1, turn: 0, thrust: false, fire: false }),
  );
  bad[1] = 9;
  assert.equal(binary.decodeInput(bad), null);
});

test('snapshot: round-trip у межах квантування (float32, кут 0.0005 рад)', () => {
  const snap = sampleSnapshot();
  assert.ok(
    snap.entities.some((e) => e.kind === Kind.BULLET),
    'у знімку є кулі',
  );

  const back = binary.decodeSnapshot(binary.encodeSnapshot(snap));
  assert.equal(back.tick, snap.tick);
  assert.equal(back.ack, snap.ack);
  assert.deepEqual(back.events, snap.events);
  assert.equal(back.entities.length, snap.entities.length);

  snap.entities.forEach((e, i) => {
    const d = back.entities[i];
    for (const key of Object.keys(e)) {
      if (['x', 'y', 'vx', 'vy'].includes(key))
        near(d[key], e[key], Math.abs(e[key]) * 1e-6 + 1e-6, key);
      else if (key === 'angle') {
        const wrapped = Math.atan2(Math.sin(e.angle), Math.cos(e.angle));
        near(d.angle, wrapped, 0.0006, 'angle');
      } else assert.equal(d[key], e[key], `${key} у сутності ${e.id}`);
    }
  });
});

test('snapshot: обрізаний або чужий кадр дає null', () => {
  const buf = binary.encodeSnapshot(sampleSnapshot());
  assert.equal(binary.decodeSnapshot(buf.slice(0, buf.byteLength - 3)), null);
  assert.equal(binary.decodeSnapshot(new ArrayBuffer(4)), null);
});

test('json-кодек повертає той самий зміст, а бінарний помітно менший', () => {
  const snap = sampleSnapshot();
  assert.deepEqual(json.decodeSnapshot(json.encodeSnapshot(snap)), snap);
  const jsonBytes = new TextEncoder().encode(json.encodeSnapshot(snap)).length;
  assert.ok(binary.encodeSnapshot(snap).byteLength * 3 < jsonBytes);
});
