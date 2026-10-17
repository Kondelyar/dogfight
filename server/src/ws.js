import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { CloseCode, parse, validate } from './protocol.js';
import { createBucket } from './rateLimit.js';

export function attachWebSocket({ server, rooms, config }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxPayload });

  // повільному клієнту некритичне просто не шлемо, зовсім мертвого - закриваємо
  function send(socket, data, critical) {
    if (socket.readyState !== socket.OPEN) return;
    const buffered = socket.bufferedAmount;
    if (buffered > config.slowClientBytes * 4) {
      socket.close(CloseCode.SLOW_CLIENT, 'too slow');
      return;
    }
    if (buffered > config.slowClientBytes && !critical) return;
    socket.send(data);
  }

  function onConnection(socket) {
    socket.player = null;
    socket.room = null;
    socket.missedPongs = 0;

    const bucket = createBucket({ perSecond: config.ratePerSec, burst: config.rateBurst });
    const joinTimer = setTimeout(
      () => socket.close(CloseCode.JOIN_TIMEOUT, 'join timeout'),
      config.joinTimeoutMs,
    );

    function reject(reason) {
      console.warn(`[ws] closing socket: ${reason}`);
      socket.close(CloseCode.BAD_MESSAGE, reason);
    }

    function onJoin(msg) {
      if (socket.room) return reject('already joined');

      const room = rooms.get(msg.room);
      if (!room) return socket.close(CloseCode.NO_ROOM, 'no such room');

      const player = {
        id: randomUUID(),
        name: msg.name,
        send: (data, critical) => send(socket, data, critical),
      };
      if (!room.join(player)) return socket.close(CloseCode.ROOM_FULL, 'room full');

      clearTimeout(joinTimer);
      socket.player = player;
      socket.room = room;
    }

    socket.on('message', (data, isBinary) => {
      if (socket.readyState !== socket.OPEN) return;
      if (isBinary) return reject('binary frames not supported');
      if (!bucket.take()) return socket.close(CloseCode.RATE_LIMIT, 'rate limit');

      const result = validate(parse(data.toString()));
      if (!result.ok) return reject(result.reason);

      const msg = result.msg;
      if (msg.type === 'join') return onJoin(msg);
      if (!socket.room) return reject('join first');
      socket.room.chat(socket.player, msg.text);
    });

    socket.on('pong', () => {
      socket.missedPongs = 0;
    });

    socket.on('error', (err) => {
      console.warn(`[ws] socket error: ${err.message}`);
    });

    socket.on('close', () => {
      clearTimeout(joinTimer);
      socket.room?.leave(socket.player.id);
    });
  }

  wss.on('connection', onConnection);
  wss.on('error', (err) => console.error('[ws] server error:', err));

  // ping кожні heartbeatMs; хто не відповів на два - вважаємо мертвим
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.missedPongs >= 2) {
        socket.terminate();
        continue;
      }
      socket.missedPongs += 1;
      socket.ping();
    }
  }, config.heartbeatMs);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
