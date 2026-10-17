const PROTOCOL_VERSION = 1;
// після цих кодів сервер свідомо відмовив - перепідключатись марно
// (дзеркало server/src/protocol.js; спільний пакет з'явиться в Lab 5)
const FINAL_CLOSE_CODES = new Set([4000, 4002, 4005]);
const MAX_QUEUE = 50;

export class Connection extends EventTarget {
  #url;
  #socket = null;
  #queue = [];
  #attempt = 0;
  #timer = null;
  #closed = false;

  constructor(url) {
    super();
    this.#url = url;
  }

  connect() {
    this.#timer = null;
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#emit('open'); // слухач тут шле join: сокет уже відкритий, тож іде без черги
      for (const data of this.#queue.splice(0)) socket.send(data);
    });

    socket.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (typeof msg?.type === 'string') this.#emit(msg.type, msg);
    });

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

  send(message) {
    const data = JSON.stringify({ v: PROTOCOL_VERSION, ...message });
    if (this.#socket?.readyState === WebSocket.OPEN) return this.#socket.send(data);
    if (this.#queue.length < MAX_QUEUE) this.#queue.push(data);
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
