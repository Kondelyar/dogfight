import { Emitter, CreateRoomRequestSchema, RoomListResponseSchema, type RoomInfo } from 'shared';
import { fetchJson, HttpError } from '../assets/loader.ts';

export type LobbyEvents = {
  roomsChanged: RoomInfo[];
  refreshFailed: Error;
  createFailed: { status: number | null };
  joined: { room: RoomInfo; name: string };
};

export interface LobbyOptions {
  url?: string;
  intervalMs?: number;
  timeoutMs?: number;
}

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

export class Lobby extends Emitter<LobbyEvents> {
  #url: string;
  #intervalMs: number;
  #timeoutMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #controller: AbortController | null = null;
  #rooms: RoomInfo[] = [];

  constructor({ url = '/api/rooms', intervalMs = 5000, timeoutMs = 4000 }: LobbyOptions = {}) {
    super();
    this.#url = url;
    this.#intervalMs = intervalMs;
    this.#timeoutMs = timeoutMs;
  }

  get rooms(): RoomInfo[] {
    return this.#rooms;
  }

  start(): void {
    if (this.#timer) return;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), this.#intervalMs);
  }

  // гравець пішов з лобі: гасимо таймер і скасовуємо запит, що ще летить
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#controller?.abort();
    this.#controller = null;
  }

  async refresh(): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    try {
      const data = await fetchJson(this.#url, {
        signal: controller.signal,
        timeoutMs: this.#timeoutMs,
      });
      if (controller.signal.aborted) return;

      const parsed = RoomListResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error('bad rooms payload');

      this.#rooms = parsed.data.rooms;
      this.emit('roomsChanged', this.#rooms);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      this.emit('refreshFailed', toError(err));
    }
  }

  // POST не повторюємо автоматично: він не ідемпотентний
  async create(name: string): Promise<void> {
    const body = CreateRoomRequestSchema.safeParse({ name });
    if (!body.success) return this.emit('createFailed', { status: null });

    try {
      await fetchJson(this.#url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.data),
        timeoutMs: this.#timeoutMs,
      });
      await this.refresh();
    } catch (err: unknown) {
      this.emit('createFailed', { status: err instanceof HttpError ? err.status : null });
    }
  }

  join(roomId: string, name: string): boolean {
    const room = this.#rooms.find((r) => r.id === roomId);
    if (!room || room.players >= room.max) return false;
    this.stop();
    this.emit('joined', { room, name });
    return true;
  }
}
