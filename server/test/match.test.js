import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { codecs, Kind } from 'shared';
import { createNetSim } from '../src/netsim.js';
import { setup, makeRoom, join, input, connect } from './helpers.js';

const me = (snap, id) => snap.entities.find((e) => e.id === id);

test('після join приходить welcome і знімки 30 Гц з тіками, що ростуть', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Ann');

  assert.equal(a.welcome.tickRate, 30);
  assert.equal(a.welcome.seed, 5);
  await sleep(400);

  const snaps = a.snapshots();
  assert.ok(snaps.length >= 8, `знімків: ${snaps.length}`);
  assert.ok(snaps.every((s, i) => i === 0 || s.tick > snaps[i - 1].tick));
  assert.equal(me(snaps.at(-1), a.welcome.you).kind, Kind.SHIP);

  a.socket.close();
  await app.shutdown();
});

test('інпути рухають корабель, ack у знімку доганяє останній seq', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Ann');
  await sleep(100);
  const start = me(a.snapshots().at(-1), a.welcome.you);

  for (let seq = 1; seq <= 10; seq++) a.sendInput(input(seq, { thrust: true }));
  await sleep(600);

  const last = a.snapshots().at(-1);
  assert.equal(last.ack, 10);
  const end = me(last, a.welcome.you);
  assert.ok(Math.hypot(end.vx, end.vy) > 10, 'корабель набрав швидкість');
  assert.notEqual(end.x + end.y, start.x + start.y);

  a.socket.close();
  await app.shutdown();
});

test('флуд інпутами не прискорює корабель: сервер обробляє не більше одного інпуту на тік', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Fast');
  await sleep(100);
  const before = a.snapshots().length;

  for (let seq = 1; seq <= 90; seq++) a.sendInput(input(seq, { thrust: true }));
  await sleep(500); // ~15 тіків

  // скільки різних інпутів реально застосував сервер за ці тіки (черга лишає останні 20)
  const acks = new Set(
    a
      .snapshots()
      .slice(before)
      .map((s) => s.ack),
  );
  acks.delete(0);
  assert.ok(acks.size > 5 && acks.size <= 22, `застосовано ${acks.size} з 90`);

  a.socket.close();
  await app.shutdown();
});

test('інпут з turn = 100 закриває з’єднання кодом 4000', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Cheat');

  const bytes = new Uint8Array(codecs.binary.encodeInput(input(1)));
  bytes[11] = 100;
  a.socket.send(bytes);

  assert.equal(await a.closed, 4000);
  await app.shutdown();
});

test('json-кодек: знімки приходять текстом, JSON-інпути обробляються', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Json', { join: { codec: 'json' } });

  a.send({ type: 'input', seq: 1, tick: 0, turn: 0, thrust: true, fire: false });
  const snap = await a.next((m) => m.type === 'snapshot' && m.ack === 1);
  assert.ok(snap.entities.length > 0);
  assert.equal(a.frames.length, 0, 'бінарних кадрів нема');

  a.socket.close();
  await app.shutdown();
});

test('два гравці бачать кораблі одне одного в знімках', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Ann');
  const b = await join(port, room.id, 'Bob');
  await sleep(150);

  const ships = a
    .snapshots()
    .at(-1)
    .entities.filter((e) => e.kind === Kind.SHIP);
  assert.deepEqual(ships.map((s) => s.id).sort(), [a.welcome.you, b.welcome.you].sort());

  a.socket.close();
  b.socket.close();
  await app.shutdown();
});

test('?lag=100 додає ~100 мс до RTT, повідомлення lag міняє це на льоту', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Lag', { options: { query: '?lag=100' } });

  async function rtt() {
    const t = Date.now();
    a.send({ type: 'ping', t });
    await a.next((m) => m.type === 'pong' && m.t === t);
    return Date.now() - t;
  }

  assert.ok((await rtt()) >= 95, 'з lag=100');
  a.send({ type: 'lag', baseMs: 0, jitterMs: 0, drop: 0 });
  await sleep(100);
  assert.ok((await rtt()) < 40, 'після вимкнення');

  a.socket.close();
  await app.shutdown();
});

test('емулятор мережі: порядок зберігається попри jitter, drop губить лише ненадійне', async () => {
  const net = createNetSim();
  net.set({ baseMs: 0, jitterMs: 30, drop: 0 });
  const order = [];
  for (let i = 0; i < 20; i++) net.inbound(() => order.push(i));
  await sleep(120);
  assert.deepEqual(order, [...Array(20).keys()]);

  net.set({ baseMs: 0, jitterMs: 0, drop: 0.5 });
  let reliable = 0;
  let unreliable = 0;
  for (let i = 0; i < 400; i++) {
    net.outbound(() => reliable++);
    net.outbound(() => unreliable++, { unreliable: true });
  }
  assert.equal(reliable, 400);
  assert.ok(unreliable > 120 && unreliable < 280, `дійшло ${unreliable} з 400`);
});

test('/api/stats: тік 30 Гц тримається, перевищень нема', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);
  const a = await join(port, room.id, 'Ann');
  await sleep(700);

  const { rooms } = await (await fetch(`${base}/api/stats`)).json();
  assert.equal(rooms.length, 1);
  const [stats] = rooms;
  assert.ok(stats.tick >= 15);
  assert.ok(Math.abs(stats.intervalMs.avg - 33.33) < 3, `інтервал ${stats.intervalMs.avg}`);
  assert.ok(stats.tickMs.max < 20);
  assert.equal(stats.overruns, 0);

  a.socket.close();
  await app.shutdown();
});

test('без join інпут відхиляється: join first', async () => {
  const { app, port } = await setup();
  const c = connect(port);
  await c.opened;
  c.sendInput(input(1));
  assert.equal(await c.closed, 4000);
  await app.shutdown();
});
