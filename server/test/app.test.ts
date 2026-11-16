import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { replay } from '../src/log/replay.ts';
import { setup, makeRoom, connect } from './helpers.ts';

test('два клієнти заходять в одну кімнату, бачать roster і чат одне одного', async () => {
  const { app, port, base } = await setup();
  const room = await makeRoom(base);

  const a = connect(port);
  await a.opened;
  a.send({ type: 'join', room: room.id, name: 'Ann' });
  await a.next('roster');

  const b = connect(port);
  await b.opened;
  b.send({ type: 'join', room: room.id, name: 'Bob' });

  const roster = await a.next('roster', (m) => m.players.length === 2);
  assert.deepEqual(roster.players, ['Ann', 'Bob']);

  b.send({ type: 'chat', text: 'привіт' });
  const chat = await a.next('chat');
  assert.deepEqual([chat.from, chat.text], ['Bob', 'привіт']);

  a.socket.close();
  b.socket.close();
  await app.shutdown();
});

test('невідомий тип повідомлення закриває з’єднання кодом 4000', async () => {
  const { app, port } = await setup();
  const c = connect(port);
  await c.opened;
  c.send({ type: 'teleport' });
  assert.equal(await c.closed, 4000);
  await app.shutdown();
});

test('битий JSON не валить процес: сокет закривається кодом 4000', async () => {
  const { app, port } = await setup();
  const c = connect(port);
  await c.opened;
  c.socket.send('{oops');
  assert.equal(await c.closed, 4000);
  await app.shutdown();
});

test('без join за таймаут з’єднання закривається кодом 4001', async () => {
  const { app, port } = await setup({ joinTimeoutMs: 100 });
  const c = connect(port);
  assert.equal(await c.closed, 4001);
  await app.shutdown();
});

test('завеликий payload: сервер закриває з кодом 1009', async () => {
  const { app, port } = await setup({ maxPayload: 1024 });
  const c = connect(port);
  await c.opened;
  c.socket.send('x'.repeat(2048));
  assert.equal(await c.closed, 1009);
  await app.shutdown();
});

test('rate limit: надто часті повідомлення закривають з’єднання кодом 4003', async () => {
  const { app, port, base } = await setup({ ratePerSec: 1, rateBurst: 3 });
  const room = await makeRoom(base);
  const c = connect(port);
  await c.opened;
  c.send({ type: 'join', room: room.id, name: 'Spam' });
  for (let i = 0; i < 6; i++) c.send({ type: 'chat', text: `m${i}` });
  assert.equal(await c.closed, 4003);
  await app.shutdown();
});

test('мертвий клієнт без pong відключається heartbeat-ом', async () => {
  const { app, port, base } = await setup({ heartbeatMs: 50 });
  const room = await makeRoom(base);
  const c = connect(port, { autoPong: false });
  await c.opened;
  c.send({ type: 'join', room: room.id, name: 'Zombie' });
  assert.equal(await c.closed, 1006);
  await app.shutdown();
});

test('лог матчу: події пишуться в NDJSON, replay віддає файл стрімом', async () => {
  const { app, port, base, config } = await setup();
  const room = await makeRoom(base);

  const c = connect(port);
  await c.opened;
  c.send({ type: 'join', room: room.id, name: 'Logger' });
  await c.next('roster');
  c.send({ type: 'chat', text: 'для логу' });
  await c.next('chat');
  c.socket.close();
  await c.closed;
  await sleep(100); // кімната спорожніла -> видалилась -> лог дописався

  const [file] = await readdir(config.logDir);
  assert.ok(file);
  const lines = (await readFile(path.join(config.logDir, file), 'utf8')).trim().split('\n');
  const types = lines.map((l) => z.object({ type: z.string() }).parse(JSON.parse(l)).type);
  assert.deepEqual(types, ['created', 'join', 'chat', 'leave']);

  const replayed: string[] = [];
  for await (const event of replay(path.join(config.logDir, file))) replayed.push(event.type);
  assert.deepEqual(replayed, ['created', 'join', 'chat', 'leave']);

  const id = file.replace('.ndjson', '');
  const res = await fetch(`${base}/api/replays/${id}`);
  assert.equal(res.headers.get('content-type'), 'application/x-ndjson');
  assert.equal((await res.text()).trim().split('\n').length, 4);

  assert.equal((await fetch(`${base}/api/replays/nope`)).status, 404);
  await app.shutdown();
});

test('POST /api/rooms: валідація і ліміт кімнат', async () => {
  const { app, base } = await setup({ maxRooms: 1 });
  const post = (body: string) => fetch(`${base}/api/rooms`, { method: 'POST', body });

  assert.equal((await post('{oops')).status, 400);
  assert.equal((await post(JSON.stringify({ name: '' }))).status, 400);
  assert.equal((await post(JSON.stringify({ name: 42 }))).status, 400);
  assert.equal((await post(JSON.stringify({ name: 'x'.repeat(2000) }))).status, 413);
  assert.equal((await post(JSON.stringify({ name: 'one' }))).status, 201);
  assert.equal((await post(JSON.stringify({ name: 'two' }))).status, 429);

  const { rooms } = z
    .object({ rooms: z.array(z.unknown()) })
    .parse(await (await fetch(`${base}/api/rooms`)).json());
  assert.equal(rooms.length, 1);
  await app.shutdown();
});

test('статика: віддає index.html і не пускає за межі dist (../)', async () => {
  const { app, port, base, dir } = await setup();
  await writeFile(path.join(dir, 'secret.txt'), 'TOP SECRET');

  const ok = await fetch(`${base}/`);
  assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await ok.text(), '<h1>hi</h1>');

  const raw = (url: string) =>
    new Promise<{ status: number | undefined; body: string }>((resolve) => {
      http.get({ host: '127.0.0.1', port, path: url }, (res) => {
        let body = '';
        res.on('data', (d: Buffer) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
    });

  for (const attack of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
    const { status, body } = await raw(attack);
    assert.notEqual(status, 200, attack);
    assert.ok(!body.includes('TOP SECRET'), attack);
  }
  await app.shutdown();
});

test('/health відповідає', async () => {
  const { app, base } = await setup();
  const body = z.object({ status: z.string() }).parse(await (await fetch(`${base}/health`)).json());
  assert.equal(body.status, 'ok');
  await app.shutdown();
});
