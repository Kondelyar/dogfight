import { describe, expect, it } from 'vitest';
import { codecs, scriptedInput, seq, tick, type Snapshot } from 'shared';
import { Match } from '../src/match.ts';
import { RoomManager, type Player } from '../src/rooms.ts';

// Матч без мережі й таймерів: тік крутимо руками через tickOnce.
function setup(codec: 'binary' | 'json' = 'binary', players = 2) {
  const manager = new RoomManager({ maxRooms: 1, maxPlayers: 8 });
  const room = manager.create('unit');
  if (!room) throw new Error('кімната не створена');
  const match = new Match(room, { seed: 3 });
  const received = new Map<string, (string | ArrayBuffer)[]>();
  const joined: Player[] = Array.from({ length: players }, (_, i) => {
    const id = `p${i}`;
    received.set(id, []);
    return {
      id,
      name: id,
      codec,
      send: () => {},
      sendState: (data) => {
        received.get(id)?.push(data);
      },
    };
  });
  joined.forEach((p) => room.join(p));
  match.stop(); // join запускає таймер, а тут тіки наші
  return { room, match, joined, received };
}

const lastSnapshot = (frames: (string | ArrayBuffer)[] | undefined): Snapshot => {
  const frame = frames?.at(-1);
  if (!(frame instanceof ArrayBuffer)) throw new Error('очікували бінарний кадр');
  const decoded = codecs.binary.decodeSnapshot(frame);
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.value;
};

describe('Match.tickOnce', () => {
  it('кожен тік шле знімок кожному гравцю й збільшує tick', () => {
    const { match, received } = setup();
    match.tickOnce();
    match.tickOnce();
    expect(received.get('p0')).toHaveLength(2);
    expect(received.get('p1')).toHaveLength(2);
    expect(lastSnapshot(received.get('p0')).tick).toBe(2);
    expect(match.stats().tick).toBe(2);
  });

  it('ack у знімку свій у кожного гравця, хоча кадр кодується один раз', () => {
    const { room, match, joined, received } = setup();
    const [a, b] = joined;
    if (!a || !b) throw new Error('гравці не створені');
    room.emit('input', a, { ...scriptedInput(0), seq: seq(7), tick: tick(0) });
    room.emit('input', b, { ...scriptedInput(0), seq: seq(2), tick: tick(0) });
    match.tickOnce();
    expect(lastSnapshot(received.get('p0')).ack).toBe(7);
    expect(lastSnapshot(received.get('p1')).ack).toBe(2);
  });

  it('сутності у знімках гравців однакові (корабель кожного є в обох)', () => {
    const { match, received } = setup();
    match.tickOnce();
    const a = lastSnapshot(received.get('p0'));
    const b = lastSnapshot(received.get('p1'));
    expect(a.entities).toEqual(b.entities);
    expect(a.entities.filter((e) => e.kind === 1)).toHaveLength(2);
  });

  it('json-гравець отримує текст, а не бінарний кадр', () => {
    const { match, received } = setup('json');
    match.tickOnce();
    expect(typeof received.get('p0')?.at(-1)).toBe('string');
  });

  it('старі й повторені інпути відкидаються, нові застосовуються', () => {
    const { room, match, joined, received } = setup('binary', 1);
    const [a] = joined;
    if (!a) throw new Error('гравець не створений');
    room.emit('input', a, { ...scriptedInput(0), seq: seq(5), tick: tick(0), thrust: true });
    room.emit('input', a, { ...scriptedInput(0), seq: seq(3), tick: tick(0), thrust: true }); // старий
    room.emit('input', a, { ...scriptedInput(0), seq: seq(5), tick: tick(0), thrust: true }); // повтор
    match.tickOnce();
    expect(lastSnapshot(received.get('p0')).ack).toBe(5);
    match.tickOnce();
    expect(lastSnapshot(received.get('p0')).ack).toBe(5); // нових інпутів не було
  });

  it('гравець, що вийшов, більше не отримує знімків', () => {
    const { room, match, received } = setup();
    room.leave('p1');
    match.tickOnce();
    expect(received.get('p1')).toHaveLength(0);
    expect(received.get('p0')).toHaveLength(1);
  });

  it('події світу потрапляють у знімок (постріл дає fired)', () => {
    const { room, match, joined, received } = setup('binary', 1);
    const [a] = joined;
    if (!a) throw new Error('гравець не створений');
    room.emit('input', a, { ...scriptedInput(0), seq: seq(1), tick: tick(0), fire: true });
    match.tickOnce();
    const snap = lastSnapshot(received.get('p0'));
    expect(snap.events.some((e) => e.type === 1)).toBe(true);
    expect(snap.entities.some((e) => e.kind === 2)).toBe(true); // куля
  });

  it('stats: перцентилі тіку з’являються після тіків', () => {
    const { match } = setup();
    for (let i = 0; i < 50; i++) match.tickOnce();
    const stats = match.stats();
    expect(stats.players).toBe(2);
    expect(stats.tickMs.p50).toBeGreaterThanOrEqual(0);
    expect(stats.tickMs.p99).toBeGreaterThanOrEqual(stats.tickMs.p50);
    expect(stats.tickMs.max).toBeGreaterThanOrEqual(stats.tickMs.p99);
  });
});
