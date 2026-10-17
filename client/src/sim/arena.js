import { Vector2 } from './vector.js';

export function wrap(entity, width, height) {
  let wrapped = false;
  let { x, y } = entity.pos;

  if (x < 0) {
    x += width;
    wrapped = true;
  }
  if (x > width) {
    x -= width;
    wrapped = true;
  }
  if (y < 0) {
    y += height;
    wrapped = true;
  }
  if (y > height) {
    y -= height;
    wrapped = true;
  }

  if (wrapped) {
    entity.pos = new Vector2(x, y);
    entity.prevPos = entity.pos;
  }

  return wrapped;
}
