import pino, { type Logger } from 'pino';
import type { Config } from './config.ts';

export type { Logger };

// Логи - це рядки JSON у stdout (їх збирає Docker/хостинг). id кімнати і гравця додаються через
// child-логери. Секрети ніколи не потрапляють у лог: ми не логуємо конфіг цілком, а на випадок
// помилки в майбутньому pino ще й затирає типові поля.
export const REDACT_PATHS = [
  'password',
  'token',
  'apiKey',
  'secret',
  'authorization',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(
  config: Pick<Config, 'logLevel' | 'gitSha'>,
  destination?: pino.DestinationStream,
): Logger {
  const options: pino.LoggerOptions = {
    level: config.logLevel,
    base: { sha: config.gitSha },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    // у вихід іде рівень словом ("info"), а не числом: так зручніше шукати в логах
    formatters: { level: (label) => ({ level: label }) },
  };
  return destination ? pino(options, destination) : pino(options);
}
