import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'client',
    // jsdom лише там, де потрібен DOM (лобі, чат); решта тестів не залежить від браузера
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
