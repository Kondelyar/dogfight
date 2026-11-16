import { entityId, fail, ok, seq, seq16, tick, type Result } from '../brand.ts';
import { BINARY_VERSION, EventType, Kind, MsgType } from '../protocol.ts';
import {
  parseInput,
  type ControlInput,
  type EntityRecord,
  type Snapshot,
  type SnapshotEvent,
} from '../messages.ts';
import { wrapAngle } from '../sim/arena.ts';

/*
  Бінарний протокол v1. Порядок байтів скрізь little-endian.

  INPUT (клієнт -> сервер), 12 байт
    0   u8   type = 1
    1   u8   version = 1
    2   u32  seq
    6   u32  tick (останній тік сервера, який бачив клієнт)
    10  u8   flags: bit0 thrust, bit1 fire
    11  i8   turn (-1, 0, 1)

  SNAPSHOT (сервер -> клієнт), 13 + 28 * entities + 13 * events байт
    0   u8   type = 2
    1   u8   version = 1
    2   u32  tick
    6   u32  ack (seq останнього обробленого інпуту цього клієнта)
    10  u16  entityCount
    12  u8   eventCount
    13  entityCount * ENTITY
        eventCount  * EVENT

  ENTITY, 28 байт
    0   u16  id
    2   u8   kind (1 ship, 2 bullet, 3 asteroid, 4 pickup)
    3   u8   flags: bit0 alive, bit1 thrusting, bit2 homing
    4   f32  x
    8   f32  y
    12  f32  vx
    16  f32  vy
    20  i16  angle, у 1/1000 радіана (точність 0.0005 рад)
    22  u16  a: ship hp | bullet owner | asteroid radius
    24  u16  b: ship score | bullet seq (молодші 16 біт)
    26  u8   c: ship cooldown (кроків) | pickup effect (1 shield, 2 rapidfire)
    27  u8   d: ship rapidfire (кроків)

  EVENT, 13 байт
    0   u8   type (1 fired, 2 hit, 3 exploded, 4 scored)
    1   f32  x
    5   f32  y
    9   u16  a: fired owner | exploded what (1 ship, 2 asteroid) | scored owner
    11  u16  b: scored points
*/

const HEADER = 13;
const ENTITY = 28;
const EVENT = 13;
export const INPUT_SIZE = 12;

// ±π з запасом на квантування кута до 1/1000 радіана
const MAX_ANGLE = Math.PI + 0.001;

// Усередині декодера помилки кидаємо цим класом, а назовні віддаємо Result: декодер не падає.
class DecodeError extends Error {}

function bad(message: string): never {
  throw new DecodeError(message);
}

const viewOf = (data: ArrayBuffer | ArrayBufferView): DataView =>
  data instanceof ArrayBuffer
    ? new DataView(data)
    : new DataView(data.buffer, data.byteOffset, data.byteLength);

function guard<T>(run: () => T): Result<T> {
  try {
    return ok(run());
  } catch (err: unknown) {
    if (err instanceof DecodeError) return fail(err.message);
    throw err; // справжній баг не маскуємо
  }
}

export function encodeInput(input: ControlInput): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_SIZE);
  const v = new DataView(buf);
  v.setUint8(0, MsgType.INPUT);
  v.setUint8(1, BINARY_VERSION);
  v.setUint32(2, input.seq, true);
  v.setUint32(6, input.tick, true);
  v.setUint8(10, (input.thrust ? 1 : 0) | (input.fire ? 2 : 0));
  v.setInt8(11, input.turn);
  return buf;
}

// Перевіряє довжину, тип, версію й діапазони (turn -1..1, seq/tick u32 через схему).
export function decodeInput(data: ArrayBuffer | ArrayBufferView): Result<ControlInput> {
  if (data.byteLength !== INPUT_SIZE)
    return fail(`input must be ${INPUT_SIZE} bytes, got ${data.byteLength}`);
  const v = viewOf(data);
  if (v.getUint8(0) !== MsgType.INPUT) return fail('not an input frame');
  if (v.getUint8(1) !== BINARY_VERSION) return fail(`unsupported version ${v.getUint8(1)}`);
  const flags = v.getUint8(10);
  if ((flags & ~3) !== 0) return fail('unknown input flags');
  return parseInput({
    seq: v.getUint32(2, true),
    tick: v.getUint32(6, true),
    thrust: (flags & 1) !== 0,
    fire: (flags & 2) !== 0,
    turn: v.getInt8(11),
  });
}

function writeEntity(v: DataView, o: number, e: EntityRecord): void {
  let flags = 0;
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;

  switch (e.kind) {
    case Kind.SHIP:
      flags = (e.alive ? 1 : 0) | (e.thrusting ? 2 : 0);
      [a, b, c, d] = [e.hp, e.score, e.cooldown, e.rapid];
      break;
    case Kind.BULLET:
      flags = 1;
      [a, b] = [e.owner, e.seq];
      break;
    case Kind.ASTEROID:
      flags = 1 | (e.homing ? 4 : 0);
      a = e.radius;
      break;
    case Kind.PICKUP:
      flags = 1;
      c = e.effect;
      break;
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }

  v.setUint16(o, e.id, true);
  v.setUint8(o + 2, e.kind);
  v.setUint8(o + 3, flags);
  v.setFloat32(o + 4, e.x, true);
  v.setFloat32(o + 8, e.y, true);
  v.setFloat32(o + 12, e.vx, true);
  v.setFloat32(o + 16, e.vy, true);
  v.setInt16(o + 20, Math.round(wrapAngle(e.angle) * 1000), true);
  v.setUint16(o + 22, a, true);
  v.setUint16(o + 24, b, true);
  v.setUint8(o + 26, c);
  v.setUint8(o + 27, d);
}

