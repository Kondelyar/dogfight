import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { encode } from './protocol.js';

export class Room extends EventEmitter {
  constructor({ id, name, max }) {
    super();
    this.id = id;
    this.name = name;
    this.max = max;
    this.players = new Map();
  }

  get size() {
    return this.players.size;
  }

  info() {
    return { id: this.id, name: this.name, players: this.size, max: this.max };
  }

  roster() {
    return [...this.players.values()].map((p) => p.name);
  }

  join(player) {
    if (this.players.size >= this.max) return false;
    this.players.set(player.id, player);
    this.emit('join', player);
    this.#record('join', { player: player.name });
    return true;
  }

  leave(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    this.emit('leave', player);
    this.#record('leave', { player: player.name });
    if (this.players.size === 0) this.emit('empty');
  }

  chat(player, text) {
    this.emit('chat', player, text);
    this.#record('chat', { player: player.name, text });
  }

  broadcast(message, { critical = false } = {}) {
    for (const player of this.players.values()) player.send(message, critical);
  }

  // усе, що має потрапити в лог матчу, йде через подію "event"
  #record(type, data) {
    this.emit('event', { t: Date.now(), type, ...data });
  }
}

export class RoomManager extends EventEmitter {
  #rooms = new Map();
  #maxRooms;
  #maxPlayers;
  #emptyTtlMs;

  constructor({ maxRooms, maxPlayers, emptyTtlMs = 60_000 }) {
    super();
    this.#maxRooms = maxRooms;
    this.#maxPlayers = maxPlayers;
    this.#emptyTtlMs = emptyTtlMs;
  }

  get size() {
    return this.#rooms.size;
  }

  list() {
    return [...this.#rooms.values()].map((room) => room.info());
  }

  get(id) {
    return this.#rooms.get(id);
  }

  create(name) {
    if (this.#rooms.size >= this.#maxRooms) return null;

    const room = new Room({ id: randomUUID().slice(0, 8), name, max: this.#maxPlayers });
    const roster = () =>
      room.broadcast(encode('roster', { players: room.roster() }), { critical: true });
    room.on('join', roster);
    room.on('leave', roster);
    room.on('chat', (player, text) => room.broadcast(encode('chat', { from: player.name, text })));
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

  delete(id) {
    const room = this.#rooms.get(id);
    if (!room) return;
    this.#rooms.delete(id);
    this.emit('deleted', room);
  }

  closeAll() {
    for (const id of [...this.#rooms.keys()]) this.delete(id);
  }
}
