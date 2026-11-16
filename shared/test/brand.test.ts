import { describe, expect, it } from 'vitest';
import {
  NO_ENTITY,
  Effect,
  CloseCode,
  FINAL_CLOSE_CODES,
  assertNever,
  effectName,
  entityId,
  fail,
  ok,
  seq,
  tick,
  toSeq16,
} from '../src/index.ts';

describe('branded-типи', () => {
  it('у рантаймі це звичайні числа', () => {
    expect(entityId(5)).toBe(5);
    expect(seq(100)).toBe(100);
    expect(tick(7) + 1).toBe(8);
    expect(NO_ENTITY).toBe(0);
  });

  it('toSeq16 лишає молодші 16 біт', () => {
    expect(toSeq16(seq(0x1_0005))).toBe(5);
    expect(toSeq16(seq(65535))).toBe(65535);
  });
});

describe('Result', () => {
  it('ok і fail мають різні гілки', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    expect(fail('bad')).toEqual({ ok: false, error: 'bad' });
  });
});

describe('assertNever', () => {
  it('кидає помилку з описом, якщо все ж таки викликана', () => {
    // @ts-expect-error навмисно передаємо значення, якого за типами не буває
    expect(() => assertNever('surprise')).toThrow(/unhandled variant/);
  });
});

describe('протокол: константи', () => {
  it('effectName відповідає кодам ефектів', () => {
    expect(effectName(Effect.shield)).toBe('shield');
    expect(effectName(Effect.rapidfire)).toBe('rapidfire');
  });

  it('після цих кодів клієнт не перепідключається, а йде в лобі', () => {
    expect(FINAL_CLOSE_CODES.has(CloseCode.ROOM_FULL)).toBe(true);
    expect(FINAL_CLOSE_CODES.has(CloseCode.SHUTDOWN)).toBe(true);
    expect(FINAL_CLOSE_CODES.has(CloseCode.RATE_LIMIT)).toBe(false);
  });
});
