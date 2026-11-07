// node shared/scripts/measure.js - JSON проти DataView на знімку 4 гравців (30 Гц)
import { World, STEP, TICK_RATE, codecs, scriptedInput } from '../src/index.js';

const world = new World({ seed: 42 });
world.populate();
const ships = Array.from({ length: 4 }, () => world.addShip());
for (let i = 0; i < 90; i++) {
  ships.forEach((ship, n) =>
    world.applyInput(ship, { ...scriptedInput(i + n * 9), fire: i % 5 === 0 }),
  );
  world.step();
}

const snapshot = { tick: world.tick, ack: 1234, entities: world.records(), events: [] };
const input = { seq: 1234, tick: world.tick, turn: 1, thrust: true, fire: false };
const N = 20000;

function size(data) {
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;
}

function micros(fn) {
  const start = performance.now();
  for (let i = 0; i < N; i++) fn();
  return ((performance.now() - start) / N) * 1000;
}

console.log(
  `сутностей у знімку: ${snapshot.entities.length}, крок ${(STEP * 1000).toFixed(1)} мс\n`,
);
console.log('| Codec | Bytes/snapshot | KB/s down | KB/s up | Encode+decode µs |');
console.log('|---|---|---|---|---|');
for (const [name, codec] of Object.entries(codecs)) {
  const snapBytes = size(codec.encodeSnapshot(snapshot));
  const inputBytes = size(codec.encodeInput(input));
  const us = micros(() => codec.decodeSnapshot(codec.encodeSnapshot(snapshot)));
  const down = ((snapBytes * TICK_RATE) / 1024).toFixed(1);
  const up = ((inputBytes * TICK_RATE) / 1024).toFixed(2);
  console.log(`| ${name} | ${snapBytes} | ${down} | ${up} | ${us.toFixed(1)} |`);
}
