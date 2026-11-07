import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { codecs } from 'shared';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

export async function setup(overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dogfight-'));
  const clientDist = path.join(dir, 'dist');
  await mkdir(clientDist);
  await writeFile(path.join(clientDist, 'index.html'), '<h1>hi</h1>');

  const config = {
    ...loadConfig({}),
    port: 0,
    host: '127.0.0.1',
    logDir: path.join(dir, 'logs'),
    clientDist,
    seed: 5,
    ...overrides,
  };
  const app = createApp(config);
  const port = await app.start();
  return { app, port, dir, config, base: `http://127.0.0.1:${port}` };
}

export async function makeRoom(base, name = 'test') {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', body: JSON.stringify({ name }) });
  return (await res.json()).room;
}

// клієнт, що збирає текстові повідомлення, бінарні кадри і вміє чекати на потрібне
export function connect(port, { query = '', ...options } = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, options);
  const messages = [];
  const frames = [];
  const waiters = [];

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      frames.push(data);
      return;
    }
    const msg = JSON.parse(data.toString());
    messages.push(msg);
    waiters.slice().forEach((w) => w(msg));
  });

  const next = (predicate) =>
    new Promise((resolve) => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      const waiter = (msg) => {
        if (!predicate(msg)) return;
        waiters.splice(waiters.indexOf(waiter), 1);
        resolve(msg);
      };
      waiters.push(waiter);
    });

  const send = (msg) => socket.send(JSON.stringify({ v: 1, ...msg }));
  const sendInput = (input) => socket.send(codecs.binary.encodeInput(input));
  const snapshots = () => frames.map((f) => codecs.binary.decodeSnapshot(f)).filter(Boolean);
  const closed = new Promise((resolve) => socket.on('close', (code) => resolve(code)));
  socket.on('error', () => {});

  return {
    socket,
    messages,
    frames,
    next,
    send,
    sendInput,
    snapshots,
    closed,
    opened: once(socket, 'open'),
  };
}

export async function join(port, roomId, name, extra = {}) {
  const c = connect(port, extra.options);
  await c.opened;
  c.send({ type: 'join', room: roomId, name, ...extra.join });
  const welcome = await c.next((m) => m.type === 'welcome');
  return { ...c, welcome };
}

export const input = (seq, patch = {}) => ({
  seq,
  tick: 0,
  turn: 0,
  thrust: false,
  fire: false,
  ...patch,
});
