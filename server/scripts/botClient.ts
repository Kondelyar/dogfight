// Бот без браузера: той самий протокол, що й у людини (join -> бінарні інпути 30 Гц).
import { WebSocket } from 'ws';
import {
  BotBrain,
  RoomListResponseSchema,
  TICK_MS,
  codecs,
  encodeClientMessage,
  parseServerMessage,
  type EntityId,
  type Snapshot,
} from 'shared';
import { z } from 'zod';

export interface BotOptions {
  wsUrl: string;
  roomId: string;
  name: string;
  seed: number;
}

export class BotClient {
  readonly name: string;
  #socket: WebSocket;
  #brain: BotBrain;
  #you: EntityId | null = null;
  #last: Snapshot | null = null;
  #timer: NodeJS.Timeout | null = null;
  snapshots = 0;
  bytesIn = 0;
  closeCode: number | null = null;
  /** різниця між тіком останнього знімка і лічильником, щоб бачити, чи сервер не відстає */
  lastTick = 0;

  readonly opened: Promise<void>;

  constructor({ wsUrl, roomId, name, seed }: BotOptions) {
    this.name = name;
    this.#brain = new BotBrain(seed);
    this.#socket = new WebSocket(wsUrl);
    this.#socket.binaryType = 'arraybuffer';

    this.opened = new Promise((resolve, reject) => {
      this.#socket.once('open', () => {
        this.#socket.send(
          encodeClientMessage({ type: 'join', room: roomId, name, codec: 'binary' }),
        );
        resolve();
      });
      this.#socket.once('error', reject);
    });

    this.#socket.on('message', (data, isBinary) => this.#onMessage(data, isBinary));
    this.#socket.on('close', (code) => {
      this.closeCode = code;
      this.stop();
    });
    this.#socket.on('error', () => {});
  }

  #onMessage(data: unknown, isBinary: boolean): void {
    if (isBinary && data instanceof ArrayBuffer) {
      this.bytesIn += data.byteLength;
      const decoded = codecs.binary.decodeSnapshot(data);
      if (decoded.ok) {
        this.snapshots += 1;
        this.lastTick = decoded.value.tick;
        this.#last = decoded.value;
      }
      return;
    }
    const text = typeof data === 'string' ? data : String(data);
    const msg = parseServerMessage(text);
    if (msg.ok && msg.value.type === 'welcome') {
      this.#you = msg.value.you;
      this.#start();
    }
  }

  // раз на тік: рішення мозку -> бінарний інпут (як клавіатура людини)
  #start(): void {
    this.#timer = setInterval(() => {
      const you = this.#you;
      if (!this.#last || you === null || this.#socket.readyState !== WebSocket.OPEN) return;
      this.#socket.send(codecs.binary.encodeInput(this.#brain.decide(this.#last, you)));
    }, TICK_MS);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.close();
  }
}

const CreatedRoomSchema = z.object({ room: z.object({ id: z.string() }) });

export async function createRoom(httpUrl: string, name: string): Promise<string> {
  const res = await fetch(`${httpUrl}/api/rooms`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`cannot create room: ${res.status}`);
  return CreatedRoomSchema.parse(await res.json()).room.id;
}

export async function listRooms(httpUrl: string) {
  const res = await fetch(`${httpUrl}/api/rooms`);
  return RoomListResponseSchema.parse(await res.json()).rooms;
}

export const toWsUrl = (httpUrl: string): string => httpUrl.replace(/^http/, 'ws') + '/ws';
