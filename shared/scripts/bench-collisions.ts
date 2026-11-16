// node shared/scripts/bench-collisions.ts - наївний обхід проти просторового хешу за кількістю сутностей
import {
  Asteroid,
  Vector2,
  findCollisionsGrid,
  findCollisionsNaive,
  mulberry32,
} from '../src/index.ts';
import type { SimEntity } from '../src/index.ts';

const rng = mulberry32(5);

function scene(n: number): SimEntity[] {
  return Array.from({ length: n }, () => {
    const radius = 3 + rng() * 25;
    return new Asteroid(rng() * 1280, rng() * 720, { radius, vel: new Vector2(), spin: 0 });
  });
}

function timeMs(find: typeof findCollisionsGrid, world: SimEntity[], rounds: number): number {
  let found = 0;
  for (let i = 0; i < 20; i++) found += [...find(world)].length; // прогрів JIT
  const start = performance.now();
  for (let i = 0; i < rounds; i++) found += [...find(world)].length;
  const elapsed = (performance.now() - start) / rounds;
  if (found < 0) console.log(found); // щоб оптимізатор не викинув цикл
  return elapsed;
}

console.log('| Сутностей | Наївний, мс/тік | Хеш, мс/тік | Хеш швидший у |');
console.log('|---|---|---|---|');
for (const n of [20, 50, 100, 200, 400, 800, 1600]) {
  const world = scene(n);
  const rounds = Math.max(20, Math.floor(40000 / n));
  const naive = timeMs(findCollisionsNaive, world, rounds);
  const grid = timeMs(findCollisionsGrid, world, rounds);
  console.log(
    `| ${n} | ${naive.toFixed(4)} | ${grid.toFixed(4)} | ${(naive / grid).toFixed(2)}× |`,
  );
}