function readEntity(v: DataView, o: number): EntityRecord {
  const kind = v.getUint8(o + 2);
  const flags = v.getUint8(o + 3);
  const a = v.getUint16(o + 22, true);
  const b = v.getUint16(o + 24, true);
  const c = v.getUint8(o + 26);
  const d = v.getUint8(o + 27);
  const base = {
    id: entityId(v.getUint16(o, true)),
    x: v.getFloat32(o + 4, true),
    y: v.getFloat32(o + 8, true),
    vx: v.getFloat32(o + 12, true),
    vy: v.getFloat32(o + 16, true),
    angle: v.getInt16(o + 20, true) / 1000,
  };

  if (![base.x, base.y, base.vx, base.vy].every(Number.isFinite))
    bad('non-finite number in entity');
  if (Math.abs(base.angle) > MAX_ANGLE) bad(`angle out of range: ${base.angle}`);

  switch (kind) {
    case Kind.SHIP:
      return {
        ...base,
        kind,
        alive: (flags & 1) !== 0,
        thrusting: (flags & 2) !== 0,
        hp: a,
        score: b,
        cooldown: c,
        rapid: d,
      };
    case Kind.BULLET:
      return { ...base, kind, owner: entityId(a), seq: seq16(b) };
    case Kind.ASTEROID:
      return { ...base, kind, radius: a, homing: (flags & 4) !== 0 };
    case Kind.PICKUP:
      if (c !== 1 && c !== 2) bad(`unknown pickup effect ${c}`);
      return { ...base, kind, effect: c };
    default:
      return bad(`unknown entity kind ${kind}`);
  }
}

function writeEvent(v: DataView, o: number, ev: SnapshotEvent): void {
  let a = 0;
  let b = 0;
  switch (ev.type) {
    case EventType.FIRED:
      a = ev.owner;
      break;
    case EventType.HIT:
      break;
    case EventType.EXPLODED:
      a = ev.what === 'ship' ? 1 : 2;
      break;
    case EventType.SCORED:
      [a, b] = [ev.owner, ev.points];
      break;
    default: {
      const unreachable: never = ev;
      return unreachable;
    }
  }
  v.setUint8(o, ev.type);
  v.setFloat32(o + 1, ev.x, true);
  v.setFloat32(o + 5, ev.y, true);
  v.setUint16(o + 9, a, true);
  v.setUint16(o + 11, b, true);
}

function readEvent(v: DataView, o: number): SnapshotEvent {
  const type = v.getUint8(o);
  const x = v.getFloat32(o + 1, true);
  const y = v.getFloat32(o + 5, true);
  const a = v.getUint16(o + 9, true);
  const b = v.getUint16(o + 11, true);
  if (!Number.isFinite(x) || !Number.isFinite(y)) bad('non-finite number in event');

  switch (type) {
    case EventType.FIRED:
      return { type, x, y, owner: entityId(a) };
    case EventType.HIT:
      return { type, x, y };
    case EventType.EXPLODED:
      if (a !== 1 && a !== 2) bad(`unknown exploded target ${a}`);
      return { type, x, y, what: a === 1 ? 'ship' : 'asteroid' };
    case EventType.SCORED:
      return { type, x, y, owner: entityId(a), points: b };
    default:
      return bad(`unknown event type ${type}`);
  }
}

export function encodeSnapshot({ tick: t, ack, entities, events }: Snapshot): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER + entities.length * ENTITY + events.length * EVENT);
  const v = new DataView(buf);
  v.setUint8(0, MsgType.SNAPSHOT);
  v.setUint8(1, BINARY_VERSION);
  v.setUint32(2, t, true);
  v.setUint32(6, ack, true);
  v.setUint16(10, entities.length, true);
  v.setUint8(12, events.length);

  let o = HEADER;
  for (const e of entities) {
    writeEntity(v, o, e);
    o += ENTITY;
  }
  for (const ev of events) {
    writeEvent(v, o, ev);
    o += EVENT;
  }
  return buf;
}

// Не кидає: порожній, обрізаний чи чужий буфер дає { ok: false }.
export function decodeSnapshot(data: ArrayBuffer | ArrayBufferView): Result<Snapshot> {
  if (data.byteLength < HEADER) return fail(`snapshot shorter than header: ${data.byteLength}`);
  const v = viewOf(data);
  if (v.getUint8(0) !== MsgType.SNAPSHOT) return fail('not a snapshot frame');
  if (v.getUint8(1) !== BINARY_VERSION) return fail(`unsupported version ${v.getUint8(1)}`);

  const count = v.getUint16(10, true);
  const eventCount = v.getUint8(12);
  const expected = HEADER + count * ENTITY + eventCount * EVENT;
  if (data.byteLength !== expected) {
    return fail(`snapshot length ${data.byteLength} does not match header (${expected})`);
  }

  return guard(() => {
    const entities: EntityRecord[] = [];
    let o = HEADER;
    for (let i = 0; i < count; i++, o += ENTITY) entities.push(readEntity(v, o));

    const events: SnapshotEvent[] = [];
    for (let i = 0; i < eventCount; i++, o += EVENT) events.push(readEvent(v, o));

    return { tick: tick(v.getUint32(2, true)), ack: seq(v.getUint32(6, true)), entities, events };
  });
}
