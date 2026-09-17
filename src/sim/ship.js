const TURN_SPEED = 3.2; // рад/с
const THRUST = 260; // px/с^2
const DRAG = 0.6;
const MAX_SPEED = 420;

export function createShip() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    thrusting: false,
    prevX: 0,
    prevY: 0,
    prevAngle: -Math.PI / 2,
  };
}

export function integrate(ship, input, dt) {
  if (input.isDown('ArrowLeft') || input.isDown('KeyA')) ship.angle -= TURN_SPEED * dt;
  if (input.isDown('ArrowRight') || input.isDown('KeyD')) ship.angle += TURN_SPEED * dt;

  ship.thrusting = input.isDown('ArrowUp') || input.isDown('KeyW');

  if (ship.thrusting) {
    ship.vx += Math.cos(ship.angle) * THRUST * dt;
    ship.vy += Math.sin(ship.angle) * THRUST * dt;
  }

  ship.vx *= 1 - DRAG * dt;
  ship.vy *= 1 - DRAG * dt;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
}
