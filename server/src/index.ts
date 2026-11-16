import { loadConfig, type Config } from './config.ts';
import { createLogger } from './logger.ts';
import { installCrashHandlers } from './crash.ts';
import { createApp } from './app.ts';

let config: Config;
try {
  config = loadConfig();
} catch (err: unknown) {
  // логер ще не створено (рівень лежить у конфігу), тому це єдиний рядок JSON у stderr
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'invalid config',
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
}

const log = createLogger(config);
installCrashHandlers(log);

const app = createApp(config, { log });
await app.start();

// SIGTERM шле Docker/хостинг при зупинці й деплої, SIGINT це Ctrl+C. Запускаємо node напряму,
// а не через npm, щоб сигнал дістався саме цьому процесу.
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.once(signal, async () => {
    log.info({ signal }, 'signal received: shutting down');
    // запобіжник: навіть якщо щось зависло, процес не переживе таймаут і не змусить Docker робити SIGKILL
    setTimeout(() => {
      log.error('shutdown timed out: forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs + 1500).unref();
    await app.shutdown();
    process.exit(0);
  });
}
