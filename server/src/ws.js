import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { codecs, validateInput } from 'shared';
import { CloseCode, encode, parse, validate } from './protocol.js';
import { createBucket } from './rateLimit.js';
import { createNetSim } from './netsim.js';

export function attachWebSocket({ server, rooms, config }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxPayload });

  // повільному клієнту некритичне просто не шлемо, зовсім мертвого - закриваємо.
  // Усе, що йде клієнту, проходить через емулятор мережі.
  function send(socket, net, data, { critical = false, unreliable = false } = {}) {
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

  function onConnection(socket, req) {
    socket.player = null;
    socket.room = null;
    socket.missedPongs = 0;

    // ?lag=100&jitter=30&drop=0.02 у адресі сокета вмикає емулятор одразу
    const net = createNetSim();
    const query = new URL(req.url, 'http://localhost').searchParams;
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
        codec: msg.codec,
        send: (data, critical) => send(socket, net, data, { critical }),
        sendState: (data) => send(socket, net, data, { unreliable: true }),
      };
      if (!room.join(player)) return socket.close(CloseCode.ROOM_FULL, 'room full');

      clearTimeout(joinTimer);
      socket.player = player;
      socket.room = room;
    }

    function dispatch(msg) {
      if (socket.readyState !== socket.OPEN) return;

      if (msg.type === 'join') return onJoin(msg);
      if (msg.type === 'ping') {
        return send(socket, net, encode('pong', { t: msg.t }), { critical: true });
      }
      if (msg.type === 'lag') return net.set(msg);

      if (!socket.room) return reject('join first');
      if (msg.type === 'input') return socket.room.emit('input', socket.player, msg);
      socket.room.chat(socket.player, msg.text);
    }

    socket.on('message', (data, isBinary) => {
      if (socket.readyState !== socket.OPEN) return;

      let msg;
      if (isBinary) {
        // бінарні кадри бувають лише інпутами
        const decoded = codecs.binary.decodeInput(data);
        const checked = decoded
          ? validateInput(decoded)
          : { ok: false, reason: 'bad binary frame' };
        if (!checked.ok) return reject(checked.reason);
        msg = { type: 'input', ...checked.input };
      } else {
        const result = validate(parse(data.toString()));
        if (!result.ok) return reject(result.reason);
        msg = result.msg;
      }

      const limiter = msg.type === 'input' ? inputBucket : bucket;
      if (!limiter.take()) return socket.close(CloseCode.RATE_LIMIT, 'rate limit');

      // інпути (як і знімки) ненадійні: емулятор може їх загубити
      net.inbound(() => dispatch(msg), { unreliable: msg.type === 'input' });
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
