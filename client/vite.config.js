// у dev Vite проксує API і WebSocket на Node-сервер (server, порт 3000)
export default {
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
};
