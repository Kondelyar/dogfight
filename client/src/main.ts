import { STEP, ARENA, Emitter, shipHash, type RoomInfo, type Turn, type WorldEvents } from 'shared';
import { createLoop } from './loop.ts';
import { createInput } from './input.ts';
import { createAudio } from './audio.ts';
import { createHud } from './hud.ts';
import { Explosions, makeStars } from './effects.ts';
import {
  fetchJson,
  withRetry,
  loadAll,
  ManifestSchema,
  type LoadFailure,
  type LoadedAssets,
} from './assets/loader.ts';
import { applyTestMode } from './assets/testMode.ts';
import { Connection } from './net/connection.ts';
import { NetStats, type LagSettings } from './net/netstats.ts';
import { Session } from './net/session.ts';
import { mountChat } from './net/chatView.ts';
import { Lobby } from './lobby/lobby.ts';
import { mountLobbyView } from './lobby/lobbyView.ts';
import { startBots } from './bots/launch.ts';
import { exposeTestHook } from './e2e.ts';
import { setupCanvas } from './render/canvas.ts';
import { drawLoading, type LoadingState } from './render/loading.ts';
import { drawNetgraph } from './render/netgraph.ts';
import { createSprites, FramesSchema } from './render/sprites.ts';
import { drawEntity, drawExplosion, drawStarfield, drawHud } from './render/draw.ts';

// Елемент сторінки має існувати і бути потрібного типу: перевіряємо, а не приводимо тип
function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`#${id} is missing or has the wrong type`);
  return node;
}

const canvas = byId('game', HTMLCanvasElement);
const { ctx, width, height } = setupCanvas(canvas);
const input = createInput(window);
const audio = createAudio();

const overlay = byId('overlay', HTMLDivElement);
const retryButton = byId('retry', HTMLButtonElement);
const fireButton = byId('fire', HTMLButtonElement);
const chatRoot = byId('chat', HTMLDivElement);
const params = new URLSearchParams(window.location.search);
const testMode = params.get('test');

const lobbyStars = makeStars(1);
let loadController: AbortController | null = null;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') loadController?.abort();
});
retryButton.addEventListener('click', () => void boot());

void boot();

async function boot(): Promise<void> {
  retryButton.hidden = true;
  loadController = new AbortController();
  const { signal } = loadController;

  const state: LoadingState = { progress: 0, label: 'manifest', error: null };
  const redraw = () => drawLoading(ctx, width(), height(), state);
  redraw();

  const started = performance.now();
  let result: { assets: LoadedAssets; failed: LoadFailure[] };
  try {
    const raw = await withRetry(() => fetchJson('/assets/manifest.json', { signal }), { signal });
    const manifest = applyTestMode(ManifestSchema.parse(raw), testMode);

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.error =
      err instanceof Error && err.name === 'AbortError'
        ? 'Завантаження скасовано'
        : `Не вдалося завантажити: ${message}`;
    redraw();
    retryButton.hidden = false;
    return;
  } finally {
    loadController = null;
  }

  // має збігатися з хешем у shared/test/determinism.test.ts (той самий код, інший рушій)
  console.info(`[sim] determinism hash: ${shipHash(1000)}`);
  showLobby(result.assets, result.failed);
}

function showLobby(assets: LoadedAssets, failed: LoadFailure[]): void {
  audio.setBuffers(assets.sounds);

  drawStarfield(ctx, width(), height(), lobbyStars);

  const lobby = new Lobby();
  const view = mountLobbyView(overlay, lobby);
  if (failed.length) {
    failed.forEach((f) => console.warn(`[assets] ${f.key}: ${f.error.message}`));
    view.setNotice(
      `Не завантажилось (гра працює без цього): ${failed.map((f) => f.key).join(', ')}`,
    );
  }

  lobby.on('joined', ({ room, name }) => {
    overlay.hidden = true;
    startGame(assets, room, name);
  });

  overlay.hidden = false;
  lobby.start();
}

