import { Vector2 } from './vector.ts';
import { ARENA } from './constants.ts';

// одна координата: усередині [0, size) лишається як є, інакше загортається
export function wrapCoord(v: number, size: number): number {
  return v < 0 || v >= size ? ((v % size) + size) % size : v;
}

// якщо позиція всередині арени, повертає той самий об'єкт
export function wrapPosition(pos: Vector2): Vector2 {
  const x = wrapCoord(pos.x, ARENA.width);
  const y = wrapCoord(pos.y, ARENA.height);
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
