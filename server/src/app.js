import http from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { CloseCode } from './protocol.js';
import { RoomManager } from './rooms.js';
import { attachWebSocket } from './ws.js';
import { serveStatic } from './static.js';
import { startMatchLog } from './log/matchlog.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// тіло читаємо шматками й не тримаємо в пам'яті більше за limit
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) {
      req.resume();
      return reject(new HttpError(413, 'payload too large'));
    }

    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'payload too large'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid json'));
      }
    });
    req.on('error', reject);
  });
}

export function createApp(config) {
  const rooms = new RoomManager({
    maxRooms: config.maxRooms,
    maxPlayers: config.maxPlayers,
    emptyTtlMs: config.emptyRoomTtlMs,
  });

  const logs = new Map();
  const flushing = new Set();

  rooms.on('created', (room) => {
    const log = startMatchLog(room, config.logDir);
    logs.set(room.id, log);
    flushing.add(log.done);
    log.done
      .catch((err) => console.error(`[matchlog] ${room.id}: ${err.message}`))
      .finally(() => flushing.delete(log.done));
  });
  rooms.on('deleted', (room) => {
    logs.get(room.id)?.stop();
    logs.delete(room.id);
  });

  async function createRoom(req, res) {
    const body = await readJson(req, 1024);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 32) throw new HttpError(400, 'name must be 1..32 chars');

    const room = rooms.create(name);
    if (!room) throw new HttpError(429, 'too many rooms');
    sendJson(res, 201, { room: room.info() });
  }

  async function sendReplay(res, id) {
    const file = path.join(config.logDir, `${id}.ndjson`);
    try {
      await stat(file);
    } catch {
      throw new HttpError(404, 'replay not found');
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    // pipeline сам чекає drain і прибирає за собою, якщо клієнт обірвав завантаження
    await pipeline(createReadStream(file), res).catch(() => {});
  }

  // тільки для демонстрацій у README (DEBUG_ROUTES=1)
  function debugRoute(pathname, url, res) {
    if (pathname === '/api/slow') {
      const end = Date.now() + 300;
      while (Date.now() < end) {
        // навмисний busy-wait: весь сервер стоїть
      }
      return sendJson(res, 200, { blocked: '300ms' });
    }

    if (pathname === '/api/crash') {
      const fixed = url.searchParams.get('fixed') === '1';
      if (url.searchParams.get('mode') === 'promise') {
        const failing = Promise.reject(new Error('boom (promise)'));
        if (fixed) failing.catch((err) => console.warn(`handled: ${err.message}`));
      } else {
        const emitter = new EventEmitter();
        if (fixed) emitter.on('error', (err) => console.warn(`handled: ${err.message}`));
        setImmediate(() => emitter.emit('error', new Error('boom (emitter)')));
      }
      return sendJson(res, 200, { triggered: true, fixed });
    }
    return false;
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        uptime: Math.round(process.uptime()),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        rooms: rooms.size,
      });
    }

    if (pathname === '/api/rooms') {
      if (req.method === 'GET') return sendJson(res, 200, { rooms: rooms.list() });
      if (req.method === 'POST') return createRoom(req, res);
      throw new HttpError(405, 'method not allowed');
    }

    const replay = pathname.match(/^\/api\/replays\/([\w-]+)$/);
    if (replay && req.method === 'GET') return sendReplay(res, replay[1]);

    if (config.debugRoutes && debugRoute(pathname, url, res) !== false) return;

    if (pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
    return serveStatic(req, res, pathname, config.clientDist);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('[http] unexpected error:', err);
      if (res.headersSent) return res.destroy();
      sendJson(res, err.status ?? 500, { error: err.status ? err.message : 'internal error' });
    }
  });

  const wss = attachWebSocket({ server, rooms, config });

  function start() {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve(server.address().port);
      });
    });
  }

  let shuttingDown = null;

  function shutdown() {
    shuttingDown ??= (async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections();

      for (const socket of wss.clients) socket.close(CloseCode.SHUTDOWN, 'server shutting down');
      wss.close();

      rooms.closeAll(); // зупиняє логи матчів
      await Promise.allSettled([...flushing]); // дописуємо логи на диск
      await Promise.race([closed, sleep(3000)]);
    })();
    return shuttingDown;
  }

  return { server, wss, rooms, start, shutdown };
}
