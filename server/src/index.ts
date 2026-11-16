import { loadConfig, type Config } from './config.ts';
import { createApp } from './app.ts';

let config: Config;
try {
  config = loadConfig();
} catch (err: unknown) {
  console.error(`config error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
const app = createApp(config);
const port = await app.start();
console.log(`listening on http://${config.host}:${port}`);

for (const signal of signals) {
  process.once(signal, async () => {
    console.log(`${signal}: shutting down`);
    await app.shutdown();
    process.exit(0);
  });
}
