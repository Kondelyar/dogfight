import { fetchJson } from '../assets/loader.js';

export class Lobby extends EventTarget {
  #url;
  #intervalMs;
  #timeoutMs;
  #timer = null;
  #controller = null;
  #rooms = [];

  constructor({ url = '/api/rooms', intervalMs = 5000, timeoutMs = 4000 } = {}) {
    super();
    this.#url = url;
    this.#intervalMs = intervalMs;
    this.#timeoutMs = timeoutMs;
  }

  get rooms() {
    return this.#rooms;
  }

  start() {
    if (this.#timer) return;
    this.refresh();
    this.#timer = setInterval(() => this.refresh(), this.#intervalMs);
  }

  // гравець пішов з лобі: гасимо таймер і скасовуємо запит, що ще летить
  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#controller?.abort();
    this.#controller = null;
  }

  async refresh() {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    try {
      const data = await fetchJson(this.#url, {
        signal: controller.signal,
        timeoutMs: this.#timeoutMs,
      });
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.rooms)) throw new Error('bad rooms payload');

      this.#rooms = data.rooms;
      this.#emit('roomsChanged', this.#rooms);
    } catch (err) {
      if (controller.signal.aborted) return;
      this.#emit('refreshFailed', err);
    }
  }

  // POST не повторюємо автоматично: він не ідемпотентний
  async create(name) {
    try {
      await fetchJson(this.#url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        timeoutMs: this.#timeoutMs,
      });
      await this.refresh();
    } catch (err) {
      this.#emit('createFailed', err);
    }
  }

  join(roomId, name) {
    const room = this.#rooms.find((r) => r.id === roomId);
    if (!room || room.players >= room.max) return false;
    this.stop();
    this.#emit('joined', { room, name });
    return true;
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
