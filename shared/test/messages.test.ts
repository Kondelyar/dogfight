import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseClientMessage,
  parseServerMessage,
  encodeServerMessage,
  entityId,
  tick,
} from '../src/index.ts';

const join = { v: 1, type: 'join', room: 'abc123', name: '  Ace ' };

test('join: валідне повідомлення нормалізується, codec за замовчуванням binary', () => {
  const result = parseClientMessage(join);
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    v: 1,
    type: 'join',
    room: 'abc123',
    name: 'Ace',
    codec: 'binary',
  });

  const json = parseClientMessage({ ...join, codec: 'json' });
  assert.ok(json.ok && json.value.type === 'join' && json.value.codec === 'json');
});

test('приймає і текст, і вже розібраний об’єкт, битий JSON не кидає виняток', () => {
  assert.equal(parseClientMessage(JSON.stringify(join)).ok, true);
  const broken = parseClientMessage('{oops');
  assert.ok(!broken.ok);
  assert.equal(broken.error, 'invalid json');
  assert.equal(parseClientMessage(undefined).ok, false);
});

test('відхиляє не-об’єкти, чужу версію і невідомий тип', () => {
  assert.equal(parseClientMessage(null).ok, false);
  assert.equal(parseClientMessage([]).ok, false);
  assert.equal(parseClientMessage({ ...join, v: 2 }).ok, false);
  assert.equal(parseClientMessage({ v: 1, type: 'teleport' }).ok, false);
});

test('відхиляє погану форму полів', () => {
  assert.equal(parseClientMessage({ ...join, room: '../etc' }).ok, false);
  assert.equal(parseClientMessage({ ...join, name: '' }).ok, false);
  assert.equal(parseClientMessage({ ...join, name: 'x'.repeat(17) }).ok, false);
  assert.equal(parseClientMessage({ ...join, codec: 'xml' }).ok, false);
  assert.equal(parseClientMessage({ v: 1, type: 'chat', text: 42 }).ok, false);
  assert.equal(parseClientMessage({ v: 1, type: 'chat', text: 'x'.repeat(201) }).ok, false);
});

test('input: turn 1000 це чит, а не керування', () => {
  const ok = { v: 1, type: 'input', seq: 1, tick: 0, turn: 1, thrust: true, fire: false };
  assert.equal(parseClientMessage(ok).ok, true);
  assert.equal(parseClientMessage({ ...ok, turn: 1000 }).ok, false);
  assert.equal(parseClientMessage({ ...ok, seq: -1 }).ok, false);
  assert.equal(parseClientMessage({ ...ok, fire: 'yes' }).ok, false);
});

test('ping і lag: межі значень', () => {
  assert.equal(parseClientMessage({ v: 1, type: 'ping', t: 123 }).ok, true);
  assert.equal(parseClientMessage({ v: 1, type: 'ping', t: 'x' }).ok, false);
  assert.equal(
    parseClientMessage({ v: 1, type: 'lag', baseMs: 100, jitterMs: 30, drop: 0.02 }).ok,
    true,
  );
  assert.equal(
    parseClientMessage({ v: 1, type: 'lag', baseMs: 99999, jitterMs: 0, drop: 0 }).ok,
    false,
  );
  assert.equal(
    parseClientMessage({ v: 1, type: 'lag', baseMs: 0, jitterMs: 0, drop: 0.9 }).ok,
    false,
  );
});

test('повідомлення сервера: encode -> parse, версія додається автоматично', () => {
  const text = encodeServerMessage({
    type: 'welcome',
    you: entityId(4),
    seed: 9,
    tick: tick(0),
    tickRate: 30,
  });
  const back = parseServerMessage(text);
  assert.ok(back.ok && back.value.type === 'welcome' && back.value.you === 4);
  assert.equal(parseServerMessage(JSON.stringify({ v: 1, type: 'welcome' })).ok, false);
});
