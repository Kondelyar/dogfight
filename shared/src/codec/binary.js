import { BINARY_VERSION, MsgType, Kind } from '../protocol.js';
import { wrapAngle } from '../sim/arena.js';

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
    9   u16  a: fired owner | exploded kind (1 ship, 2 asteroid) | scored owner
    11  u16  b: scored points
*/

const HEADER = 13;
const ENTITY = 28;
const EVENT = 13;
export const INPUT_SIZE = 12;

const viewOf = (data) =>
  data instanceof ArrayBuffer
    ? new DataView(data)
    : new DataView(data.buffer, data.byteOffset, data.byteLength);

export function encodeInput(input) {
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

// null, якщо кадр не схожий на інпут (довжина, тип, версія)
export function decodeInput(data) {
  if (data.byteLength !== INPUT_SIZE) return null;
  const v = viewOf(data);
  if (v.getUint8(0) !== MsgType.INPUT || v.getUint8(1) !== BINARY_VERSION) return null;
  const flags = v.getUint8(10);
  return {
    seq: v.getUint32(2, true),
    tick: v.getUint32(6, true),
    thrust: (flags & 1) !== 0,
    fire: (flags & 2) !== 0,
    turn: v.getInt8(11),
  };
}

function writeEntity(v, o, e) {
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

function readEntity(v, o) {
  const kind = v.getUint8(o + 2);
  const flags = v.getUint8(o + 3);
  const a = v.getUint16(o + 22, true);
  const b = v.getUint16(o + 24, true);
  const c = v.getUint8(o + 26);
  const d = v.getUint8(o + 27);
  const base = {
    id: v.getUint16(o, true),
    x: v.getFloat32(o + 4, true),
    y: v.getFloat32(o + 8, true),
    vx: v.getFloat32(o + 12, true),
    vy: v.getFloat32(o + 16, true),
    angle: v.getInt16(o + 20, true) / 1000,
    kind,
  };

  switch (kind) {
    case Kind.SHIP:
      return {
        ...base,
        alive: (flags & 1) !== 0,
        thrusting: (flags & 2) !== 0,
        hp: a,
        score: b,
        cooldown: c,
        rapid: d,
      };
    case Kind.BULLET:
      return { ...base, owner: a, seq: b };
    case Kind.ASTEROID:
      return { ...base, radius: a, homing: (flags & 4) !== 0 };
    case Kind.PICKUP:
      return { ...base, effect: c };
    default:
      return null;
  }
}

export function encodeSnapshot({ tick, ack, entities, events }) {
  const buf = new ArrayBuffer(HEADER + entities.length * ENTITY + events.length * EVENT);
  const v = new DataView(buf);
  v.setUint8(0, MsgType.SNAPSHOT);
  v.setUint8(1, BINARY_VERSION);
  v.setUint32(2, tick, true);
  v.setUint32(6, ack, true);
  v.setUint16(10, entities.length, true);
  v.setUint8(12, events.length);

  let o = HEADER;
  for (const e of entities) {
    writeEntity(v, o, e);
    o += ENTITY;
  }
  for (const ev of events) {
    v.setUint8(o, ev.type);
    v.setFloat32(o + 1, ev.x, true);
    v.setFloat32(o + 5, ev.y, true);
    v.setUint16(o + 9, ev.a, true);
    v.setUint16(o + 11, ev.b, true);
    o += EVENT;
  }
  return buf;
}

export function decodeSnapshot(data) {
  if (data.byteLength < HEADER) return null;
  const v = viewOf(data);
  if (v.getUint8(0) !== MsgType.SNAPSHOT || v.getUint8(1) !== BINARY_VERSION) return null;

  const count = v.getUint16(10, true);
  const eventCount = v.getUint8(12);
  if (data.byteLength !== HEADER + count * ENTITY + eventCount * EVENT) return null;

  const entities = [];
  let o = HEADER;
  for (let i = 0; i < count; i++, o += ENTITY) {
    const e = readEntity(v, o);
    if (e) entities.push(e);
  }

  const events = [];
  for (let i = 0; i < eventCount; i++, o += EVENT) {
    events.push({
      type: v.getUint8(o),
      x: v.getFloat32(o + 1, true),
      y: v.getFloat32(o + 5, true),
      a: v.getUint16(o + 9, true),
      b: v.getUint16(o + 11, true),
    });
  }

  return { tick: v.getUint32(2, true), ack: v.getUint32(6, true), entities, events };
}
