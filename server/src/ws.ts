import { randomUUID } from 'node:crypto';
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
}

export function attachWebSocket({ server, rooms, config }: AttachOptions): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxPayload });
  const missedPongs = new WeakMap<WebSocket, number>();

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
        socket.send(data);
      },
      { unreliable },
    );
  }

  function onConnection(socket: WebSocket, req: IncomingMessage): void {
    let joined: { room: Room; player: Player } | null = null;
    missedPongs.set(socket, 0);

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
    const joinTimer = setTimeout(
      () => socket.close(CloseCode.JOIN_TIMEOUT, 'join timeout'),
      config.joinTimeoutMs,
    );

    function reject(reason: string): void {
      console.warn(`[ws] closing socket: ${reason}`);
      socket.close(CloseCode.BAD_MESSAGE, reason);
    }

    function onJoin(msg: Extract<ClientMessage, { type: 'join' }>): void {
      if (joined) return reject('already joined');

      const room = rooms.get(msg.room);
      if (!room) return socket.close(CloseCode.NO_ROOM, 'no such room');

      const player: Player = {
        id: randomUUID(),
        name: msg.name,
        codec: msg.codec,
        send: (data, critical) => send(socket, net, data, { critical: critical ?? false }),
        sendState: (data) => send(socket, net, data, { unreliable: true }),
      };
      if (!room.join(player)) return socket.close(CloseCode.ROOM_FULL, 'room full');

      clearTimeout(joinTimer);
      joined = { room, player };
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

      let msg: ClientMessage;
      if (isBinary) {
        // бінарні кадри бувають лише інпутами; декодер сам перевіряє довжину, версію і діапазони
        const decoded = codecs.binary.decodeInput(toBuffer(raw));
        if (!decoded.ok) return reject(decoded.error);
        msg = { v: PROTOCOL_VERSION, type: 'input', ...decoded.value };
      } else {
        const parsed = parseClientMessage(toBuffer(raw).toString('utf8'));
        if (!parsed.ok) return reject(parsed.error);
        msg = parsed.value;
      }

      const limiter = msg.type === 'input' ? inputBucket : bucket;
      if (!limiter.take()) return socket.close(CloseCode.RATE_LIMIT, 'rate limit');

      // інпути (як і знімки) ненадійні: емулятор може їх загубити
      net.inbound(() => dispatch(msg), { unreliable: msg.type === 'input' });
    });

    socket.on('pong', () => {
      missedPongs.set(socket, 0);
    });

    socket.on('error', (err) => {
      console.warn(`[ws] socket error: ${err.message}`);
    });

    socket.on('close', () => {
      clearTimeout(joinTimer);
      joined?.room.leave(joined.player.id);
    });
  }

  wss.on('connection', onConnection);
  wss.on('error', (err) => console.error('[ws] server error:', err));

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

  return wss;
}
