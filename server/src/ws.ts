import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  CloseCode,
  PROTOCOL_VERSION,
  assertNever,
  codecs,
  encodeServerMessage,
  parseClientMessage,
  type ClientMessage,
} from 'shared';
import type { Config } from './config.ts';
import type { Logger } from './logger.ts';
import type { Metrics } from './metrics.ts';
import { clientIp, isOriginAllowed } from './origin.ts';
import type { Player, Room, RoomManager } from './rooms.ts';
import { createBucket } from './rateLimit.ts';
import { createNetSim, type NetSim } from './netsim.ts';

// ws віддає кадр як Buffer, ArrayBuffer або масив шматків (фрагментація)
function toBuffer(raw: RawData): Buffer {
  if (Array.isArray(raw)) return Buffer.concat(raw);
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return raw;
}

interface SendOptions {
  critical?: boolean;
  unreliable?: boolean;
}

export interface AttachOptions {
  server: HttpServer;
  rooms: RoomManager;
  config: Config;
  log: Logger;
  metrics: Metrics;
  isShuttingDown: () => boolean;
}

export interface Gateway {
  wss: WebSocketServer;
  /** скільки WebSocket зараз відкрито */
  connections(): number;
  /** шле всім `shutdown`, закриває сокети кодом 1001 і чекає, поки вони закриються (або timeout) */
  closeAll(reason: string, timeoutMs: number): Promise<void>;
}

