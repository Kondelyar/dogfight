import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { createShip, integrate } from './sim/ship.js';
import { wrap } from './sim/arena.js';
import { setupCanvas } from './render/canvas.js';
import { drawShip, drawStarfield, drawHud } from './render/draw.js';

const canvas = document.getElementById('game');
const { ctx, width, height } = setupCanvas(canvas);
const input = createInput(window);

const ship = createShip();
ship.x = width() / 2;
ship.y = height() / 2;
ship.prevX = ship.x;
ship.prevY = ship.y;

const stars = Array.from({ length: 140 }, () => ({
  x: Math.random() * width(),
  y: Math.random() * height(),
  size: Math.random() < 0.15 ? 2 : 1,
}));

function simulate(dt) {
  ship.prevX = ship.x;
  ship.prevY = ship.y;
  ship.prevAngle = ship.angle;

  integrate(ship, input, dt);

  if (wrap(ship, width(), height())) {
    ship.prevX = ship.x;
    ship.prevY = ship.y;
  }
}

function render(alpha) {
  drawStarfield(ctx, width(), height(), stars);
  drawShip(ctx, ship, alpha);
  drawHud(ctx, loop.stats);
}

const loop = createLoop({ simulate, render });
loop.start();
