import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, parse, encode } from '../src/protocol.js';

const join = { v: 1, type: 'join', room: 'abc123', name: '  Ace ' };

test('join: валідне повідомлення нормалізується', () => {
  const result = validate(join);
  assert.equal(result.ok, true);
  assert.deepEqual(result.msg, { type: 'join', room: 'abc123', name: 'Ace' });
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
  assert.equal(validate({ v: 1, type: 'chat', text: 42 }).ok, false);
  assert.equal(validate({ v: 1, type: 'chat', text: 'x'.repeat(201) }).ok, false);
});

test('parse повертає null на битому JSON, encode додає версію', () => {
  assert.equal(parse('{oops'), null);
  assert.deepEqual(JSON.parse(encode('roster', { players: ['a'] })), {
    v: 1,
    type: 'roster',
    players: ['a'],
  });
});
