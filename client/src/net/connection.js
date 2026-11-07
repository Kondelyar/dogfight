import { codecs } from 'shared';

const PROTOCOL_VERSION = 1;
// після цих кодів сервер свідомо відмовив - перепідключатись марно
// (дзеркало server/src/protocol.js)
const FINAL_CLOSE_CODES = new Set([4000, 4002, 4005]);
const MAX_QUEUE = 50;
const utf8 = new TextEncoder();

export class Connection extends EventTarget {
  #url;
  #socket = null;
  #queue = [];
  #attempt = 0;
  #timer = null;
  #closed = false;
  bytesIn = 0;
  bytesOut = 0;

  constructor(url) {
    super();
    this.#url = url;
  }

  connect() {
    this.#timer = null;
    const socket = new WebSocket(this.#url);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#emit('open'); // слухач тут шле join: сокет уже відкритий, тож іде без черги
      for (const data of this.#queue.splice(0)) this.#transmit(data);
    });

    socket.addEventListener('message', (e) => this.#onMessage(e.data));

    // у браузері після error завжди йде close, але не скрізь (наприклад, Node),
    // тому reconnect запускаємо з обох подій; другий виклик ігнорується
    socket.addEventListener('error', () => {
      if (socket === this.#socket) this.#reconnectLater();
    });

    socket.addEventListener('close', (e) => {
      if (socket !== this.#socket) return;
      this.#emit('close', { code: e.code });
      if (!FINAL_CLOSE_CODES.has(e.code)) this.#reconnectLater();
    });
  }

  #onMessage(data) {
    if (typeof data === 'string') {
      this.bytesIn += utf8.encode(data).length;
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (typeof msg?.type === 'string') this.#emit(msg.type, msg);
      return;
    }

    this.bytesIn += data.byteLength;
    const snapshot = codecs.binary.decodeSnapshot(data);
    if (snapshot) this.#emit('snapshot', snapshot);
  }

  get isOpen() {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  #transmit(data) {
    this.bytesOut += typeof data === 'string' ? utf8.encode(data).length : data.byteLength;
    this.#socket.send(data);
  }

  // керівні повідомлення (join, chat, ping...): чекають у черзі, поки сокет не відкрився
  send(message) {
    const data = JSON.stringify({ v: PROTOCOL_VERSION, ...message });
    if (this.isOpen) return this.#transmit(data);
    if (this.#queue.length < MAX_QUEUE) this.#queue.push(data);
  }

  // інпути не чекають у черзі: застарілий інпут після reconnect нікому не потрібен
  sendInput(input, codec) {
    if (!this.isOpen) return;
    this.#transmit(codecs[codec].encodeInput(input));
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#socket?.close();
  }

  // експоненційний backoff з jitter: 0.5с, 1с, 2с ... до 10с
  #reconnectLater() {
    if (this.#closed || this.#timer) return;
    const delay = Math.min(10_000, 500 * 2 ** this.#attempt) * (0.5 + Math.random() * 0.5);
    this.#attempt += 1;
    this.#timer = setTimeout(() => this.connect(), delay);
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
