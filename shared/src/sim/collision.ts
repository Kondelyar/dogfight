import type { SimEntity } from './world.ts';

const MIN_CELL = 32;
const OFFSET = 4096; // зсув індексу клітинки, щоб ключ був невід'ємним навіть за краєм арени
const STRIDE = 16384;

function touching(a: SimEntity, b: SimEntity): boolean {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const minDist = a.radius + b.radius;
  return dx * dx + dy * dy <= minDist * minDist;
}

// Менше цього числа сутностей наївний обхід швидший за хеш (вимір: shared/scripts/bench-collisions.ts,
// перетин приблизно на 80-100 сутностях), тому в малих кімнатах лишаємо простий варіант.
export const GRID_THRESHOLD = 80;

function* naivePairs(entities: readonly SimEntity[]): Generator<[SimEntity, SimEntity]> {
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i];
    if (!a?.alive) continue;

    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j];
      if (!b?.alive) continue;
      if (touching(a, b)) yield [a, b];
    }
  }
}

// Еталон: наївний O(n^2) прохід усіх з усіма. Лишається для звірки (тести) і як опис правил.
export function findCollisionsNaive(world: Iterable<SimEntity>): Generator<[SimEntity, SimEntity]> {
  return naivePairs([...world]);
}

// Просторовий хеш: арена ділиться на клітинки не менші за найбільший діаметр, тож сутність може
// зачепити лише сусідів зі своєї клітинки та вісьмох навколо. Замість n²/2 перевірок - близько
// n·k, де k це кількість сусідів. Усі масиви перевикористовуються між тіками (без нових алокацій).
class CollisionGrid {
  #entities: SimEntity[] = [];
  #cellX = new Int32Array(256);
  #cellY = new Int32Array(256);
  #cells = new Map<number, number[]>();
  #spare: number[][] = [];
  #candidates: number[] = [];
  busy = false;

  #clear(): void {
    for (const list of this.#cells.values()) {
      list.length = 0;
      this.#spare.push(list);
    }
    this.#cells.clear();
  }

  #grow(n: number): void {
    if (n <= this.#cellX.length) return;
    const size = Math.max(n, this.#cellX.length * 2);
    this.#cellX = new Int32Array(size);
    this.#cellY = new Int32Array(size);
  }

  #key(cx: number, cy: number): number {
    return (cx + OFFSET) * STRIDE + (cy + OFFSET);
  }

  *pairs(world: Iterable<SimEntity>, forceGrid = false): Generator<[SimEntity, SimEntity]> {
    const entities = this.#entities;
    entities.length = 0;
    let maxRadius = 0;
    for (const e of world) {
      entities.push(e);
      if (e.alive && e.radius > maxRadius) maxRadius = e.radius;
    }

    if (!forceGrid && entities.length < GRID_THRESHOLD) {
      yield* naivePairs(entities);
      return;
    }

    const cell = Math.max(MIN_CELL, maxRadius * 2);
    this.#grow(entities.length);
    this.#clear();

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e?.alive) continue;
      const cx = Math.floor(e.pos.x / cell);
      const cy = Math.floor(e.pos.y / cell);
      this.#cellX[i] = cx;
      this.#cellY[i] = cy;
      const key = this.#key(cx, cy);
      let list = this.#cells.get(key);
      if (!list) {
        list = this.#spare.pop() ?? [];
        this.#cells.set(key, list);
      }
      list.push(i);
    }

    const candidates = this.#candidates;
    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (!a?.alive) continue;

      // кандидати - лише з більшим індексом і в порядку зростання: пари йдуть так само,
      // як в наївному обході, тому порядок розв'язання зіткнень (і хеш детермінізму) той самий
      candidates.length = 0;
      const cx = this.#cellX[i] ?? 0;
      const cy = this.#cellY[i] ?? 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = this.#cells.get(this.#key(cx + dx, cy + dy));
          if (!list) continue;
          for (const j of list) if (j > i) candidates.push(j);
        }
      }
      insertionSort(candidates);

      for (const j of candidates) {
        const b = entities[j];
        if (!b?.alive) continue;
        if (touching(a, b)) yield [a, b];
      }
    }
  }
}

function insertionSort(list: number[]): void {
  for (let i = 1; i < list.length; i++) {
    const value = list[i] ?? 0;
    let j = i - 1;
    while (j >= 0 && (list[j] ?? 0) > value) {
      list[j + 1] = list[j] ?? 0;
      j--;
    }
    list[j + 1] = value;
  }
}

const shared = new CollisionGrid();

function* run(world: Iterable<SimEntity>, forceGrid: boolean): Generator<[SimEntity, SimEntity]> {
  // спільна сітка одна; якщо хтось уже тримає її (два обходи одночасно) - беремо тимчасову
  const grid = shared.busy ? new CollisionGrid() : shared;
  grid.busy = true;
  try {
    yield* grid.pairs(world, forceGrid);
  } finally {
    grid.busy = false;
  }
}

// Те, що викликає World.step: наївний обхід для малих сцен, сітка для великих.
export function findCollisions(world: Iterable<SimEntity>): Generator<[SimEntity, SimEntity]> {
  return run(world, false);
}

// Сітка завжди (для вимірів і тестів).
export function findCollisionsGrid(world: Iterable<SimEntity>): Generator<[SimEntity, SimEntity]> {
  return run(world, true);
}
