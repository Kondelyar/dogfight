import { loadConfig } from './config.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`config error: ${err.message}`);
  process.exit(1);
}

const app = createApp(config);
const port = await app.start();
console.log(`listening on http://${config.host}:${port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log(`${signal}: shutting down`);
    await app.shutdown();
    process.exit(0);
  });
}
