export const BINARY_VERSION = 1;

export const MsgType = { INPUT: 1, SNAPSHOT: 2 };
export const Kind = { SHIP: 1, BULLET: 2, ASTEROID: 3, PICKUP: 4 };
export const EventType = { FIRED: 1, HIT: 2, EXPLODED: 3, SCORED: 4 };
export const Effect = { shield: 1, rapidfire: 2 };
export const EffectName = { 1: 'shield', 2: 'rapidfire' };

const fail = (reason) => ({ ok: false, reason });
const isU32 = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

// інпут клієнта: seq, tick, turn (-1/0/1), thrust, fire. Нічого, крім цього, сервер не приймає
export function validateInput(msg) {
  if (msg === null || typeof msg !== 'object') return fail('not an object');
  if (!isU32(msg.seq) || !isU32(msg.tick)) return fail('bad seq/tick');
  if (msg.turn !== -1 && msg.turn !== 0 && msg.turn !== 1) return fail('bad turn');
  if (typeof msg.thrust !== 'boolean' || typeof msg.fire !== 'boolean') return fail('bad flags');
  return {
    ok: true,
    input: { seq: msg.seq, tick: msg.tick, turn: msg.turn, thrust: msg.thrust, fire: msg.fire },
  };
}
