import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Emitter,
  EventType,
  Kind,
  Ship,
  entityId,
  releaseBullet,
  seq,
  tick,
  type EntityRecord,
  type ShipRecord,
  type Snapshot,
  type SnapshotEvent,
  type WorldEvents,
} from 'shared';
import { Connection } from '../src/net/connection.ts';
import { NetStats } from '../src/net/netstats.ts';
import { Session, type Controls } from '../src/net/session.ts';

const ME = entityId(1);
const OTHER = entityId(2);

function shipRec(id: number, x: number, y: number, patch: Partial<ShipRecord> = {}): ShipRecord {
  return {
    id: entityId(id),
    kind: Kind.SHIP,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    alive: true,
    thrusting: false,
    hp: 100,
    score: 0,
    cooldown: 0,
    rapid: 0,
    ...patch,
  };
}

const snap = (
  t: number,
  entities: EntityRecord[],
  events: SnapshotEvent[] = [],
  ack = 0,
): Snapshot => ({ tick: tick(t), ack: seq(ack), entities, events });

function setup(predict = true) {
  const connection = new Connection('ws://unused');
  const bus = new Emitter<WorldEvents>();
  const stats = new NetStats(connection);
  const session = new Session({ connection, bus, codec: 'binary', stats, predict });
  const sent = vi.spyOn(connection, 'sendInput').mockImplementation(() => {});
  const welcome = () =>
    connection.emit('welcome', {
      v: 1,
      type: 'welcome',
      you: ME,
      seed: 9,
      tick: tick(0),
      tickRate: 30,
    });
  const deliver = (s: Snapshot) => connection.emit('snapshot', s);
  return { connection, bus, stats, session, sent, welcome, deliver };
}

const controls: Controls = { turn: 0, thrust: true, fire: false };

