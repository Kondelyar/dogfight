import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, parse, encode } from '../src/protocol.js';

const join = { v: 1, type: 'join', room: 'abc123', name: '  Ace ' };

test('join: валідне повідомлення нормалізується, codec за замовчуванням binary', () => {
  const result = validate(join);
  assert.equal(result.ok, true);
  assert.deepEqual(result.msg, { type: 'join', room: 'abc123', name: 'Ace', codec: 'binary' });
  assert.equal(validate({ ...join, codec: 'json' }).msg.codec, 'json');
});

test('відхиляє не-об’єкти, чужу версію і невідомий тип', () => {
  assert.equal(validate(null).ok, false);
  assert.equal(validate([]).ok, false);
  assert.equal(validate({ ...join, v: 2 }).ok, false);
  assert.equal(validate({ v: 1, type: 'teleport' }).ok, false);
});

test('відхиляє погану форму полів', () => {
  assert.equal(validate({ ...join, room: '../etc' }).ok, false);
  assert.equal(validate({ ...join, name: '' }).ok, false);
  assert.equal(validate({ ...join, name: 'x'.repeat(17) }).ok, false);
  assert.equal(validate({ ...join, codec: 'xml' }).ok, false);
  assert.equal(validate({ v: 1, type: 'chat', text: 42 }).ok, false);
  assert.equal(validate({ v: 1, type: 'chat', text: 'x'.repeat(201) }).ok, false);
});

test('input: turn 1000 це чит, а не керування', () => {
  const ok = { v: 1, type: 'input', seq: 1, tick: 0, turn: 1, thrust: true, fire: false };
  assert.equal(validate(ok).ok, true);
  assert.equal(validate({ ...ok, turn: 1000 }).ok, false);
  assert.equal(validate({ ...ok, seq: -1 }).ok, false);
  assert.equal(validate({ ...ok, fire: 'yes' }).ok, false);
});

test('ping і lag: межі значень', () => {
  assert.equal(validate({ v: 1, type: 'ping', t: 123 }).ok, true);
  assert.equal(validate({ v: 1, type: 'ping', t: 'x' }).ok, false);
  assert.equal(validate({ v: 1, type: 'lag', baseMs: 100, jitterMs: 30, drop: 0.02 }).ok, true);
  assert.equal(validate({ v: 1, type: 'lag', baseMs: 99999, jitterMs: 0, drop: 0 }).ok, false);
  assert.equal(validate({ v: 1, type: 'lag', baseMs: 0, jitterMs: 0, drop: 0.9 }).ok, false);
});

test('parse повертає null на битому JSON, encode додає версію', () => {
  assert.equal(parse('{oops'), null);
  assert.deepEqual(JSON.parse(encode('roster', { players: ['a'] })), {
    v: 1,
    type: 'roster',
    players: ['a'],
  });
});
