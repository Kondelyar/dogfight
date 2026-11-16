import {
  Emitter,
  FINAL_CLOSE_CODES,
  assertNever,
  codecs,
  encodeClientMessage,
  parseServerMessage,
  type ClientPayload,
  type Codec,
  type ControlInput,
  type ServerMessage,
  type Snapshot,
} from 'shared';

const MAX_QUEUE = 50;
const utf8 = new TextEncoder();

// Події з'єднання: назва -> тип даних. Підписатись на неіснуючу подію tsc не дасть.
export type ConnectionEvents = {
  open: null;
  close: { code: number };
  welcome: Extract<ServerMessage, { type: 'welcome' }>;
  roster: Extract<ServerMessage, { type: 'roster' }>;
  chat: Extract<ServerMessage, { type: 'chat' }>;
  pong: Extract<ServerMessage, { type: 'pong' }>;
  snapshot: Snapshot;
};

export class Connection extends Emitter<ConnectionEvents> {
  #url: string;
  #socket: WebSocket | null = null;
  #queue: string[] = [];
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;
  bytesIn = 0;
  bytesOut = 0;

  constructor(url: string) {
    super();
    this.#url = url;
  }

  connect(): void {
    this.#timer = null;
    const socket = new WebSocket(this.#url);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.emit('open', null); // слухач тут шле join: сокет уже відкритий, тож іде без черги
      for (const data of this.#queue.splice(0)) this.#transmit(data);
    });

    socket.addEventListener('message', (e: MessageEvent<unknown>) => this.#onMessage(e.data));

    // у браузері після error завжди йде close, але не скрізь (наприклад, Node),
    // тому reconnect запускаємо з обох подій; другий виклик ігнорується
    socket.addEventListener('error', () => {
      if (socket === this.#socket) this.#reconnectLater();
    });

    socket.addEventListener('close', (e) => {
      if (socket !== this.#socket) return;
      this.emit('close', { code: e.code });
      if (!FINAL_CLOSE_CODES.has(e.code)) this.#reconnectLater();
    });
  }

  // Усе, що прийшло з мережі, перевіряється: текст - схемою, бінарний кадр - декодером.
  #onMessage(data: unknown): void {
    if (typeof data === 'string') {
      this.bytesIn += utf8.encode(data).length;
      const parsed = parseServerMessage(data);
      if (!parsed.ok) {
        console.warn(`[net] ignoring bad server message: ${parsed.error}`);
        return;
      }
      this.#dispatch(parsed.value);
      return;
    }

    if (!(data instanceof ArrayBuffer)) return;
    this.bytesIn += data.byteLength;
    const snapshot = codecs.binary.decodeSnapshot(data);
    if (snapshot.ok) this.emit('snapshot', snapshot.value);
    else console.warn(`[net] ignoring bad snapshot: ${snapshot.error}`);
  }

  // новий тип повідомлення без гілки тут - помилка tsc (default з never)
  #dispatch(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        return this.emit('welcome', msg);
      case 'roster':
        return this.emit('roster', msg);
      case 'chat':
        return this.emit('chat', msg);
      case 'pong':
        return this.emit('pong', msg);
      case 'snapshot':
        return this.emit('snapshot', {
          tick: msg.tick,
          ack: msg.ack,
          entities: msg.entities,
          events: msg.events,
        });
      default:
        return assertNever(msg);
    }
  }

  get isOpen(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  #transmit(data: string | ArrayBuffer): void {
    this.bytesOut += typeof data === 'string' ? utf8.encode(data).length : data.byteLength;
    this.#socket?.send(data);
  }

  // керівні повідомлення (join, chat, ping...): чекають у черзі, поки сокет не відкрився
  send(message: ClientPayload): void {
    const data = encodeClientMessage(message);
    if (this.isOpen) return this.#transmit(data);
    if (this.#queue.length < MAX_QUEUE) this.#queue.push(data);
  }

  // інпути не чекають у черзі: застарілий інпут після reconnect нікому не потрібен
  sendInput(input: ControlInput, codec: Codec): void {
    if (!this.isOpen) return;
    this.#transmit(codecs[codec].encodeInput(input));
  }

  close(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#socket?.close();
  }

  // експоненційний backoff з jitter: 0.5с, 1с, 2с ... до 10с
  #reconnectLater(): void {
    if (this.#closed || this.#timer) return;
    const delay = Math.min(10_000, 500 * 2 ** this.#attempt) * (0.5 + Math.random() * 0.5);
    this.#attempt += 1;
    this.#timer = setTimeout(() => this.connect(), delay);
  }
}
