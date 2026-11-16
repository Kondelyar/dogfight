import path from 'node:path';
import { z } from 'zod';

// Змінні оточення - це теж ввід ззовні: перевіряємо схемою один раз на старті.
// Порожній рядок рахуємо як "не задано" (так зручніше в .env).
const blankAsUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const int = (fallback: number, min = 1, max = 2 ** 31 - 1) =>
  z.preprocess(blankAsUndefined, z.coerce.number().int().min(min).max(max).default(fallback));

const text = (fallback: string) => z.preprocess(blankAsUndefined, z.string().default(fallback));

// "1", "true", "yes" - так; "0", "false", "no" - ні
const flag = (fallback: boolean) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z
      .enum(['1', 'true', 'yes', '0', 'false', 'no'])
      .optional()
      .transform((v) => (v === undefined ? fallback : v === '1' || v === 'true' || v === 'yes')),
  );

// Дозволені Origin: список через кому. Кожен елемент мусить бути коректним origin (схема://хост[:порт]).
const origins = z.preprocess(
  blankAsUndefined,
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const out: string[] = [];
      for (const item of (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        try {
          const url = new URL(item);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
          out.push(url.origin);
        } catch {
          ctx.addIssue({
            code: 'custom',
            message: `"${item}" is not an origin like https://example.com`,
          });
        }
      }
      return out;
    }),
);

const LogLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const EnvSchema = z
  .object({
    PORT: int(3000, 0, 65535),
    HOST: text('0.0.0.0'),
    LOG_DIR: z.preprocess(blankAsUndefined, z.string().optional()),
    LOG_LEVEL: z.preprocess(blankAsUndefined, LogLevel.default('info')),
    DEBUG_ROUTES: z.preprocess(blankAsUndefined, z.string().optional()),
    SEED: z.preprocess(
      blankAsUndefined,
      z.coerce.number().int().min(0).max(0xffff_ffff).optional(),
    ),

    // межі: кімнати, гравці, з'єднання
    MAX_ROOMS: int(20),
    MAX_PLAYERS: int(8), // гравців у кімнаті
    MAX_TOTAL_PLAYERS: int(160), // гравців на весь процес; далі /ready віддає 503
    MAX_CONN_PER_IP: int(10), // одночасних WebSocket з однієї адреси
    MAX_PAYLOAD: int(4096),
    RATE_PER_SEC: int(10),
    RATE_BURST: int(20),
    INPUT_RATE_PER_SEC: int(60),
    INPUT_RATE_BURST: int(120),
    SLOW_CLIENT_BYTES: int(64 * 1024),
    JOIN_TIMEOUT_MS: int(5000),
    HEARTBEAT_MS: int(15000),
    EMPTY_ROOM_TTL_MS: int(60_000),
    SHUTDOWN_TIMEOUT_MS: int(7000, 100, 9000), // менше за 10 с, які Docker дає на stop

    // мережева безпека
    ALLOWED_ORIGINS: origins,
    ALLOW_NO_ORIGIN: flag(true), // не-браузерні клієнти (боти, curl) Origin не шлють
    TRUST_PROXY: flag(false), // брати IP з X-Forwarded-For (лише за довіреним проксі)

    // яка збірка працює (для /health)
    GIT_SHA: text('dev'),
    RENDER_GIT_COMMIT: z.preprocess(blankAsUndefined, z.string().optional()), // sha, який Render задає сам
    APP_VERSION: text('dev'),
  })
  .transform((env) => ({
    port: env.PORT,
    host: env.HOST,
    logDir: path.resolve(env.LOG_DIR ?? path.join(import.meta.dirname, '../logs')),
    logLevel: env.LOG_LEVEL,
    clientDist: path.resolve(import.meta.dirname, '../../client/dist'),
    debugRoutes: env.DEBUG_ROUTES === '1',
    seed: env.SEED ?? null,

    maxRooms: env.MAX_ROOMS,
    maxPlayers: env.MAX_PLAYERS,
    maxTotalPlayers: env.MAX_TOTAL_PLAYERS,
    maxConnPerIp: env.MAX_CONN_PER_IP,
    maxPayload: env.MAX_PAYLOAD,
    ratePerSec: env.RATE_PER_SEC,
    rateBurst: env.RATE_BURST,
    inputRatePerSec: env.INPUT_RATE_PER_SEC,
    inputRateBurst: env.INPUT_RATE_BURST,
    slowClientBytes: env.SLOW_CLIENT_BYTES,
    joinTimeoutMs: env.JOIN_TIMEOUT_MS,
    heartbeatMs: env.HEARTBEAT_MS,
    emptyRoomTtlMs: env.EMPTY_ROOM_TTL_MS,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,

    allowedOrigins: env.ALLOWED_ORIGINS,
    allowNoOrigin: env.ALLOW_NO_ORIGIN,
    trustProxy: env.TRUST_PROXY,

    // образ вшиває GIT_SHA при збірці; якщо там 'dev', беремо sha, який дає хостинг
    gitSha: env.GIT_SHA !== 'dev' ? env.GIT_SHA : (env.RENDER_GIT_COMMIT ?? 'dev'),
    appVersion: env.APP_VERSION,
  }));

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(problems.join('; '));
}
