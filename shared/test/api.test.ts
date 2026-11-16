import { describe, expect, it } from 'vitest';
import {
  CreateRoomRequestSchema,
  RoomListResponseSchema,
  parseInput,
  parseSnapshot,
  seq,
} from '../src/index.ts';

describe('HTTP API: схеми', () => {
  it('створення кімнати: ім’я обрізається й має бути 1..32 символи', () => {
    expect(CreateRoomRequestSchema.parse({ name: '  Arena ' })).toEqual({ name: 'Arena' });
    expect(CreateRoomRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateRoomRequestSchema.safeParse({ name: 'x'.repeat(33) }).success).toBe(false);
    expect(CreateRoomRequestSchema.safeParse({ name: 5 }).success).toBe(false);
  });

  it('список кімнат: перевіряє форму кожної кімнати', () => {
    const good = { rooms: [{ id: 'a1', name: 'Arena', players: 2, max: 8 }] };
    expect(RoomListResponseSchema.safeParse(good).success).toBe(true);
    expect(RoomListResponseSchema.safeParse({ rooms: [{ id: 'a1' }] }).success).toBe(false);
    expect(RoomListResponseSchema.safeParse({ rooms: 'no' }).success).toBe(false);
  });
});

describe('parseInput / parseSnapshot', () => {
  it('parseInput повертає branded-значення', () => {
    const result = parseInput({ seq: 3, tick: 9, turn: 1, thrust: true, fire: false });
    expect(result).toEqual({
      ok: true,
      value: { seq: seq(3), tick: 9, turn: 1, thrust: true, fire: false },
    });
  });

  it('parseInput називає перше погане поле', () => {
    const result = parseInput({ seq: 3, tick: 9, turn: 5, thrust: true, fire: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('turn');
  });

  it('parseSnapshot відхиляє сутність невідомого виду', () => {
    const bad = { tick: 1, ack: 0, events: [], entities: [{ id: 1, kind: 9, x: 0, y: 0 }] };
    expect(parseSnapshot(bad).ok).toBe(false);
    expect(parseSnapshot({ tick: 1, ack: 0, entities: [], events: [] }).ok).toBe(true);
  });

  it('parseSnapshot приймає текст JSON і відхиляє зіпсований', () => {
    expect(parseSnapshot(JSON.stringify({ tick: 1, ack: 0, entities: [], events: [] })).ok).toBe(
      true,
    );
    expect(parseSnapshot('{"tick":').ok).toBe(false);
  });
});
