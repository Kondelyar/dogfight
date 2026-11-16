import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket, type ClientOptions } from 'ws';
import { z } from 'zod';
import {
  Kind,
  codecs,
  parseServerMessage,
  seq,
  tick,
  type ControlInput,
  type EntityId,
  type EntityRecord,
  type ServerMessage,
  type ShipRecord,
  type Snapshot,
} from 'shared';
import { loadConfig, type Config } from '../src/config.ts';
import { createApp } from '../src/app.ts';

export async function setup(overrides: Partial<Config> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dogfight-'));
  const clientDist = path.join(dir, 'dist');
  await mkdir(clientDist);
  await writeFile(path.join(clientDist, 'index.html'), '<h1>hi</h1>');

  const config: Config = {
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

const RoomResponseSchema = z.object({
  room: z.object({ id: z.string(), name: z.string(), players: z.number(), max: z.number() }),
});

export async function makeRoom(base: string, name = 'test') {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', body: JSON.stringify({ name }) });
  return RoomResponseSchema.parse(await res.json()).room;
}

type MessageOfType<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

export interface ConnectOptions extends ClientOptions {
  query?: string;
}

// клієнт, що збирає текстові повідомлення, бінарні кадри і вміє чекати на потрібне
export function connect(port: number, { query = '', ...options }: ConnectOptions = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, options);
  const messages: ServerMessage[] = [];
  const frames: Buffer[] = [];
  const waiters: ((msg: ServerMessage) => void)[] = [];

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      frames.push(data);
      return;
    }
    const parsed = parseServerMessage(data.toString());
    assert.ok(
      parsed.ok,
      parsed.ok ? '' : `сервер надіслав некоректне повідомлення: ${parsed.error}`,
    );
    messages.push(parsed.value);
    waiters.slice().forEach((w) => w(parsed.value));
  });

  function next<T extends ServerMessage['type']>(
    type: T,
    where: (msg: MessageOfType<T>) => boolean = () => true,
  ): Promise<MessageOfType<T>> {
    const isWanted = (msg: ServerMessage): msg is MessageOfType<T> => msg.type === type;
    return new Promise((resolve) => {
      const found = messages.filter(isWanted).find(where);
      if (found) return resolve(found);
      const waiter = (msg: ServerMessage) => {
        if (!isWanted(msg) || !where(msg)) return;
        waiters.splice(waiters.indexOf(waiter), 1);
        resolve(msg);
      };
      waiters.push(waiter);
    });
  }

  // сирий JSON: тести навмисно шлють і некоректні повідомлення
  const send = (msg: Record<string, unknown>) => socket.send(JSON.stringify({ v: 1, ...msg }));
  const sendInput = (input: ControlInput) => socket.send(codecs.binary.encodeInput(input));
  const snapshots = (): Snapshot[] =>
    frames.flatMap((f) => {
      const decoded = codecs.binary.decodeSnapshot(f);
      return decoded.ok ? [decoded.value] : [];
    });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
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

export type TestClient = ReturnType<typeof connect>;

export async function join(
  port: number,
  roomId: string,
  name: string,
  extra: { options?: ConnectOptions; join?: Record<string, unknown> } = {},
) {
  const c = connect(port, extra.options);
  await c.opened;
  c.send({ type: 'join', room: roomId, name, ...extra.join });
  const welcome = await c.next('welcome');
  return { ...c, welcome };
}

export const input = (n: number, patch: Partial<ControlInput> = {}): ControlInput => ({
  seq: seq(n),
  tick: tick(0),
  turn: 0,
  thrust: false,
  fire: false,
  ...patch,
});

// корабель з потрібним id у знімку (з перевіркою, що це справді корабель)
export function shipIn(snapshot: Snapshot, id: EntityId): ShipRecord {
  const found: EntityRecord | undefined = snapshot.entities.find((e) => e.id === id);
  assert.ok(found && found.kind === Kind.SHIP, `корабель ${id} у знімку`);
  return found;
}