// ?lag=100&jitter=30&drop=0.02 передаємо серверу: емулятор мережі вмикається з першого пакета
function wsUrl(withLag = true): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const query = new URLSearchParams();
  for (const key of withLag ? ['lag', 'jitter', 'drop'] : []) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query}` : '';
  return `${scheme}://${window.location.host}/ws${suffix}`;
}

const LAGS = [0, 50, 100, 200];
const DROPS = [0, 0.02, 0.05];

// -1, 0 або 1: напрям повороту з двох клавіш
function turnOf(right: boolean, left: boolean): Turn {
  if (right === left) return 0;
  return right ? 1 : -1;
}

function startGame(assets: LoadedAssets, room: RoomInfo, name: string): void {
  const codec = params.get('codec') === 'json' ? 'json' : 'binary';
  const sheet = assets.images['sheet'];
  if (!sheet) throw new Error('sprite sheet is missing');
  const sprites = createSprites(sheet, FramesSchema.parse(assets.json['frames']));

  // шина подій клієнта: звук і HUD слухають її так само, як колись слухали World
  const bus = new Emitter<WorldEvents>();
  audio.attach(bus);
  const hud = createHud(bus);
  const explosions = new Explosions();
  bus.on('exploded', ({ x, y }) => explosions.spawn(x, y));

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

  if (params.has('e2e')) exposeTestHook(session);

  mountChat(chatRoot, connection);
  connection.on('open', () => connection.send({ type: 'join', room: room.id, name, codec }));
  connection.connect();

  // ?bots=8&botMode=worker|main - боти в тій самій кімнаті (для навантаження і вимірів)
  const botCount = Number(params.get('bots') ?? 0);
  if (botCount > 0) {
    startBots(params.get('botMode') === 'main' ? 'main' : 'worker', {
      wsUrl: wsUrl(false),
      roomId: room.id,
      count: botCount,
      seed: 777,
    });
  }

  // [ ] - затримка інтерполяції, L - затримка мережі, K - втрати (змінюється на льоту)
  window.addEventListener('keydown', (e) => {
    const delay = session.interpolator.delay;
    if (e.code === 'BracketLeft') session.interpolator.delay = Math.max(0, delay - 10);
    if (e.code === 'BracketRight') session.interpolator.delay = Math.min(300, delay + 10);

    if (e.code !== 'KeyL' && e.code !== 'KeyK') return;
    const lag = stats.lag;
    let next: LagSettings;
    if (e.code === 'KeyL') {
      const baseMs = LAGS[(LAGS.indexOf(lag.baseMs) + 1) % LAGS.length] ?? 0;
      next = { ...lag, baseMs, jitterMs: Math.round(baseMs * 0.3) };
    } else {
      next = { ...lag, drop: DROPS[(DROPS.indexOf(lag.drop) + 1) % DROPS.length] ?? 0 };
    }
    stats.lag = next;
    connection.send({ type: 'lag', ...next });
  });

  let fireRequested = false;
  fireButton.hidden = false;
  fireButton.addEventListener('click', () => {
    fireRequested = true; // стрільбу виконує крок симуляції, кнопка лише просить про неї
    fireButton.blur();
  });

  let stars: ReturnType<typeof makeStars> | null = null;
  let lastRender = performance.now();

  function simulate(): void {
    session.step({
      turn: turnOf(
        input.isDown('ArrowRight') || input.isDown('KeyD'),
        input.isDown('ArrowLeft') || input.isDown('KeyA'),
      ),
      thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
      fire: input.justPressed('Space') || input.isDown('Space') || fireRequested,
    });
    fireRequested = false;
  }

  function render(alpha: number): void {
    const now = performance.now();
    explosions.update((now - lastRender) / 1000);
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
    for (const e of session.renderEntities(now)) drawEntity(ctx, e, alpha, sprites);
    for (const e of explosions.active) drawExplosion(ctx, e);
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
