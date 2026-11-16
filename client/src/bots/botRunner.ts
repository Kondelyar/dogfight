// Боти, що грають у кімнаті так само, як людина: join -> бінарні інпути з частотою тіка.
// Працює однаково на головному потоці і у Web Worker (лише WebSocket і таймери, без DOM).
import {
  BotBrain,
  TICK_MS,
  codecs,
  encodeClientMessage,
  parseServerMessage,
  type EntityId,
  type Snapshot,
} from 'shared';

export interface BotRunnerOptions {
  wsUrl: string;
  roomId: string;
  count: number;
  seed: number;
}

interface BotState {
  socket: WebSocket;
  brain: BotBrain;
  you: EntityId | null;
  last: Snapshot | null;
}

export class BotRunner {
  #opts: BotRunnerOptions;
  #bots: BotState[] = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  snapshots = 0;

  constructor(opts: BotRunnerOptions) {
    this.#opts = opts;
  }

  get connected(): number {
    return this.#bots.filter((b) => b.socket.readyState === WebSocket.OPEN).length;
  }

  start(): void {
    const { wsUrl, roomId, count, seed } = this.#opts;
    for (let i = 0; i < count; i++) {
      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      const bot: BotState = { socket, brain: new BotBrain(seed + i), you: null, last: null };
      this.#bots.push(bot);

      socket.addEventListener('open', () => {
        socket.send(
          encodeClientMessage({ type: 'join', room: roomId, name: `bot${i + 1}`, codec: 'binary' }),
        );
      });
      socket.addEventListener('message', (e: MessageEvent<unknown>) =>
        this.#onMessage(bot, e.data),
      );
    }
    // один таймер на всіх ботів: рішення і відправка раз на тік
    this.#timer = setInterval(() => this.#think(), TICK_MS);
  }

  #onMessage(bot: BotState, data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const decoded = codecs.binary.decodeSnapshot(data);
      if (!decoded.ok) return;
      bot.last = decoded.value;
      this.snapshots += 1;
      return;
    }
    if (typeof data !== 'string') return;
    const msg = parseServerMessage(data);
    if (msg.ok && msg.value.type === 'welcome') bot.you = msg.value.you;
  }

  #think(): void {
    for (const bot of this.#bots) {
      if (!bot.last || bot.you === null || bot.socket.readyState !== WebSocket.OPEN) continue;
      bot.socket.send(codecs.binary.encodeInput(bot.brain.decide(bot.last, bot.you)));
    }
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const bot of this.#bots) bot.socket.close();
    this.#bots = [];
  }
}
