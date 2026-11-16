import type { Logger } from './logger.ts';

// Мінімум, потрібний від process: підписка на події і вихід. Так функцію можна перевірити в тесті,
// не вбиваючи справжній процес.
export interface ProcessLike {
  on(event: 'uncaughtException', listener: (err: Error) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  exit(code: number): never | void;
}

// Необроблена помилка означає, що стан процесу невідомий. Порожній обробник приховав би це і
// залишив би сервер у напівзламаному вигляді, тому: пишемо в лог з усім стеком і завершуємо
// процес з ненульовим кодом (контейнер перезапустить оркестратор).
export function installCrashHandlers(log: Logger, proc: ProcessLike = process): void {
  let dying = false;

  const die = (kind: string, error: unknown): void => {
    if (dying) return;
    dying = true;
    log.fatal({ err: error, kind }, 'unhandled error: shutting down');
    // pino пише в stdout синхронно, тож запис уже в потоці; виходимо
    proc.exit(1);
  };

  proc.on('uncaughtException', (err) => die('uncaughtException', err));
  proc.on('unhandledRejection', (reason) => die('unhandledRejection', reason));
}