// Відмова на рукостисканні: це ще звичайний HTTP, тож відповідаємо статусом і рвемо з'єднання.
function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocket({
  server,
  rooms,
  config,
  log,
  metrics,
  isShuttingDown,
}: AttachOptions): Gateway {
  // noServer: рукостискання (Origin, ліміт з одного IP) перевіряємо самі, до handleUpgrade
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayload });
  const missedPongs = new WeakMap<WebSocket, number>();
  const perIp = new Map<string, number>();

  // повільному клієнту некритичне просто не шлемо, зовсім мертвого - закриваємо.
  // Усе, що йде клієнту, проходить через емулятор мережі.
  function send(
    socket: WebSocket,
    net: NetSim,
    data: string | ArrayBuffer,
    { critical = false, unreliable = false }: SendOptions = {},
  ): void {
    net.outbound(
      () => {
        if (socket.readyState !== socket.OPEN) return;
        const buffered = socket.bufferedAmount;
        if (buffered > config.slowClientBytes * 4) {
          socket.close(CloseCode.SLOW_CLIENT, 'too slow');
          return;
        }
        if (buffered > config.slowClientBytes && !critical) return;
        metrics.messagesOut += 1;
        metrics.bytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
        socket.send(data);
      },
      { unreliable },
    );
  }

  function onConnection(socket: WebSocket, req: IncomingMessage, ip: string): void {
    const connLog = log.child({ conn: randomUUID().slice(0, 8), ip });
    let joined: { room: Room; player: Player; log: Logger } | null = null;
    missedPongs.set(socket, 0);
    metrics.connectionsTotal += 1;

    // ?lag=100&jitter=30&drop=0.02 у адресі сокета вмикає емулятор одразу
    const net = createNetSim();
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    net.set({
      baseMs: query.get('lag'),
      jitterMs: query.get('jitter'),
      drop: query.get('drop'),
    });

    const bucket = createBucket({ perSecond: config.ratePerSec, burst: config.rateBurst });
    const inputBucket = createBucket({
      perSecond: config.inputRatePerSec,
      burst: config.inputRateBurst,
    });
    const joinTimer = setTimeout(() => {
      connLog.warn('join timeout');
      socket.close(CloseCode.JOIN_TIMEOUT, 'join timeout');
    }, config.joinTimeoutMs);

    // Закриття з гарантією: клієнт, що не відповідає на close-рукостискання (зловмисник, що далі
    // шле сміття), не висітиме 30 с, а буде обірваний за секунду.
    function closeHard(code: number, reason: string): void {
      socket.close(code, reason);
      setTimeout(() => socket.terminate(), 1000).unref();
    }

    function reject(reason: string): void {
      (joined?.log ?? connLog).warn({ reason }, 'closing socket: bad message');
      metrics.badFrames += 1;
      closeHard(CloseCode.BAD_MESSAGE, reason);
    }

    function onJoin(msg: Extract<ClientMessage, { type: 'join' }>): void {
      if (joined) return reject('already joined');

      const room = rooms.get(msg.room);
      if (!room) {
        connLog.info({ room: msg.room }, 'join refused: no such room');
        return socket.close(CloseCode.NO_ROOM, 'no such room');
      }
      if (rooms.totalPlayers() >= config.maxTotalPlayers) {
        connLog.warn({ room: room.id }, 'join refused: server is full');
        return socket.close(CloseCode.ROOM_FULL, 'server full');
      }

      const player: Player = {
        id: randomUUID(),
        name: msg.name,
        codec: msg.codec,
        send: (data, critical) => send(socket, net, data, { critical: critical ?? false }),
        sendState: (data) => send(socket, net, data, { unreliable: true }),
      };
      if (!room.join(player)) {
        connLog.info({ room: room.id }, 'join refused: room full');
        return socket.close(CloseCode.ROOM_FULL, 'room full');
      }

      clearTimeout(joinTimer);
      joined = { room, player, log: connLog.child({ room: room.id, player: player.id }) };
    }

    function dispatch(msg: ClientMessage): void {
      if (socket.readyState !== socket.OPEN) return;

      switch (msg.type) {
        case 'join':
          return onJoin(msg);
        case 'ping':
          return send(socket, net, encodeServerMessage({ type: 'pong', t: msg.t }), {
            critical: true,
          });
        case 'lag':
          return net.set(msg);
        case 'input':
          if (!joined) return reject('join first');
          return void joined.room.emit('input', joined.player, msg);
        case 'chat':
          if (!joined) return reject('join first');
          return joined.room.chat(joined.player, msg.text);
        default:
          return assertNever(msg);
      }
    }

    socket.on('message', (raw, isBinary) => {
      if (socket.readyState !== socket.OPEN) return;

      const frame = toBuffer(raw);
      metrics.messagesIn += 1;
      metrics.bytesIn += frame.length;

      let msg: ClientMessage;
      if (isBinary) {
        // бінарні кадри бувають лише інпутами; декодер сам перевіряє довжину, версію і діапазони
        const decoded = codecs.binary.decodeInput(frame);
        if (!decoded.ok) return reject(decoded.error);
        msg = { v: PROTOCOL_VERSION, type: 'input', ...decoded.value };
      } else {
        const parsed = parseClientMessage(frame.toString('utf8'));
        if (!parsed.ok) return reject(parsed.error);
        msg = parsed.value;
      }

      const limiter = msg.type === 'input' ? inputBucket : bucket;
      if (!limiter.take()) {
        (joined?.log ?? connLog).warn({ type: msg.type }, 'rate limit exceeded: closing socket');
        return closeHard(CloseCode.RATE_LIMIT, 'rate limit');
      }

      // інпути (як і знімки) ненадійні: емулятор може їх загубити
      net.inbound(() => dispatch(msg), { unreliable: msg.type === 'input' });
    });

    socket.on('pong', () => {
      missedPongs.set(socket, 0);
    });

    socket.on('error', (err) => {
      connLog.warn({ err }, 'socket error');
    });

    socket.on('close', (code) => {
      clearTimeout(joinTimer);
      joined?.room.leave(joined.player.id);
      (joined?.log ?? connLog).info({ code }, 'connection closed');
    });
  }

  // ---------- Рукостискання: шлях, зупинка, Origin, ліміт з одного IP ----------
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', (err) => log.debug({ err }, 'upgrade socket error'));

    const origin = req.headers.origin;
    const ip = clientIp(req, config.trustProxy);
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (path !== '/ws') return refuse(socket, 404, 'Not Found');
    if (isShuttingDown()) return refuse(socket, 503, 'Service Unavailable');

    if (!isOriginAllowed(origin, req.headers.host, config)) {
      metrics.rejected += 1;
      log.warn({ ip, origin: origin ?? null, reason: 'origin' }, 'websocket handshake refused');
      return refuse(socket, 403, 'Forbidden');
    }

    const open = perIp.get(ip) ?? 0;
    if (open >= config.maxConnPerIp) {
      metrics.rejected += 1;
      log.warn(
        { ip, open, limit: config.maxConnPerIp, reason: 'ip-limit' },
        'websocket handshake refused',
      );
      return refuse(socket, 429, 'Too Many Requests');
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      ws.once('close', () => {
        const left = (perIp.get(ip) ?? 1) - 1;
        if (left <= 0) perIp.delete(ip);
        else perIp.set(ip, left);
      });
      onConnection(ws, req, ip);
    });
  });

  wss.on('error', (err) => log.error({ err }, 'websocket server error'));

  // ping кожні heartbeatMs; хто не відповів на два - вважаємо мертвим
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const missed = missedPongs.get(socket) ?? 0;
      if (missed >= 2) {
        socket.terminate();
        continue;
      }
      missedPongs.set(socket, missed + 1);
      socket.ping();
    }
  }, config.heartbeatMs);
  wss.on('close', () => clearInterval(heartbeat));

  async function closeAll(reason: string, timeoutMs: number): Promise<void> {
    const notice = encodeServerMessage({ type: 'shutdown', reason });
    const closing: Promise<void>[] = [];

    for (const socket of wss.clients) {
      closing.push(
        new Promise<void>((resolve) => {
          socket.once('close', () => resolve());
          if (socket.readyState === socket.OPEN) {
            socket.send(notice);
            socket.close(CloseCode.SHUTDOWN, reason);
          } else if (socket.readyState === socket.CLOSED) {
            resolve();
          }
        }),
      );
    }

    // клієнт, що не підтвердив закриття за timeoutMs, обривається силою
    const timer = setTimeout(() => {
      for (const socket of wss.clients) socket.terminate();
    }, timeoutMs);
    await Promise.all(closing);
    clearTimeout(timer);
    wss.close();
  }

  return { wss, connections: () => wss.clients.size, closeAll };
}
