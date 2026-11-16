// node server/scripts/load.ts [--counts 8,32,64,128] [--seconds 15] [--layout rooms|single] [--out docs/perf/load.json]
// Для кожної кількості клієнтів запускає ЧИСТИЙ процес сервера, підключає ботів (без браузера),
// збирає статистику кроку з /api/stats і показує, від якої кількості крок довший за 33 мс.
//   rooms  - по 8 гравців у кімнаті (так грає справжня гра)
//   single - усі в одній кімнаті (найгірший випадок для перевірки колізій і розсилки)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { BotClient, createRoom, toWsUrl } from './botClient.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const counts = arg('counts', '8,32,64,128').split(',').map(Number);
const seconds = Number(arg('seconds', '15'));
const layout = arg('layout', 'rooms');
const out = arg('out', '');
const perRoom = layout === 'single' ? 1000 : 8;
const STEP_BUDGET_MS = 1000 / 30; // 33.3 мс: довший крок означає, що сервер не встигає за 30 Гц

const StatsSchema = z.object({
  rooms: z.array(
    z.object({
      players: z.number(),
      tickMs: z.object({
        avg: z.number(),
        p50: z.number(),
        p95: z.number(),
        p99: z.number(),
        max: z.number(),
      }),
      intervalMs: z.object({ avg: z.number(), jitter: z.number() }),
      overruns: z.number(),
    }),
  ),
});
const HealthSchema = z.object({ rssMb: z.number() });

async function startServer(port: number, players: number): Promise<ChildProcess> {
  const entry = new URL('../src/index.ts', import.meta.url);
  const rooms = Math.ceil(players / perRoom) + 2;
  const child = spawn(process.execPath, [fileURLToPath(entry)], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      MAX_ROOMS: String(rooms),
      MAX_PLAYERS: String(Math.min(perRoom, players)),
      LOG_DIR: path.resolve('server/logs/load'),
      // ліміти не повинні заважати вимірюванню самого кроку
      MAX_PAYLOAD: '4096',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) resolve();
    });
    child.once('exit', (code) => reject(new Error(`server exited early: ${code}`)));
  });
  return child;
}

interface Row {
  clients: number;
  rooms: number;
  stepP50: number;
  stepP99: number;
  stepMax: number;
  jitterMs: number;
  overruns: number;
  rssMb: number;
  over33: boolean;
}

async function measure(clients: number, port: number): Promise<Row> {
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer(port, clients);
  const bots: BotClient[] = [];
  try {
    const roomCount = Math.ceil(clients / perRoom);
    for (let r = 0; r < roomCount; r++) {
      const roomId = await createRoom(base, `load${r}`);
      const inRoom = Math.min(perRoom, clients - r * perRoom);
      for (let i = 0; i < inRoom; i++) {
        bots.push(
          new BotClient({ wsUrl: toWsUrl(base), roomId, name: `b${r}_${i}`, seed: r * 100 + i }),
        );
      }
    }
    await Promise.all(bots.map((b) => b.opened));
    await sleep(3000); // прогрів: JIT, перші знімки

    let p50 = 0;
    let p99 = 0;
    let max = 0;
    let jitter = 0;
    let overruns = 0;
    const samples: number[] = [];
    for (let s = 0; s < seconds; s++) {
      await sleep(1000);
      const { rooms } = StatsSchema.parse(await (await fetch(`${base}/api/stats`)).json());
      for (const room of rooms) {
        p50 = Math.max(p50, room.tickMs.p50);
        p99 = Math.max(p99, room.tickMs.p99);
        max = Math.max(max, room.tickMs.max);
        jitter = Math.max(jitter, room.intervalMs.jitter);
        overruns = Math.max(overruns, room.overruns);
        samples.push(room.tickMs.p99);
      }
    }
    const { rssMb } = HealthSchema.parse(await (await fetch(`${base}/health`)).json());
    const dropped = bots.filter((b) => b.closeCode !== null).length;
    if (dropped > 0) console.warn(`  (відключено ботів: ${dropped})`);
    return {
      clients,
      rooms: roomCount,
      stepP50: p50,
      stepP99: p99,
      stepMax: max,
      jitterMs: jitter,
      overruns,
      rssMb,
      over33: p99 > STEP_BUDGET_MS || max > STEP_BUDGET_MS,
    };
  } finally {
    bots.forEach((b) => b.stop());
    server.kill();
    await sleep(300);
  }
}

console.log(
  `Режим: ${layout}, ${seconds} с на точку, ліміт кроку ${STEP_BUDGET_MS.toFixed(1)} мс\n`,
);
console.log(
  '| Клієнтів | Кімнат | Крок p50, мс | Крок p99, мс | Крок max, мс | Jitter, мс | Перевищень | RSS, МБ |',
);
console.log('|---|---|---|---|---|---|---|---|');
const rows: Row[] = [];
let port = 3400;
for (const clients of counts) {
  const row = await measure(clients, port++);
  rows.push(row);
  console.log(
    `| ${row.clients} | ${row.rooms} | ${row.stepP50} | ${row.stepP99} | ${row.stepMax} | ${row.jitterMs} | ${row.overruns} | ${row.rssMb} |`,
  );
}

const first = rows.find((r) => r.over33);
console.log(
  first
    ? `\nКрок довший за 33 мс уже при ${first.clients} клієнтах.`
    : `\nДо ${rows.at(-1)?.clients ?? 0} клієнтів крок не перевищує 33 мс (найгірший max = ${Math.max(...rows.map((r) => r.stepMax))} мс).`,
);

if (out) {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify({ layout, seconds, budgetMs: STEP_BUDGET_MS, rows }, null, 2),
  );
}
process.exit(0);
