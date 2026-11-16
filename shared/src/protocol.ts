import { defineConst, type ValueOf } from './brand.ts';

export const PROTOCOL_VERSION = 1;
export const BINARY_VERSION = 1;

export const MsgType = defineConst({ INPUT: 1, SNAPSHOT: 2 });
export const Kind = defineConst({ SHIP: 1, BULLET: 2, ASTEROID: 3, PICKUP: 4 });
export type KindCode = ValueOf<typeof Kind>;
export const EventType = defineConst({ FIRED: 1, HIT: 2, EXPLODED: 3, SCORED: 4 });
export const Effect = defineConst({ shield: 1, rapidfire: 2 });
export type EffectName = keyof typeof Effect;
export type EffectCode = ValueOf<typeof Effect>;

export function effectName(code: EffectCode): EffectName {
  switch (code) {
    case Effect.shield:
      return 'shield';
    case Effect.rapidfire:
      return 'rapidfire';
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}

// коди закриття WebSocket: спільні для сервера й клієнта
export const CloseCode = defineConst({
  SHUTDOWN: 1001,
  BAD_MESSAGE: 4000,
  JOIN_TIMEOUT: 4001,
  ROOM_FULL: 4002,
  RATE_LIMIT: 4003,
  SLOW_CLIENT: 4004,
  NO_ROOM: 4005,
});

// після цих кодів сервер свідомо відмовив - перепідключатись марно
export const FINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CloseCode.BAD_MESSAGE,
  CloseCode.ROOM_FULL,
  CloseCode.NO_ROOM,
]);
