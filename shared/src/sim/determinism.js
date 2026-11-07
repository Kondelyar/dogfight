import { STEP } from './constants.js';
import { Ship } from './ship.js';
import { World } from './world.js';

// FNV-1a по байтах чисел (float64): однаковий стан -> однаковий хеш
export function hashNumbers(numbers) {
  const f = new Float64Array(1);
  const words = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  for (const n of numbers) {
    f[0] = n;
    for (const w of words) {
      h ^= w;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

export function scriptedInput(i) {
  return {
    seq: i + 1,
    tick: 0,
    turn: (Math.floor(i / 32) % 3) - 1,
    thrust: i % 7 < 5,
    fire: i % 11 === 0,
  };
}

// один корабель, 1000 кроків за однаковим сценарієм
export function shipHash(steps = 1000) {
  const ship = new Ship(640, 360);
  ship.id = 1;
  for (let i = 0; i < steps; i++) ship.applyInput(scriptedInput(i), STEP);
  return hashNumbers([ship.pos.x, ship.pos.y, ship.vel.x, ship.vel.y, ship.angle, ship.hp]);
}

// увесь світ: два кораблі, астероїди, кулі
export function worldHash(seed = 7, steps = 600) {
  const world = new World({ seed });
  world.populate();
  const ships = [world.addShip(), world.addShip()];
  for (let i = 0; i < steps; i++) {
    ships.forEach((ship, n) => world.applyInput(ship, scriptedInput(i + n * 13)));
    world.step();
  }
  const numbers = [];
  for (const r of world.records()) numbers.push(...Object.values(r).map(Number));
  return hashNumbers(numbers);
}
