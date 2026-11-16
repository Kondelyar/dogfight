import { Vector2 } from './vector.ts';
import { ARENA } from './constants.ts';

// якщо позиція всередині арени, повертає той самий об'єкт
export function wrapPosition(pos: Vector2): Vector2 {
  let { x, y } = pos;
  if (x < 0 || x >= ARENA.width) x = ((x % ARENA.width) + ARENA.width) % ARENA.width;
  if (y < 0 || y >= ARENA.height) y = ((y % ARENA.height) + ARENA.height) % ARENA.height;
  return x === pos.x && y === pos.y ? pos : new Vector2(x, y);
}

// найкоротша різниця на колі: 1270 -> 10 це +20, а не -1260
export function wrapDelta(d: number, size: number): number {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
