import http from 'node:http';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CreateRoomRequestSchema } from 'shared';
import type { Config } from './config.ts';
import { createLogger, type Logger } from './logger.ts';
import { Metrics } from './metrics.ts';
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
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
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

export interface AppDeps {
  log?: Logger;
}

export function createApp(config: Config, deps: AppDeps = {}) {
  const log = deps.log ?? createLogger(config);
  const rooms = new RoomManager({
    maxRooms: config.maxRooms,
    maxPlayers: config.maxPlayers,
    emptyTtlMs: config.emptyRoomTtlMs,
  });

  const logs = new Map<string, MatchLog>();
  const matches = new Map<string, Match>();
  const flushing = new Set<Promise<void>>();
  let shuttingDown: Promise<void> | null = null;
  let stopping = false;

  // найгірші значення кроку серед усіх кімнат: для /metrics
  const worstTick = () => {
    const all = [...matches.values()].map((m) => m.stats());
    const pick = (f: (s: (typeof all)[number]) => number): number => Math.max(0, ...all.map(f));
    return {
      avg: pick((s) => s.tickMs.avg),
      p50: pick((s) => s.tickMs.p50),
      p95: pick((s) => s.tickMs.p95),
      p99: pick((s) => s.tickMs.p99),
      max: pick((s) => s.tickMs.max),
    };
  };

  const metrics = new Metrics({
    players: () => rooms.totalPlayers(),
    rooms: () => rooms.size,
    connections: () => gateway.connections(),
    tickMs: worstTick,
    overruns: () => Math.max(0, ...[...matches.values()].map((m) => m.stats().overruns)),
  });

  rooms.on('created', (room) => {
    const roomLog = log.child({ room: room.id });
    roomLog.info({ name: room.name }, 'room created');

    const matchLog = startMatchLog(room, config.logDir);
    logs.set(room.id, matchLog);
    flushing.add(matchLog.done);
    matchLog.done
      .catch((err: unknown) => roomLog.error({ err }, 'match log failed'))
      .finally(() => flushing.delete(matchLog.done));

    room.on('join', (player) =>
      roomLog.info({ player: player.id, name: player.name, players: room.size }, 'player joined'),
    );
    room.on('leave', (player) =>
      roomLog.info({ player: player.id, name: player.name, players: room.size }, 'player left'),
    );

    matches.set(room.id, new Match(room, { seed: config.seed ?? randomInt(2 ** 32) }));
  });
  rooms.on('deleted', (room) => {
    log.child({ room: room.id }).info('room closed');
    logs.get(room.id)?.stop();
    logs.delete(room.id);
    matches.get(room.id)?.stop();
    matches.delete(room.id);
  });

  async function createRoom(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (stopping) throw new HttpError(503, 'shutting down');
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
        if (fixed) failing.catch((err: unknown) => log.warn(`handled: ${errorMessage(err)}`));
      } else {
        const emitter = new EventEmitter();
        if (fixed) {
          emitter.on('error', (err: unknown) => log.warn(`handled: ${errorMessage(err)}`));
        }
        setImmediate(() => emitter.emit('error', new Error('boom (emitter)')));
      }
      sendJson(res, 200, { triggered: true, fixed });
      return true;
    }
    return false;
  }

  // /ready: чи може процес прийняти нового гравця. /health: чи процес взагалі живий.
  function readiness(): { ready: boolean; reason?: string } {
    if (stopping) return { ready: false, reason: 'shutting_down' };
    if (rooms.totalPlayers() >= config.maxTotalPlayers) return { ready: false, reason: 'full' };
    return { ready: true };
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;

    if (pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        sha: config.gitSha,
        version: config.appVersion,
        uptime: Math.round(process.uptime()),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        rooms: rooms.size,
      });
    }

    if (pathname === '/ready' && req.method === 'GET') {
      const state = readiness();
      return sendJson(res, state.ready ? 200 : 503, {
        ...state,
        players: rooms.totalPlayers(),
        rooms: rooms.size,
      });
    }

    if (pathname === '/metrics' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return void res.end(metrics.render());
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
      if (!(err instanceof HttpError)) log.error({ err, url: req.url }, 'unexpected http error');
      if (res.headersSent) return void res.destroy();
      const known = err instanceof HttpError;
      sendJson(res, known ? err.status : 500, { error: known ? err.message : 'internal error' });
    }
  });

  const gateway = attachWebSocket({
    server,
    rooms,
    config,
    log,
    metrics,
    isShuttingDown: () => stopping,
  });

  function start(): Promise<number> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        metrics.start();
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : config.port;
        log.info({ host: config.host, port, version: config.appVersion }, 'server listening');
        resolve(port);
      });
    });
  }

  // Коректна зупинка (SIGTERM): перестаємо приймати з'єднання, кажемо клієнтам `shutdown`,
  // закриваємо сокети кодом 1001, дописуємо логи. Укладаємось у shutdownTimeoutMs (< 10 с Docker).
  function shutdown(): Promise<void> {
    shuttingDown ??= (async () => {
      const started = Date.now();
      stopping = true; // /ready тепер 503, нові рукостискання 503
      log.info(
        { players: rooms.totalPlayers(), rooms: rooms.size, connections: gateway.connections() },
        'shutdown: not accepting new connections',
      );

      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections();

      await gateway.closeAll('server shutting down', Math.floor(config.shutdownTimeoutMs / 2));
      log.info({ ms: Date.now() - started }, 'shutdown: websockets closed with code 1001');

      rooms.closeAll(); // зупиняє матчі й логи
      await Promise.allSettled([...flushing]); // дописуємо логи на диск
      metrics.stop();

      const left = Math.max(0, config.shutdownTimeoutMs - (Date.now() - started));
      await Promise.race([closed, sleep(left)]);
      server.closeAllConnections(); // якщо хтось ще висить на HTTP
      log.info({ ms: Date.now() - started }, 'shutdown: complete');
    })();
    return shuttingDown;
  }

  return { server, wss: gateway.wss, rooms, metrics, log, start, shutdown };
}

export type App = ReturnType<typeof createApp>;
