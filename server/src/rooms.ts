import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { encodeServerMessage, type Codec, type ControlInput, type RoomInfo } from 'shared';
import type { RoomLogEvent } from './log/events.ts';

// Гравець у кімнаті: усе, що кімнаті й матчу треба знати про з'єднання.
export interface Player {
  readonly id: string;
  readonly name: string;
  readonly codec: Codec;
  send(data: string, critical?: boolean): void;
  sendState(data: string | ArrayBuffer): void;
}

// Таблиця подій кімнати: назва -> аргументи слухача. tsc не дасть підписатись на неіснуючу подію.
export type RoomEvents = {
  join: [Player];
  leave: [Player];
  empty: [];
  chat: [Player, string];
  input: [Player, ControlInput];
  event: [RoomLogEvent];
};

export class Room extends EventEmitter<RoomEvents> {
  readonly id: string;
  readonly name: string;
  readonly max: number;
  readonly players = new Map<string, Player>();

  constructor({ id, name, max }: { id: string; name: string; max: number }) {
    super();
    this.id = id;
    this.name = name;
    this.max = max;
  }

  get size(): number {
    return this.players.size;
  }

  info(): RoomInfo {
    return { id: this.id, name: this.name, players: this.size, max: this.max };
  }

  roster(): string[] {
    return [...this.players.values()].map((p) => p.name);
  }

  join(player: Player): boolean {
    if (this.players.size >= this.max) return false;
    this.players.set(player.id, player);
    this.emit('join', player);
    this.emit('event', { t: Date.now(), type: 'join', player: player.name });
    return true;
  }

  leave(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    this.emit('leave', player);
    this.emit('event', { t: Date.now(), type: 'leave', player: player.name });
    if (this.players.size === 0) this.emit('empty');
  }

  chat(player: Player, text: string): void {
    this.emit('chat', player, text);
    this.emit('event', { t: Date.now(), type: 'chat', player: player.name, text });
  }

  broadcast(message: string, { critical = false }: { critical?: boolean } = {}): void {
    for (const player of this.players.values()) player.send(message, critical);
  }
}

export type RoomManagerEvents = { created: [Room]; deleted: [Room] };

export interface RoomManagerOptions {
  maxRooms: number;
  maxPlayers: number;
  emptyTtlMs?: number;
}

export class RoomManager extends EventEmitter<RoomManagerEvents> {
  #rooms = new Map<string, Room>();
  #maxRooms: number;
  #maxPlayers: number;
  #emptyTtlMs: number;

  constructor({ maxRooms, maxPlayers, emptyTtlMs = 60_000 }: RoomManagerOptions) {
    super();
    this.#maxRooms = maxRooms;
    this.#maxPlayers = maxPlayers;
    this.#emptyTtlMs = emptyTtlMs;
  }

  get size(): number {
    return this.#rooms.size;
  }

  list(): RoomInfo[] {
    return [...this.#rooms.values()].map((room) => room.info());
  }

  get(id: string): Room | undefined {
    return this.#rooms.get(id);
  }

  create(name: string): Room | null {
    if (this.#rooms.size >= this.#maxRooms) return null;

    const room = new Room({ id: randomUUID().slice(0, 8), name, max: this.#maxPlayers });
    const roster = () =>
      room.broadcast(encodeServerMessage({ type: 'roster', players: room.roster() }), {
        critical: true,
      });
    room.on('join', roster);
    room.on('leave', roster);
    room.on('chat', (player, text) =>
      room.broadcast(encodeServerMessage({ type: 'chat', from: player.name, text })),
    );
    room.once('empty', () => this.delete(room.id));

    this.#rooms.set(room.id, room);
    this.emit('created', room);
    room.emit('event', { t: Date.now(), type: 'created', name });

    // кімната, в яку так ніхто й не зайшов, не має висіти вічно
    setTimeout(() => {
      if (room.size === 0) this.delete(room.id);
    }, this.#emptyTtlMs).unref();

    return room;
  }

  delete(id: string): void {
    const room = this.#rooms.get(id);
    if (!room) return;
    this.#rooms.delete(id);
    this.emit('deleted', room);
  }

  closeAll(): void {
    for (const id of [...this.#rooms.keys()]) this.delete(id);
  }
}
