import path from 'node:path';
import { z } from 'zod';

// Змінні оточення - це теж ввід ззовні: перевіряємо схемою один раз на старті.
// Порожній рядок рахуємо як "не задано" (так зручніше в .env).
const blankAsUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const int = (fallback: number, min = 1, max = 2 ** 31 - 1) =>
  z.preprocess(blankAsUndefined, z.coerce.number().int().min(min).max(max).default(fallback));

const text = (fallback: string) => z.preprocess(blankAsUndefined, z.string().default(fallback));

const EnvSchema = z
  .object({
    PORT: int(3000, 0, 65535),
    HOST: text('0.0.0.0'),
    LOG_DIR: z.preprocess(blankAsUndefined, z.string().optional()),
    DEBUG_ROUTES: z.preprocess(blankAsUndefined, z.string().optional()),
    SEED: z.preprocess(
      blankAsUndefined,
      z.coerce.number().int().min(0).max(0xffff_ffff).optional(),
    ),

    MAX_ROOMS: int(20),
    MAX_PLAYERS: int(8),
    MAX_PAYLOAD: int(4096),
    RATE_PER_SEC: int(10),
    RATE_BURST: int(20),
    INPUT_RATE_PER_SEC: int(60),
    INPUT_RATE_BURST: int(120),
    SLOW_CLIENT_BYTES: int(64 * 1024),
    JOIN_TIMEOUT_MS: int(5000),
    HEARTBEAT_MS: int(15000),
    EMPTY_ROOM_TTL_MS: int(60_000),
  })
  .transform((env) => ({
    port: env.PORT,
    host: env.HOST,
    logDir: path.resolve(env.LOG_DIR ?? path.join(import.meta.dirname, '../logs')),
    clientDist: path.resolve(import.meta.dirname, '../../client/dist'),
    debugRoutes: env.DEBUG_ROUTES === '1',
    seed: env.SEED ?? null,

    maxRooms: env.MAX_ROOMS,
    maxPlayers: env.MAX_PLAYERS,
    maxPayload: env.MAX_PAYLOAD,
    ratePerSec: env.RATE_PER_SEC,
    rateBurst: env.RATE_BURST,
    inputRatePerSec: env.INPUT_RATE_PER_SEC,
    inputRateBurst: env.INPUT_RATE_BURST,
    slowClientBytes: env.SLOW_CLIENT_BYTES,
    joinTimeoutMs: env.JOIN_TIMEOUT_MS,
    heartbeatMs: env.HEARTBEAT_MS,
    emptyRoomTtlMs: env.EMPTY_ROOM_TTL_MS,
  }));

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(problems.join('; '));
}
