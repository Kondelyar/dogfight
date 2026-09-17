export function wrap(ship, width, height) {
  let wrapped = false;

  if (ship.x < 0) {
    ship.x += width;
    wrapped = true;
  }
  if (ship.x > width) {
    ship.x -= width;
    wrapped = true;
  }
  if (ship.y < 0) {
    ship.y += height;
    wrapped = true;
  }
  if (ship.y > height) {
    ship.y -= height;
    wrapped = true;
  }

  return wrapped;
}
