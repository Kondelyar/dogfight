import http from 'node:http';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CloseCode, CreateRoomRequestSchema } from 'shared';
import type { Config } from './config.ts';
import { RoomManager } from './rooms.ts';
import { Match } from './match.ts';
import { attachWebSocket } from './ws.ts';
import { serveStatic } from './static.ts';
import { startMatchLog, type MatchLog } from './log/matchlog.ts';

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// тіло читаємо шматками й не тримаємо в пам'яті більше за limit
function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) {
      req.resume();
      return reject(new HttpError(413, 'payload too large'));
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk: Buffer) => {
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
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body);
      } catch {
        reject(new HttpError(400, 'invalid json'));
      }
    });
    req.on('error', reject);
  });
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createApp(config: Config) {
  const rooms = new RoomManager({
    maxRooms: config.maxRooms,
    maxPlayers: config.maxPlayers,
    emptyTtlMs: config.emptyRoomTtlMs,
  });

  const logs = new Map<string, MatchLog>();
  const matches = new Map<string, Match>();
  const flushing = new Set<Promise<void>>();

  rooms.on('created', (room) => {
    const log = startMatchLog(room, config.logDir);
    logs.set(room.id, log);
    flushing.add(log.done);
    log.done
      .catch((err: unknown) => console.error(`[matchlog] ${room.id}: ${errorMessage(err)}`))
      .finally(() => flushing.delete(log.done));

    matches.set(room.id, new Match(room, { seed: config.seed ?? randomInt(2 ** 32) }));
  });
  rooms.on('deleted', (room) => {
    logs.get(room.id)?.stop();
    logs.delete(room.id);
    matches.get(room.id)?.stop();
    matches.delete(room.id);
  });

  async function createRoom(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = CreateRoomRequestSchema.safeParse(await readJson(req, 1024));
    if (!body.success) throw new HttpError(400, 'name must be 1..32 chars');

    const room = rooms.create(body.data.name);
    if (!room) throw new HttpError(429, 'too many rooms');
    sendJson(res, 201, { room: room.info() });
  }

  async function sendReplay(res: ServerResponse, id: string): Promise<void> {
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
  function debugRoute(pathname: string, url: URL, res: ServerResponse): boolean {
    if (pathname === '/api/slow') {
      const end = Date.now() + 300;
      while (Date.now() < end) {
        // навмисний busy-wait: весь сервер стоїть
      }
      sendJson(res, 200, { blocked: '300ms' });
      return true;
    }

    if (pathname === '/api/crash') {
      const fixed = url.searchParams.get('fixed') === '1';
      if (url.searchParams.get('mode') === 'promise') {
        const failing = Promise.reject(new Error('boom (promise)'));
        if (fixed) failing.catch((err: unknown) => console.warn(`handled: ${errorMessage(err)}`));
      } else {
        const emitter = new EventEmitter();
        if (fixed)
          emitter.on('error', (err: unknown) => console.warn(`handled: ${errorMessage(err)}`));
        setImmediate(() => emitter.emit('error', new Error('boom (emitter)')));
      }
      sendJson(res, 200, { triggered: true, fixed });
      return true;
    }
    return false;
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;

    if (pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        uptime: Math.round(process.uptime()),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        rooms: rooms.size,
      });
    }

    // тривалість тіка, jitter інтервалу і кількість перевищень по кожній активній кімнаті
    if (pathname === '/api/stats' && req.method === 'GET') {
      return sendJson(res, 200, { rooms: [...matches.values()].map((m) => m.stats()) });
    }

    if (pathname === '/api/rooms') {
      if (req.method === 'GET') return sendJson(res, 200, { rooms: rooms.list() });
      if (req.method === 'POST') return createRoom(req, res);
      throw new HttpError(405, 'method not allowed');
    }

    const replay = pathname.match(/^\/api\/replays\/([\w-]+)$/);
    const replayId = replay?.[1];
    if (replayId && req.method === 'GET') return sendReplay(res, replayId);

    if (config.debugRoutes && debugRoute(pathname, url, res)) return;

    if (pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
    return serveStatic(req, res, pathname, config.clientDist);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err: unknown) {
      if (!(err instanceof HttpError)) console.error('[http] unexpected error:', err);
      if (res.headersSent) return void res.destroy();
      const known = err instanceof HttpError;
      sendJson(res, known ? err.status : 500, { error: known ? err.message : 'internal error' });
    }
  });

  const wss = attachWebSocket({ server, rooms, config });

  function start(): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : config.port);
      });
    });
  }

  let shuttingDown: Promise<void> | null = null;

  function shutdown(): Promise<void> {
    shuttingDown ??= (async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();

      for (const socket of wss.clients) socket.close(CloseCode.SHUTDOWN, 'server shutting down');
      wss.close();

      rooms.closeAll(); // зупиняє матчі й логи
      await Promise.allSettled([...flushing]); // дописуємо логи на диск
      await Promise.race([closed, sleep(3000)]);
    })();
    return shuttingDown;
  }

  return { server, wss, rooms, start, shutdown };
}

export type App = ReturnType<typeof createApp>;
