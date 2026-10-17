import path from 'node:path';

function int(env, name, fallback, { min = 1, max = 2 ** 31 - 1 } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in ${min}..${max}, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  return {
    port: int(env, 'PORT', 3000, { min: 0, max: 65535 }),
    host: env.HOST || '0.0.0.0',
    logDir: path.resolve(env.LOG_DIR || path.join(import.meta.dirname, '../logs')),
    clientDist: path.resolve(import.meta.dirname, '../../client/dist'),
    debugRoutes: env.DEBUG_ROUTES === '1',

    maxRooms: int(env, 'MAX_ROOMS', 20),
    maxPlayers: int(env, 'MAX_PLAYERS', 8),
    maxPayload: int(env, 'MAX_PAYLOAD', 4096),
    ratePerSec: int(env, 'RATE_PER_SEC', 10),
    rateBurst: int(env, 'RATE_BURST', 20),
    slowClientBytes: int(env, 'SLOW_CLIENT_BYTES', 64 * 1024),
    joinTimeoutMs: int(env, 'JOIN_TIMEOUT_MS', 5000),
    heartbeatMs: int(env, 'HEARTBEAT_MS', 15000),
    emptyRoomTtlMs: int(env, 'EMPTY_ROOM_TTL_MS', 60_000),
  };
}
