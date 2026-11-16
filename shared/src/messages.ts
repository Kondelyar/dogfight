import { z } from 'zod';
import { entityId, seq, seq16, tick, fail, ok, type Result } from './brand.ts';
import { EventType, Kind, PROTOCOL_VERSION } from './protocol.ts';

// ---------- Базові числа. Тип виводиться зі схеми: z.infer, окремих interface немає ----------

const num = z.number();
const u8 = z.number().int().min(0).max(0xff);
const u16 = z.number().int().min(0).max(0xffff);
const u32 = z.number().int().min(0).max(0xffff_ffff);

const idField = u16.transform(entityId);
const tickField = u32.transform(tick);
const seqField = u32.transform(seq);

export const TurnSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export type Turn = z.infer<typeof TurnSchema>;

export const CodecSchema = z.enum(['binary', 'json']);
export type Codec = z.infer<typeof CodecSchema>;

// ---------- Знімок: сутності (розрізняємо полем kind) і події (полем type) ----------

const baseFields = { id: idField, x: num, y: num, vx: num, vy: num, angle: num };

export const ShipRecordSchema = z.object({
  ...baseFields,
  kind: z.literal(Kind.SHIP),
  alive: z.boolean(),
  thrusting: z.boolean(),
  hp: u16,
  score: u16,
  cooldown: u8,
  rapid: u8,
});

export const BulletRecordSchema = z.object({
  ...baseFields,
  kind: z.literal(Kind.BULLET),
  owner: idField,
  seq: u16.transform(seq16),
});

export const AsteroidRecordSchema = z.object({
  ...baseFields,
  kind: z.literal(Kind.ASTEROID),
  radius: u16,
  homing: z.boolean(),
});

export const PickupRecordSchema = z.object({
  ...baseFields,
  kind: z.literal(Kind.PICKUP),
  effect: z.union([z.literal(1), z.literal(2)]),
});

export const EntityRecordSchema = z.discriminatedUnion('kind', [
  ShipRecordSchema,
  BulletRecordSchema,
  AsteroidRecordSchema,
  PickupRecordSchema,
]);

export type ShipRecord = z.infer<typeof ShipRecordSchema>;
export type BulletRecord = z.infer<typeof BulletRecordSchema>;
export type AsteroidRecord = z.infer<typeof AsteroidRecordSchema>;
export type PickupRecord = z.infer<typeof PickupRecordSchema>;
export type EntityRecord = z.infer<typeof EntityRecordSchema>;

const point = { x: num, y: num };

export const SnapshotEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(EventType.FIRED), ...point, owner: idField }),
  z.object({ type: z.literal(EventType.HIT), ...point }),
  z.object({ type: z.literal(EventType.EXPLODED), ...point, what: z.enum(['ship', 'asteroid']) }),
  z.object({ type: z.literal(EventType.SCORED), ...point, owner: idField, points: u16 }),
]);
export type SnapshotEvent = z.infer<typeof SnapshotEventSchema>;

export const SnapshotSchema = z.object({
  tick: tickField,
  ack: seqField,
  entities: z.array(EntityRecordSchema).max(0xffff),
  events: z.array(SnapshotEventSchema).max(0xff),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

// ---------- Інпут гравця (однаковий для JSON і для бінарного кадру) ----------

export const InputFieldsSchema = z.object({
  seq: seqField,
  tick: tickField,
  turn: TurnSchema,
  thrust: z.boolean(),
  fire: z.boolean(),
});
export type ControlInput = z.infer<typeof InputFieldsSchema>;

// ---------- Клієнт -> сервер ----------

const v = z.literal(PROTOCOL_VERSION);

export const MAX_NAME = 16;
export const MAX_CHAT = 200;
const ROOM_ID = /^[\w-]{1,40}$/;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('join'),
    room: z.string().regex(ROOM_ID),
    name: z.string().trim().min(1).max(MAX_NAME),
    codec: CodecSchema.default('binary'),
  }),
  z.object({ v, type: z.literal('chat'), text: z.string().trim().min(1).max(MAX_CHAT) }),
  z.object({ v, type: z.literal('input'), ...InputFieldsSchema.shape }),
  z.object({ v, type: z.literal('ping'), t: z.number().min(0).max(Number.MAX_SAFE_INTEGER) }),
  z.object({
    v,
    type: z.literal('lag'),
    baseMs: z.number().min(0).max(1000),
    jitterMs: z.number().min(0).max(500),
    drop: z.number().min(0).max(0.5),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- Сервер -> клієнт ----------

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('welcome'),
    you: idField,
    seed: u32,
    tick: tickField,
    tickRate: z.number().positive(),
  }),
  z.object({ v, type: z.literal('roster'), players: z.array(z.string()) }),
  z.object({ v, type: z.literal('chat'), from: z.string(), text: z.string() }),
  z.object({ v, type: z.literal('pong'), t: num }),
  z.object({ v, type: z.literal('snapshot'), ...SnapshotSchema.shape }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ---------- Розбір на вході в процес: приймає unknown, ніколи не кидає ----------

// Текст (JSON) або вже розібране значення. Битий JSON - це звичайна помилка валідації.
function toValue(raw: unknown): Result<unknown> {
  if (typeof raw !== 'string') return ok(raw);
  try {
    const parsed: unknown = JSON.parse(raw);
    return ok(parsed);
  } catch {
    return fail('invalid json');
  }
}

function parseWith<S extends z.ZodType>(schema: S, raw: unknown): Result<z.infer<S>> {
  const value = toValue(raw);
  if (!value.ok) return value;
  const parsed = schema.safeParse(value.value);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  return fail(issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'invalid message');
}

export const parseClientMessage = (raw: unknown): Result<ClientMessage> =>
  parseWith(ClientMessageSchema, raw);
export const parseServerMessage = (raw: unknown): Result<ServerMessage> =>
  parseWith(ServerMessageSchema, raw);
export const parseSnapshot = (raw: unknown): Result<Snapshot> => parseWith(SnapshotSchema, raw);
export const parseInput = (raw: unknown): Result<ControlInput> => parseWith(InputFieldsSchema, raw);

// ---------- Кодування повідомлень (версію додаємо тут, а не в кожному місці виклику) ----------

type WithoutV<T> = T extends unknown ? Omit<T, 'v'> : never;
export type ClientPayload = WithoutV<ClientMessage>;
export type ServerPayload = WithoutV<ServerMessage>;

export const encodeClientMessage = (msg: ClientPayload): string =>
  JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
export const encodeServerMessage = (msg: ServerPayload): string =>
  JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
