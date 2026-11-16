import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseCode, codecs, encodeServerMessage, entityId, seq, tick, type Snapshot } from 'shared';
import { Connection } from '../src/net/connection.ts';

// Підроблений WebSocket: тест сам вирішує, коли він відкривається, що приходить і коли закривається.
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

  closeWith(code: number): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code }));
  }
}

const last = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('сокет не створено');
  return socket;
};

describe('Connection', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('повідомлення до відкриття сокета чекають у черзі й вирушають після open', () => {
    const c = new Connection('ws://test');
    c.connect();
    c.send({ type: 'chat', text: 'hi' });
    expect(last().sent).toHaveLength(0);
    last().open();
    expect(last().sent).toHaveLength(1);
    expect(String(last().sent[0])).toContain('"type":"chat"');
  });

  it('open віддається слухачам, а join з обробника йде без черги', () => {
    const c = new Connection('ws://test');
    c.on('open', () => c.send({ type: 'ping', t: 1 }));
    c.connect();
    last().open();
    expect(last().sent).toHaveLength(1);
  });

  it('текстові повідомлення перевіряються схемою й розсилаються за типом', () => {
    const c = new Connection('ws://test');
    const welcome = vi.fn();
    const roster = vi.fn();
    c.on('welcome', welcome);
    c.on('roster', roster);
    c.connect();
    last().open();
    last().receive(
      encodeServerMessage({
        type: 'welcome',
        you: entityId(3),
        seed: 7,
        tick: tick(1),
        tickRate: 30,
      }),
    );
    last().receive(encodeServerMessage({ type: 'roster', players: ['A'] }));
    expect(welcome).toHaveBeenCalledWith(expect.objectContaining({ you: 3, seed: 7 }));
    expect(roster).toHaveBeenCalledWith(expect.objectContaining({ players: ['A'] }));
  });

  it('зіпсоване повідомлення ігнорується з попередженням, нічого не ламається', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new Connection('ws://test');
    const any = vi.fn();
    c.on('welcome', any);
    c.connect();
    last().open();
    last().receive('{oops');
    last().receive(JSON.stringify({ v: 1, type: 'welcome' }));
    last().receive(JSON.stringify({ v: 1, type: 'teleport' }));
    expect(any).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('бінарний знімок декодується, битий бінарний кадр ігнорується', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new Connection('ws://test');
    const onSnapshot = vi.fn();
    c.on('snapshot', onSnapshot);
    c.connect();
    last().open();
    const snap: Snapshot = { tick: tick(5), ack: seq(2), entities: [], events: [] };
    last().receive(codecs.binary.encodeSnapshot(snap));
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tick: 5, ack: 2 }));
    last().receive(new ArrayBuffer(4));
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(c.bytesIn).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it('після звичайного розриву перепідключається з нарощуваною затримкою', () => {
    const c = new Connection('ws://test');
    c.connect();
    last().open();
    last().closeWith(1006);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('після фінального коду (кімната повна) не перепідключається', () => {
    const c = new Connection('ws://test');
    const closed = vi.fn();
    c.on('close', closed);
    c.connect();
    last().open();
    last().closeWith(CloseCode.ROOM_FULL);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(closed).toHaveBeenCalledWith({ code: CloseCode.ROOM_FULL });
  });

  it('close() зупиняє перепідключення', () => {
    const c = new Connection('ws://test');
    c.connect();
    last().open();
    c.close();
    last().closeWith(1006);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('інпути не стоять у черзі: якщо сокет закритий, вони просто губляться', () => {
    const c = new Connection('ws://test');
    c.connect();
    c.sendInput({ seq: seq(1), tick: tick(0), turn: 0, thrust: false, fire: false }, 'binary');
    last().open();
    expect(last().sent).toHaveLength(0);
    c.sendInput({ seq: seq(2), tick: tick(0), turn: 1, thrust: true, fire: false }, 'binary');
    expect(last().sent).toHaveLength(1);
    expect(last().sent[0]).toBeInstanceOf(ArrayBuffer);
    expect(c.bytesOut).toBe(12);
  });

  it('черга керівних повідомлень обмежена 50', () => {
    const c = new Connection('ws://test');
    c.connect();
    for (let i = 0; i < 80; i++) c.send({ type: 'ping', t: i });
    last().open();
    expect(last().sent).toHaveLength(50);
  });
});
