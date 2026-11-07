import { validateInput } from 'shared';

export const PROTOCOL_VERSION = 1;

export const CloseCode = {
  SHUTDOWN: 1001,
  BAD_MESSAGE: 4000,
  JOIN_TIMEOUT: 4001,
  ROOM_FULL: 4002,
  RATE_LIMIT: 4003,
  SLOW_CLIENT: 4004,
  NO_ROOM: 4005,
};

const MAX_NAME = 16;
const MAX_CHAT = 200;
const ROOM_ID = /^[\w-]{1,40}$/;
const CODECS = ['binary', 'json'];

export function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const fail = (reason) => ({ ok: false, reason });
const inRange = (n, min, max) =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

// ніколи не довіряємо формі повідомлення від клієнта
export function validate(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return fail('not an object');
  if (msg.v !== PROTOCOL_VERSION) return fail('unsupported version');

  switch (msg.type) {
    case 'join': {
      if (typeof msg.room !== 'string' || !ROOM_ID.test(msg.room)) return fail('bad room');
      const name = typeof msg.name === 'string' ? msg.name.trim() : '';
      if (name.length < 1 || name.length > MAX_NAME) return fail('bad name');
      const codec = msg.codec ?? 'binary';
      if (!CODECS.includes(codec)) return fail('bad codec');
      return { ok: true, msg: { type: 'join', room: msg.room, name, codec } };
    }
    case 'chat': {
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (text.length < 1 || text.length > MAX_CHAT) return fail('bad text');
      return { ok: true, msg: { type: 'chat', text } };
    }
    case 'input': {
      const result = validateInput(msg);
      return result.ok ? { ok: true, msg: { type: 'input', ...result.input } } : result;
    }
    case 'ping':
      if (!inRange(msg.t, 0, Number.MAX_SAFE_INTEGER)) return fail('bad ping');
      return { ok: true, msg: { type: 'ping', t: msg.t } };
    case 'lag': {
      if (
        !inRange(msg.baseMs, 0, 1000) ||
        !inRange(msg.jitterMs, 0, 500) ||
        !inRange(msg.drop, 0, 0.5)
      ) {
        return fail('bad lag');
      }
      return {
        ok: true,
        msg: { type: 'lag', baseMs: msg.baseMs, jitterMs: msg.jitterMs, drop: msg.drop },
      };
    }
    default:
      return fail('unknown type');
  }
}

export function encode(type, payload = {}) {
  return JSON.stringify({ v: PROTOCOL_VERSION, type, ...payload });
}
