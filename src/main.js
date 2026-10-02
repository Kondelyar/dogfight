import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { setupCanvas } from './render/canvas.js';
import { World } from './sim/world.js';
import { Ship } from './sim/ship.js';
import { Asteroid } from './sim/asteroid.js';
import { Explosion } from './sim/explosion.js';
import { createPickup } from './sim/pickup.js';
import { withHoming } from './sim/homing.js';
import { wrap } from './sim/arena.js';
import { findCollisions } from './sim/collision.js';
import {
  drawShip,
  drawBullet,
  drawAsteroid,
  drawExplosion,
  drawPickup,
  drawStarfield,
  drawHud,
} from './render/draw.js';

const canvas = document.getElementById('game');
const { ctx, width, height } = setupCanvas(canvas);
const input = createInput(window);

const world = new World();

const stars = Array.from({ length: 140 }, () => ({
  x: Math.random() * width(),
  y: Math.random() * height(),
  size: Math.random() < 0.15 ? 2 : 1,
}));

function spawnShip() {
  return world.spawn(new Ship(width() / 2, height() / 2));
}

function spawnAsteroid() {
  const edge = Math.floor(Math.random() * 4);
  const x = edge === 0 ? 0 : edge === 1 ? width() : Math.random() * width();
  const y = edge === 2 ? 0 : edge === 3 ? height() : Math.random() * height();
  return world.spawn(new Asteroid(x, y));
}

function spawnPickup() {
  const effect = Math.random() < 0.5 ? 'shield' : 'rapidfire';
  world.spawn(createPickup(Math.random() * width(), Math.random() * height(), effect));
}

let ship = spawnShip();
let respawnTimer = 0;

for (let i = 0; i < 5; i++) spawnAsteroid();

// один з астероїдів переслідує гравця - та сама Asteroid, без окремого
// класу HomingAsteroid (M4, композиція замість нової гілки extends)
withHoming(spawnAsteroid(), () => ship, 1.2);

setInterval(spawnPickup, 8000);

/*
  this-баг (Lab 2, Theory §2): перша спроба була
    fireButton.addEventListener('click', ship.fire)
  this всередині fire стає кнопкою, а не ship - постріл падає з помилкою
  (this.pos undefined). Ship.fire оголошений полем-стрілкою
  (fire = (world) => {...}), тому лексично this завжди прив'язаний
  до інстанса і баг не повторюється навіть при прямій передачі методу.
  Робочі альтернативи без поля-стрілки: ship.fire.bind(ship)
  або обгортка () => ship.fire(world), як і зроблено нижче.
*/
document.getElementById('fire').addEventListener('click', () => ship.fire(world));

function destroyShip(target) {
  world.spawn(new Explosion(target.pos.x, target.pos.y));
  target.alive = false;
  respawnTimer = 2;
}

function handlePair(a, b) {
  const bullet = a.kind === 'bullet' ? a : b.kind === 'bullet' ? b : null;
  const other = bullet === a ? b : a;

  if (bullet && other.kind === 'asteroid') {
    other.hp -= bullet.damage;
    bullet.alive = false;
    if (other.hp <= 0) {
      other.alive = false;
      world.spawn(new Explosion(other.pos.x, other.pos.y));
      ship.score += 10;
    }
    return;
  }

  if (bullet && other.kind === 'ship' && bullet.owner !== other) {
    other.damage(bullet.damage);
    bullet.alive = false;
    if (other.hp === 0) destroyShip(other);
    return;
  }

  const shipEntity = a.kind === 'ship' ? a : b.kind === 'ship' ? b : null;
  if (!shipEntity) return;
  const rest = shipEntity === a ? b : a;

  if (rest.kind === 'asteroid') {
    shipEntity.damage(20);
    rest.alive = false;
    world.spawn(new Explosion(rest.pos.x, rest.pos.y));
    if (shipEntity.hp === 0) destroyShip(shipEntity);
    return;
  }

  if (rest.kind === 'pickup') {
    rest.apply(shipEntity);
    rest.alive = false;
  }
}

function simulate(dt) {
if (input.isDown('Space')) ship.fire(world);
  world.step(dt, { input, bounds: { width: width(), height: height() } });

  for (const e of world) {
    if (e.kind === 'ship' || e.kind === 'bullet') wrap(e, width(), height());
  }

  for (const [a, b] of findCollisions(world)) {
    handlePair(a, b);
  }

  if (!ship.alive) {
    respawnTimer -= dt;
    if (respawnTimer <= 0) ship = spawnShip();
  }
}

function render(alpha) {
  drawStarfield(ctx, width(), height(), stars);

  for (const e of world) {
    if (e.kind === 'ship') drawShip(ctx, e, alpha);
    else if (e.kind === 'bullet') drawBullet(ctx, e, alpha);
    else if (e.kind === 'asteroid') drawAsteroid(ctx, e, alpha);
    else if (e.kind === 'explosion') drawExplosion(ctx, e);
    else if (e.kind === 'pickup') drawPickup(ctx, e);
  }

  if (ship.alive) drawHud(ctx, loop.stats, ship);
}

const loop = createLoop({ simulate, render });
loop.start();
