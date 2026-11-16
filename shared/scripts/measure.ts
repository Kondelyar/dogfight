// node shared/scripts/measure.ts - JSON проти DataView на знімку 4 гравців (30 Гц)
import {
  World,
  STEP,
  TICK_RATE,
  codecs,
  scriptedInput,
  seq,
  type ControlInput,
  type Snapshot,
} from '../src/index.ts';

const world = new World({ seed: 42 });
world.populate();
const ships = Array.from({ length: 4 }, () => world.addShip());
for (let i = 0; i < 90; i++) {
  ships.forEach((ship, n) =>
    world.applyInput(ship, { ...scriptedInput(i + n * 9), fire: i % 5 === 0 }),
  );
  world.step();
}

const snapshot: Snapshot = {
  tick: world.tick,
  ack: seq(1234),
  entities: world.records(),
  events: [],
};
const input: ControlInput = {
  ...scriptedInput(1233),
  tick: world.tick,
  turn: 1,
  thrust: true,
  fire: false,
};
const N = 20000;

function size(data: string | ArrayBuffer): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;
}

function micros(fn: () => void): number {
  const start = performance.now();
  for (let i = 0; i < N; i++) fn();
  return ((performance.now() - start) / N) * 1000;
}

console.log(
  `сутностей у знімку: ${snapshot.entities.length}, крок ${(STEP * 1000).toFixed(1)} мс\n`,
);
console.log('| Codec | Bytes/snapshot | KB/s down | KB/s up | Encode+decode µs |');
console.log('|---|---|---|---|---|');

const rows = [
  {
    name: 'binary',
    snapBytes: size(codecs.binary.encodeSnapshot(snapshot)),
    inputBytes: size(codecs.binary.encodeInput(input)),
    us: micros(() => codecs.binary.decodeSnapshot(codecs.binary.encodeSnapshot(snapshot))),
  },
  {
    name: 'json',
    snapBytes: size(codecs.json.encodeSnapshot(snapshot)),
    inputBytes: size(codecs.json.encodeInput(input)),
    us: micros(() => codecs.json.decodeSnapshot(codecs.json.encodeSnapshot(snapshot))),
  },
];
for (const { name, snapBytes, inputBytes, us } of rows) {
  const down = ((snapBytes * TICK_RATE) / 1024).toFixed(1);
  const up = ((inputBytes * TICK_RATE) / 1024).toFixed(2);
  console.log(`| ${name} | ${snapBytes} | ${down} | ${up} | ${us.toFixed(1)} |`);
}
