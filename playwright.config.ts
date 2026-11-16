import { defineConfig } from '@playwright/test';

const PORT = 3300;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
  // справжній сервер зі збудованим клієнтом: той самий код, що в проді
  webServer: {
    command: 'npm run build && node server/src/index.ts',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: { PORT: String(PORT), HOST: '127.0.0.1', MAX_ROOMS: '20', LOG_DIR: 'server/logs/e2e' },
  },
});
