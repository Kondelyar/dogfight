import { STEP, ARENA, shipHash } from 'shared';
import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createExplosion, updateExplosions, makeStars } from './effects.js';
import { fetchJson, withRetry, loadAll } from './assets/loader.js';
import { applyTestMode } from './assets/testMode.js';
import { Connection } from './net/connection.js';
import { NetStats } from './net/netstats.js';
import { Session } from './net/session.js';
import { mountChat } from './net/chatView.js';
import { Lobby } from './lobby/lobby.js';
import { mountLobbyView } from './lobby/lobbyView.js';
import { setupCanvas } from './render/canvas.js';
import { drawLoading } from './render/loading.js';
import { drawNetgraph } from './render/netgraph.js';
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

const canvas = document.getElementById('game');
const { ctx, width, height } = setupCanvas(canvas);
const input = createInput(window);
const audio = createAudio();

const overlay = document.getElementById('overlay');
const retryButton = document.getElementById('retry');
const fireButton = document.getElementById('fire');
const chatRoot = document.getElementById('chat');
const params = new URLSearchParams(window.location.search);
const testMode = params.get('test');

const lobbyStars = makeStars(1);
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

  // має збігатися з хешем у shared/test/determinism.test.js (той самий код, інший рушій)
  console.info(`[sim] determinism hash: ${shipHash(1000)}`);
  showLobby(result.assets, result.failed);
}

function showLobby(assets, failed) {
  audio.setBuffers(assets.sounds ?? {});

  drawStarfield(ctx, width(), height(), lobbyStars);

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

// ?lag=100&jitter=30&drop=0.02 передаємо серверу: емулятор мережі вмикається з першого пакета
function wsUrl() {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const query = new URLSearchParams();
  for (const key of ['lag', 'jitter', 'drop']) {
    if (params.has(key)) query.set(key, params.get(key));
  }
  const suffix = query.toString() ? `?${query}` : '';
  return `${scheme}://${window.location.host}/ws${suffix}`;
}

const LAGS = [0, 50, 100, 200];
const DROPS = [0, 0.02, 0.05];

function startGame(assets, room, name) {
  const codec = params.get('codec') === 'json' ? 'json' : 'binary';
  const sprites = createSprites(assets.images.sheet, assets.json.frames);

  // шина подій клієнта: звук і HUD слухають її так само, як колись слухали World
  const bus = new EventTarget();
  audio.attach(bus);
  const hud = createHud(bus);
  let explosions = [];
  bus.addEventListener('exploded', (e) => explosions.push(createExplosion(e.detail.x, e.detail.y)));

  const connection = new Connection(wsUrl());
  const stats = new NetStats(connection);
  stats.lag = {
    baseMs: Number(params.get('lag') ?? 0),
    jitterMs: Number(params.get('jitter') ?? 0),
    drop: Number(params.get('drop') ?? 0),
  };
  const session = new Session({
    connection,
    bus,
    codec,
    stats,
    predict: params.get('predict') !== '0',
  });

  mountChat(chatRoot, connection);
  connection.addEventListener('open', () =>
    connection.send({ type: 'join', room: room.id, name, codec }),
  );
  connection.connect();

  // [ ] - затримка інтерполяції, L - затримка мережі, K - втрати (змінюється на льоту)
  window.addEventListener('keydown', (e) => {
    const delay = session.interpolator.delay;
    if (e.code === 'BracketLeft') session.interpolator.delay = Math.max(0, delay - 10);
    if (e.code === 'BracketRight') session.interpolator.delay = Math.min(300, delay + 10);

    if (e.code !== 'KeyL' && e.code !== 'KeyK') return;
    const lag = stats.lag;
    if (e.code === 'KeyL') {
      const next = LAGS[(LAGS.indexOf(lag.baseMs) + 1) % LAGS.length];
      stats.lag = { ...lag, baseMs: next, jitterMs: Math.round(next * 0.3) };
    } else {
      stats.lag = { ...lag, drop: DROPS[(DROPS.indexOf(lag.drop) + 1) % DROPS.length] };
    }
    connection.send({ type: 'lag', ...stats.lag });
  });

  let fireRequested = false;
  fireButton.hidden = false;
  fireButton.addEventListener('click', () => {
    fireRequested = true; // стрільбу виконує крок симуляції, кнопка лише просить про неї
    fireButton.blur();
  });

  let stars = null;
  let lastRender = performance.now();

  function simulate() {
    session.step({
      turn:
        (input.isDown('ArrowRight') || input.isDown('KeyD') ? 1 : 0) -
        (input.isDown('ArrowLeft') || input.isDown('KeyA') ? 1 : 0),
      thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
      fire: input.justPressed('Space') || input.isDown('Space') || fireRequested,
    });
    fireRequested = false;
  }

  function drawEntity(e, alpha) {
    if (e.kind === 'ship') {
      // чужі кораблі іншого кольору
      if (!e.isMe) ctx.filter = 'hue-rotate(150deg)';
      drawShip(ctx, e, alpha, sprites);
      ctx.filter = 'none';
    } else if (e.kind === 'bullet') drawBullet(ctx, e, alpha, sprites);
    else if (e.kind === 'asteroid') drawAsteroid(ctx, e, alpha, sprites);
    else if (e.kind === 'pickup') drawPickup(ctx, e, sprites);
  }

  function render(alpha) {
    const now = performance.now();
    explosions = updateExplosions(explosions, (now - lastRender) / 1000);
    lastRender = now;
    if (!stars && session.you !== null) stars = makeStars(session.seed);

    // арена завжди 1280x720, під вікно вона лише масштабується
    const scale = Math.min(width() / ARENA.width, height() / ARENA.height);
    const ox = (width() - ARENA.width * scale) / 2;
    const oy = (height() - ARENA.height * scale) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width(), height());
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, ARENA.width, ARENA.height);
    ctx.clip();

    drawStarfield(ctx, ARENA.width, ARENA.height, stars ?? lobbyStars);
    for (const e of session.renderEntities(now)) drawEntity(e, alpha);
    for (const e of explosions) drawExplosion(ctx, e);
    hud.draw(ctx);
    ctx.restore();

    ctx.strokeStyle = '#1c2740';
    ctx.strokeRect(ox, oy, ARENA.width * scale, ARENA.height * scale);

    const ship = session.prediction?.ship ?? { hp: 0, score: 0 };
    drawHud(ctx, loop.stats, ship, { name, room: room.name });
    drawNetgraph(ctx, stats, session, width());
  }

  const loop = createLoop({ step: STEP, simulate, render });
  loop.start();
}
