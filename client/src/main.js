import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { fetchJson, withRetry, loadAll } from './assets/loader.js';
import { applyTestMode } from './assets/testMode.js';
import { Connection } from './net/connection.js';
import { mountChat } from './net/chatView.js';
import { Lobby } from './lobby/lobby.js';
import { mountLobbyView } from './lobby/lobbyView.js';
import { setupCanvas } from './render/canvas.js';
import { drawLoading } from './render/loading.js';
import { createSprites } from './render/sprites.js';
import {
  drawShip,
  drawBullet,
  drawAsteroid,
  drawExplosion,
  drawPickup,
  drawStarfield,
  drawHud,
} from './render/draw.js';
import { World } from './sim/world.js';
import { Ship } from './sim/ship.js';
import { Asteroid } from './sim/asteroid.js';
import { Explosion } from './sim/explosion.js';
import { createPickup } from './sim/pickup.js';
import { withHoming } from './sim/homing.js';
import { wrap } from './sim/arena.js';
import { findCollisions } from './sim/collision.js';

const canvas = document.getElementById('game');
const { ctx, width, height } = setupCanvas(canvas);
const input = createInput(window);
const audio = createAudio();

const overlay = document.getElementById('overlay');
const retryButton = document.getElementById('retry');
const fireButton = document.getElementById('fire');
const chatRoot = document.getElementById('chat');
const testMode = new URLSearchParams(window.location.search).get('test');

const stars = Array.from({ length: 140 }, () => ({
  x: Math.random() * width(),
  y: Math.random() * height(),
  size: Math.random() < 0.15 ? 2 : 1,
}));

let loadController = null;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') loadController?.abort();
});
retryButton.addEventListener('click', boot);

boot();

async function boot() {
  retryButton.hidden = true;
  loadController = new AbortController();
  const { signal } = loadController;

  const state = { progress: 0, label: 'manifest', error: null };
  const redraw = () => drawLoading(ctx, width(), height(), state);
  redraw();

  const started = performance.now();
  let result;
  try {
    const manifest = await withRetry(() => fetchJson('/assets/manifest.json', { signal }), {
      signal,
    });
    applyTestMode(manifest, testMode);

    result = await loadAll(manifest, {
      ctx: audio.ctx,
      signal,
      onProgress(progress, label) {
        state.progress = progress;
        state.label = label;
        redraw();
      },
    });
    console.info(`[assets] loaded in ${Math.round(performance.now() - started)} ms`);
  } catch (err) {
    state.error =
      err.name === 'AbortError'
        ? 'Завантаження скасовано'
        : `Не вдалося завантажити: ${err.message}`;
    redraw();
    retryButton.hidden = false;
    return;
  } finally {
    loadController = null;
  }

  showLobby(result.assets, result.failed);
}

function showLobby(assets, failed) {
  audio.setBuffers(assets.sounds ?? {});

  drawStarfield(ctx, width(), height(), stars);

  const lobby = new Lobby();
  const view = mountLobbyView(overlay, lobby);
  if (failed.length) {
    failed.forEach((f) => console.warn(`[assets] ${f.key}: ${f.error.message}`));
    view.setNotice(
      `Не завантажилось (гра працює без цього): ${failed.map((f) => f.key).join(', ')}`,
    );
  }

  lobby.addEventListener(
    'joined',
    (e) => {
      overlay.hidden = true;
      startGame(assets, e.detail.room, e.detail.name);
    },
    { once: true },
  );

  overlay.hidden = false;
  lobby.start();
}

function wsUrl() {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws`;
}

function startGame(assets, room, name) {
  const arena = { ...assets.json.arena, ...room.arena };
  const sprites = createSprites(assets.images.sheet, assets.json.frames);

  // join шлемо при кожному (пере)підключенні: сервер про нас нічого не пам'ятає
  const connection = new Connection(wsUrl());
  mountChat(chatRoot, connection);
  connection.addEventListener('open', () => connection.send({ type: 'join', room: room.id, name }));
  connection.connect();

  const world = new World();
  audio.attach(world);
  const hud = createHud(world);

  let ship = spawnShip();
  let respawnTimer = 0;

  for (let i = 0; i < arena.asteroids; i++) spawnAsteroid();
  for (let i = 0; i < arena.hunters; i++) withHoming(spawnAsteroid(), () => ship, 1.2);

  setInterval(spawnPickup, arena.pickupEveryMs);

  /*
    this-баг (Lab 2): addEventListener('click', ship.fire) віддав би fire
    this = кнопка. fire - поле-стрілка, плюс тут обгортка з world.
  */
  fireButton.hidden = false;
  fireButton.addEventListener('click', () => {
    ship.fire(world);
    fireButton.blur();
  });

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

  function explode(entity, kind) {
    world.spawn(new Explosion(entity.pos.x, entity.pos.y));
    world.emit('exploded', { kind, x: entity.pos.x, y: entity.pos.y });
  }

  function destroyShip(target) {
    explode(target, 'ship');
    target.alive = false;
    respawnTimer = arena.respawnSeconds;
  }

  function handlePair(a, b) {
    const bullet = a.kind === 'bullet' ? a : b.kind === 'bullet' ? b : null;
    const other = bullet === a ? b : a;

    if (bullet && other.kind === 'asteroid') {
      other.hp -= bullet.damage;
      bullet.alive = false;
      if (other.hp <= 0) {
        other.alive = false;
        explode(other, 'asteroid');
        ship.score += 10;
        world.emit('scored', { points: 10, x: other.pos.x, y: other.pos.y });
      } else {
        world.emit('hit', { kind: 'asteroid' });
      }
      return;
    }

    if (bullet && other.kind === 'ship' && bullet.owner !== other) {
      other.damage(bullet.damage);
      bullet.alive = false;
      world.emit('hit', { kind: 'ship' });
      if (other.hp === 0) destroyShip(other);
      return;
    }

    const shipEntity = a.kind === 'ship' ? a : b.kind === 'ship' ? b : null;
    if (!shipEntity) return;
    const rest = shipEntity === a ? b : a;

    if (rest.kind === 'asteroid') {
      shipEntity.damage(20);
      rest.alive = false;
      explode(rest, 'asteroid');
      if (shipEntity.hp === 0) destroyShip(shipEntity);
      return;
    }

    if (rest.kind === 'pickup') {
      rest.apply(shipEntity);
      rest.alive = false;
    }
  }

  function simulate(dt) {
    if (input.justPressed('Space')) ship.fire(world);

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
      if (e.kind === 'ship') drawShip(ctx, e, alpha, sprites);
      else if (e.kind === 'bullet') drawBullet(ctx, e, alpha, sprites);
      else if (e.kind === 'asteroid') drawAsteroid(ctx, e, alpha, sprites);
      else if (e.kind === 'explosion') drawExplosion(ctx, e);
      else if (e.kind === 'pickup') drawPickup(ctx, e, sprites);
    }

    hud.draw(ctx);
    if (ship.alive) drawHud(ctx, loop.stats, ship, { name, room: room.name });
  }

  const loop = createLoop({ simulate, render });
  loop.start();
}
