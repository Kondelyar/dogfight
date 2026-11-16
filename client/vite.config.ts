import { defineConfig } from 'vite';

// у dev Vite проксує API і WebSocket на Node-сервер (server, порт 3000)
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      // zod ставить /* @__PURE__ */ у місцях, які Rollup не вміє читати: це лише шум у виводі
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
    },
  },
});
