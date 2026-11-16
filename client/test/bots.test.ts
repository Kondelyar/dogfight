import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Kind,
  codecs,
  encodeServerMessage,
  entityId,
  parseClientMessage,
  seq,
  tick,
  type Snapshot,
} from 'shared';
import { BotRunner } from '../src/bots/botRunner.ts';
import { startBots } from '../src/bots/launch.ts';
import { FromWorkerSchema, ToWorkerSchema } from '../src/bots/messages.ts';

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  sent: (string | ArrayBuffer)[] = [];

  constructor(readonly url: string) {
    super();
    FakeSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  receive(data: string | ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const snapshot = (): Snapshot => ({
  tick: tick(3),
  ack: seq(0),
  entities: [
    {
      id: entityId(1),
      kind: Kind.SHIP,
      x: 100,
      y: 100,
      vx: 0,
      vy: 0,
      angle: 0,
      alive: true,
      thrusting: false,
      hp: 100,
      score: 0,
      cooldown: 0,
      rapid: 0,
    },
    {
      id: entityId(9),
      kind: Kind.ASTEROID,
      x: 300,
      y: 100,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 20,
      homing: false,
    },
  ],
  events: [],
});

describe('BotRunner', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('кожен бот відкриває свій сокет і шле join із власним іменем', () => {
    const runner = new BotRunner({ wsUrl: 'ws://t/ws', roomId: 'r1', count: 3, seed: 1 });
    runner.start();
    FakeSocket.instances.forEach((s) => s.open());
    expect(FakeSocket.instances).toHaveLength(3);
    const names = FakeSocket.instances.map((s) => {
      const parsed = parseClientMessage(String(s.sent[0]));
      return parsed.ok && parsed.value.type === 'join' ? parsed.value.name : null;
    });
    expect(names).toEqual(['bot1', 'bot2', 'bot3']);
    runner.stop();
  });

  it('після welcome і знімка бот шле 12-байтові бінарні інпути раз на тік', () => {
    const runner = new BotRunner({ wsUrl: 'ws://t/ws', roomId: 'r1', count: 1, seed: 1 });
    runner.start();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('сокет не створено');
    socket.open();
    socket.receive(
      encodeServerMessage({
        type: 'welcome',
        you: entityId(1),
        seed: 1,
        tick: tick(0),
        tickRate: 30,
      }),
    );
    socket.receive(codecs.binary.encodeSnapshot(snapshot()));
    expect(runner.snapshots).toBe(1);

    vi.advanceTimersByTime(34 * 5);
    const inputs = socket.sent.slice(1); // перший елемент - join
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    for (const frame of inputs) {
      if (!(frame instanceof ArrayBuffer)) throw new Error('очікували бінарний кадр');
      const decoded = codecs.binary.decodeInput(frame);
      expect(decoded.ok).toBe(true);
    }
    runner.stop();
  });

  it('до першого знімка бот мовчить, битий кадр не ламає', () => {
    const runner = new BotRunner({ wsUrl: 'ws://t/ws', roomId: 'r1', count: 1, seed: 1 });
    runner.start();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('сокет не створено');
    socket.open();
    socket.receive(new ArrayBuffer(3));
    vi.advanceTimersByTime(200);
    expect(socket.sent).toHaveLength(1); // лише join
    expect(runner.snapshots).toBe(0);
    runner.stop();
  });

  it('connected рахує відкриті сокети, stop закриває всі', () => {
    const runner = new BotRunner({ wsUrl: 'ws://t/ws', roomId: 'r1', count: 2, seed: 1 });
    runner.start();
    expect(runner.connected).toBe(0);
    FakeSocket.instances.forEach((s) => s.open());
    expect(runner.connected).toBe(2);
    runner.stop();
    expect(FakeSocket.instances.every((s) => s.readyState === 3)).toBe(true);
  });

  it('режим main запускає ботів на місці й дає змогу їх зупинити', () => {
    const handle = startBots('main', { wsUrl: 'ws://t/ws', roomId: 'r', count: 2, seed: 1 });
    expect(handle.mode).toBe('main');
    expect(FakeSocket.instances).toHaveLength(2);
    handle.stop();
    expect(FakeSocket.instances.every((s) => s.readyState === 3)).toBe(true);
  });
});

describe('повідомлення воркера', () => {
  it('start перевіряється схемою: кількість у межах, поля обов’язкові', () => {
    const ok = { type: 'start', wsUrl: 'ws://x', roomId: 'r', count: 8, seed: 1 };
    expect(ToWorkerSchema.safeParse(ok).success).toBe(true);
    expect(ToWorkerSchema.safeParse({ ...ok, count: 0 }).success).toBe(false);
    expect(ToWorkerSchema.safeParse({ ...ok, count: 1000 }).success).toBe(false);
    expect(ToWorkerSchema.safeParse({ type: 'start' }).success).toBe(false);
    expect(ToWorkerSchema.safeParse({ type: 'stop' }).success).toBe(true);
    expect(ToWorkerSchema.safeParse('hello').success).toBe(false);
  });

  it('відповіді воркера теж перевіряються', () => {
    expect(FromWorkerSchema.safeParse({ type: 'ready' }).success).toBe(true);
    expect(FromWorkerSchema.safeParse({ type: 'stats', snapshots: 5, connected: 2 }).success).toBe(
      true,
    );
    expect(FromWorkerSchema.safeParse({ type: 'stats' }).success).toBe(false);
  });
});
