import { test } from 'vitest';
import assert from 'node:assert/strict';
import { RoomManager, type Player } from '../src/rooms.ts';

const player = (id: string): Player => ({
  id,
  name: id,
  codec: 'binary',
  send() {},
  sendState() {},
});

function createRoom(manager: RoomManager, name: string) {
  const room = manager.create(name);
  assert.ok(room, 'кімната створена');
  return room;
}

test('кімната емітить join/leave/empty і видаляється, коли порожніє', () => {
  const manager = new RoomManager({ maxRooms: 2, maxPlayers: 2 });
  const room = createRoom(manager, 'test');
  const seen: string[] = [];
  room.on('join', (p) => seen.push(`join ${p.id}`));
  room.on('leave', (p) => seen.push(`leave ${p.id}`));
  room.on('empty', () => seen.push('empty'));

  room.join(player('a'));
  room.leave('a');

  assert.deepEqual(seen, ['join a', 'leave a', 'empty']);
  assert.equal(manager.get(room.id), undefined);
});

test('ліміти: гравців у кімнаті й кімнат на сервері', () => {
  const manager = new RoomManager({ maxRooms: 1, maxPlayers: 1 });
  const room = createRoom(manager, 'one');

  assert.equal(room.join(player('a')), true);
  assert.equal(room.join(player('b')), false);
  assert.equal(manager.create('two'), null);
});

test('chat розсилається як подія й потрапляє в журнал подій', () => {
  const manager = new RoomManager({ maxRooms: 1, maxPlayers: 2 });
  const room = createRoom(manager, 'chat');
  const events: string[] = [];
  room.on('event', (e) => events.push(e.type));

  const a = player('a');
  room.join(a);
  room.chat(a, 'hi');

  assert.deepEqual(events, ['join', 'chat']);
});
