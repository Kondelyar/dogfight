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

export function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const fail = (reason) => ({ ok: false, reason });

// ніколи не довіряємо формі повідомлення від клієнта
export function validate(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return fail('not an object');
  if (msg.v !== PROTOCOL_VERSION) return fail('unsupported version');

  switch (msg.type) {
    case 'join': {
      if (typeof msg.room !== 'string' || !ROOM_ID.test(msg.room)) return fail('bad room');
      const name = typeof msg.name === 'string' ? msg.name.trim() : '';
      if (name.length < 1 || name.length > MAX_NAME) return fail('bad name');
      return { ok: true, msg: { type: 'join', room: msg.room, name } };
    }
    case 'chat': {
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (text.length < 1 || text.length > MAX_CHAT) return fail('bad text');
      return { ok: true, msg: { type: 'chat', text } };
    }
    default:
      return fail('unknown type');
  }
}

export function encode(type, payload = {}) {
  return JSON.stringify({ v: PROTOCOL_VERSION, type, ...payload });
}