describe('Session', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('welcome запам’ятовує id і seed і скидає стан', () => {
    const { session, welcome } = setup();
    welcome();
    expect(session.you).toBe(ME);
    expect(session.seed).toBe(9);
    expect(session.prediction).toBeNull();
  });

  it('знімки до welcome ігноруються', () => {
    const { session, deliver } = setup();
    deliver(snap(1, [shipRec(1, 100, 100)]));
    expect(session.prediction).toBeNull();
  });

  it('перший знімок зі своїм кораблем створює передбачення', () => {
    const { session, welcome, deliver } = setup();
    welcome();
    deliver(snap(1, [shipRec(1, 100, 100)]));
    expect(session.prediction?.ship.pos.x).toBe(100);
  });

  it('старий або повторений знімок ігнорується', () => {
    const { session, welcome, deliver, stats } = setup();
    welcome();
    deliver(snap(5, [shipRec(1, 100, 100)]));
    const before = stats.snapshotAt;
    vi.advanceTimersByTime(50);
    deliver(snap(5, [shipRec(1, 999, 999)]));
    deliver(snap(3, [shipRec(1, 999, 999)]));
    expect(stats.snapshotAt).toBe(before);
    expect(session.lastTick).toBe(5);
  });

  it('step надсилає інпут із зростаючим seq і тіком останнього знімка', () => {
    const { session, welcome, deliver, sent } = setup();
    welcome();
    deliver(snap(4, [shipRec(1, 100, 100)]));
    session.step(controls);
    session.step(controls);
    const seqs = sent.mock.calls.map(([input]) => input.seq);
    expect(seqs).toEqual([1, 2]);
    expect(sent.mock.calls[0]?.[0].tick).toBe(4);
    expect(sent.mock.calls[0]?.[1]).toBe('binary');
  });

  it('step без передбачення (до першого знімка) нічого не шле', () => {
    const { session, welcome, sent } = setup();
    welcome();
    session.step(controls);
    expect(sent).not.toHaveBeenCalled();
  });

  it('ack у знімку підтверджує інпути: pending зменшується', () => {
    const { session, welcome, deliver, stats } = setup();
    welcome();
    deliver(snap(1, [shipRec(1, 640, 360)]));
    for (let i = 0; i < 5; i++) session.step(controls);
    expect(stats.pending).toBe(5);
    deliver(snap(2, [shipRec(1, 640, 360)], [], 3));
    expect(stats.pending).toBe(2);
  });

  it('подія fired від іншого гравця доходить до шини, власна - ні', () => {
    const { bus, welcome, deliver } = setup();
    const fired = vi.fn();
    bus.on('fired', fired);
    welcome();
    deliver(
      snap(
        1,
        [shipRec(1, 0, 0)],
        [
          { type: EventType.FIRED, x: 1, y: 1, owner: ME },
          { type: EventType.FIRED, x: 2, y: 2, owner: OTHER },
        ],
      ),
    );
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith({ x: 2, y: 2, owner: OTHER });
  });

  it('scored показується лише власнику, exploded і hit - усім', () => {
    const { bus, welcome, deliver } = setup();
    const scored = vi.fn();
    const exploded = vi.fn();
    const hit = vi.fn();
    bus.on('scored', scored);
    bus.on('exploded', exploded);
    bus.on('hit', hit);
    welcome();
    deliver(
      snap(
        1,
        [shipRec(1, 0, 0)],
        [
          { type: EventType.SCORED, x: 0, y: 0, owner: OTHER, points: 50 },
          { type: EventType.SCORED, x: 0, y: 0, owner: ME, points: 10 },
          { type: EventType.EXPLODED, x: 5, y: 5, what: 'asteroid' },
          { type: EventType.HIT, x: 6, y: 6 },
        ],
      ),
    );
    expect(scored).toHaveBeenCalledTimes(1);
    expect(scored).toHaveBeenCalledWith(expect.objectContaining({ points: 10 }));
    expect(exploded).toHaveBeenCalledWith({ kind: 'asteroid', x: 5, y: 5, owner: undefined });
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('стрільба створює привида-кулю і подію fired одразу', () => {
    const { session, bus, welcome, deliver } = setup();
    const fired = vi.fn();
    bus.on('fired', fired);
    welcome();
    deliver(snap(1, [shipRec(1, 640, 360)]));
    session.step({ turn: 0, thrust: false, fire: true });
    expect(session.ghosts).toHaveLength(1);
    expect(fired).toHaveBeenCalledTimes(1);
    for (const g of session.ghosts) releaseBullet(g.bullet);
  });

  it('привид згасає, якщо сервер так і не підтвердив кулю', () => {
    const { session, welcome, deliver } = setup();
    welcome();
    deliver(snap(1, [shipRec(1, 640, 360)]));
    session.step({ turn: 0, thrust: false, fire: true });
    vi.advanceTimersByTime(2000);
    deliver(snap(2, [shipRec(1, 640, 360)]));
    expect(session.ghosts).toHaveLength(0);
  });

  it('renderEntities: свій корабель з передбачення, чужий корабель і астероїд з інтерполяції', () => {
    const { session, welcome, deliver } = setup();
    session.interpolator.delay = 0;
    welcome();
    deliver(
      snap(1, [
        shipRec(1, 100, 100),
        shipRec(2, 300, 300),
        {
          id: entityId(9),
          kind: Kind.ASTEROID,
          x: 50,
          y: 50,
          vx: 0,
          vy: 0,
          angle: 0,
          radius: 22,
          homing: true,
        },
      ]),
    );
    const list = session.renderEntities(performance.now());
    const kinds = list.map((e) => e.kind).sort();
    expect(kinds).toEqual(['asteroid', 'ship', 'ship']);
    expect(list.filter((e) => e.kind === 'ship' && e.isMe)).toHaveLength(1);
    const asteroid = list.find((e) => e.kind === 'asteroid');
    expect(asteroid?.kind === 'asteroid' && asteroid.homing).toBe(true);
    expect(asteroid?.radius).toBe(22);
  });

  it('renderEntities перевикористовує об’єкти між кадрами (без нових алокацій)', () => {
    const { session, welcome, deliver } = setup();
    session.interpolator.delay = 0;
    welcome();
    deliver(snap(1, [shipRec(1, 100, 100), shipRec(2, 300, 300)]));
    const first = [...session.renderEntities(1000)];
    const second = [...session.renderEntities(1016)];
    expect(second.length).toBe(first.length);
    second.forEach((item, i) => expect(item).toBe(first[i]));
  });

  it('predict=false: свій корабель малюється зі знімка, а не з передбачення', () => {
    const { session, welcome, deliver, sent } = setup(false);
    session.interpolator.delay = 0;
    welcome();
    deliver(snap(1, [shipRec(1, 100, 100)]));
    session.step(controls);
    expect(sent).toHaveBeenCalled();
    const mine = session.renderEntities(performance.now()).filter((e) => e.kind === 'ship');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.kind === 'ship' && mine[0].isMe).toBe(true);
    expect(session.prediction?.pending.length).toBe(0);
  });

  it('мертві кораблі не малюються', () => {
    const { session, welcome, deliver } = setup();
    session.interpolator.delay = 0;
    welcome();
    deliver(snap(1, [shipRec(1, 1, 1), shipRec(2, 5, 5, { alive: false })]));
    const ships = session.renderEntities(performance.now()).filter((e) => e.kind === 'ship');
    expect(ships).toHaveLength(1);
  });

  it('pong рахує RTT, dispose зупиняє пінги', () => {
    const { connection, session, stats } = setup();
    const send = vi.spyOn(connection, 'send').mockImplementation(() => {});
    vi.advanceTimersByTime(3100);
    expect(send).toHaveBeenCalledTimes(3);
    connection.emit('pong', { v: 1, type: 'pong', t: performance.now() - 40 });
    expect(stats.rtt).toBeCloseTo(40, 0);
    session.dispose();
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('Ship.fromSnapshot у передбаченні бере hp зі знімка', () => {
    const { session, welcome, deliver } = setup();
    welcome();
    deliver(snap(1, [shipRec(1, 5, 5, { hp: 42, score: 7 })]));
    expect(session.prediction?.ship).toBeInstanceOf(Ship);
    expect(session.prediction?.ship.hp).toBe(42);
  });
});
