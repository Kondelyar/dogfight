// Запис 30 с гри з 8 ботами у Chromium: час кадру, паузи збирання сміття, хто створює найбільше
// об'єктів і flame chart. Працює з будь-якою версією клієнта: усе міряємо ззовні (CDP).
//
//   node tools/perf/record.ts --url http://localhost:3000 --label before [--seconds 30] [--bots 8]
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';
import { BotClient, createRoom, toWsUrl } from '../../server/scripts/botClient.ts';
import { CpuProfileSchema, renderFlameHtml } from './flame.ts';
import { summarize } from './stats.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const url = arg('url', 'http://localhost:3000');
const label = arg('label', 'run');
const seconds = Number(arg('seconds', '30'));
const botCount = Number(arg('bots', '8'));
const outDir = arg('out', 'docs/perf');
const query = arg('query', ''); // наприклад "?bots=8&botMode=worker"

const FrameSamplesSchema = z.array(z.tuple([z.number(), z.number()]));

// Обгортка rAF ставиться до коду сторінки: міряє і інтервал між кадрами, і час самого кадру.
const INIT_SCRIPT = `
  (() => {
    const original = window.requestAnimationFrame.bind(window);
    const frames = [];
    let prev = 0;
    let recording = false;
    window.__perf = { frames, start() { frames.length = 0; recording = true; }, stop() { recording = false; } };
    window.requestAnimationFrame = (cb) => original((t) => {
      const start = performance.now();
      cb(t);
      const work = performance.now() - start;
      if (recording) frames.push([prev ? start - prev : 0, work]);
      prev = start;
    });
  })();
`;

async function joinRoom(page: Page, roomName: string): Promise<void> {
  await page.goto(`${url}/${query}`);
  const row = page.locator('li', { hasText: roomName });
  await row.getByRole('button', { name: 'Join' }).click();
  await page.waitForFunction(() => document.getElementById('overlay')?.hidden === true);
}

// людина: тримає тягу й вогонь, раз на секунду міняє напрям
async function drivePlayer(page: Page, ms: number): Promise<void> {
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('Space');
  const end = Date.now() + ms;
  let turning = false;
  while (Date.now() < end) {
    if (turning) await page.keyboard.up('ArrowRight');
    else await page.keyboard.down('ArrowRight');
    turning = !turning;
    await sleep(1000);
  }
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowUp');
}

async function withBots<T>(roomId: string, run: () => Promise<T>): Promise<T> {
  const bots = Array.from(
    { length: botCount },
    (_, i) => new BotClient({ wsUrl: toWsUrl(url), roomId, name: `bot${i + 1}`, seed: 500 + i }),
  );
  await Promise.all(bots.map((b) => b.opened));
  try {
    return await run();
  } finally {
    for (const bot of bots) bot.stop();
  }
}

const TraceSchema = z.object({
  traceEvents: z.array(
    z.object({ name: z.string(), ph: z.string(), dur: z.number().optional() }).passthrough(),
  ),
});

const GC_NAMES = new Set([
  'V8.GCScavenger',
  'V8.GCCompactor',
  'V8.GCFinalizeMC',
  'MinorGC',
  'MajorGC',
]);

// ---------- Прохід 1: чисті кадри + GC з трасування ----------
async function passFrames() {
  const browser = await chromium.launch({
    channel: 'chromium',
    args: ['--enable-precise-memory-info'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(INIT_SCRIPT);
  const roomId = await createRoom(url, 'perf');

  const result = await withBots(roomId, async () => {
    await joinRoom(page, 'perf');
    await sleep(2000); // прогрів: JIT і перші знімки
    await browser.startTracing(page, {
      categories: ['v8', 'v8.gc', 'devtools.timeline', 'disabled-by-default-v8.gc'],
    });
    await page.evaluate(() => window.__perf.start());
    await drivePlayer(page, seconds * 1000);
    await page.evaluate(() => window.__perf.stop());
    const trace = TraceSchema.parse(JSON.parse((await browser.stopTracing()).toString('utf8')));
    const frames = FrameSamplesSchema.parse(await page.evaluate(() => window.__perf.frames));
    return { frames, trace };
  });
  await browser.close();

  const intervals = result.frames.map(([i]) => i).filter((i) => i > 0);
  const work = result.frames.map(([, w]) => w);
  const gcEvents = result.trace.traceEvents.filter((e) => e.ph === 'X' && GC_NAMES.has(e.name));
  const gcMs = gcEvents.map((e) => (e.dur ?? 0) / 1000);
  const byName: Record<string, number> = {};
  for (const e of gcEvents) byName[e.name] = (byName[e.name] ?? 0) + 1;

  return {
    frames: result.frames.length,
    frameWorkMs: summarize(work),
    frameIntervalMs: summarize(intervals),
    longFrames: work.filter((w) => w > 16.7).length,
    gc: {
      pauses: summarize(gcMs),
      over5ms: gcMs.filter((d) => d > 5).length,
      over10ms: gcMs.filter((d) => d > 10).length,
      totalMs: Math.round(gcMs.reduce((s, d) => s + d, 0) * 100) / 100,
      byName,
    },
  };
}

// ---------- Прохід 2: CPU-профіль і вибірка пам'яті (повільніше, тому окремо) ----------
const HeapNodeSchema: z.ZodType<HeapNode> = z.lazy(() =>
  z.object({
    callFrame: z.object({ functionName: z.string(), url: z.string(), lineNumber: z.number() }),
    selfSize: z.number(),
    children: z.array(HeapNodeSchema),
  }),
);
interface HeapNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: HeapNode[];
}
const HeapProfileSchema = z.object({ profile: z.object({ head: HeapNodeSchema }) });

async function passProfile() {
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(INIT_SCRIPT);
  const roomId = await createRoom(url, 'perf');
  const cdp = await page.context().newCDPSession(page);

  const profiles = await withBots(roomId, async () => {
    await joinRoom(page, 'perf');
    await sleep(2000);
    await cdp.send('Profiler.enable');
    await cdp.send('HeapProfiler.enable');
    await cdp.send('Profiler.start');
    // враховуємо й те, що вже зібрав GC: інакше побачимо лише живі об'єкти, а не всі виділення
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: 1024,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    await drivePlayer(page, seconds * 1000);
    const cpu = CpuProfileSchema.parse((await cdp.send('Profiler.stop')).profile);
    const heap = HeapProfileSchema.parse(await cdp.send('HeapProfiler.stopSampling'));
    return { cpu, heap };
  });

  const flame = await browser.newPage({ viewport: { width: 1600, height: 600 } });
  await flame.setContent(renderFlameHtml(profiles.cpu, `flame chart · ${label}`));
  await mkdir(outDir, { recursive: true });
  await flame.screenshot({ path: `${outDir}/flame-${label}.png`, fullPage: true });
  await browser.close();

  // "хто створює найбільше": сумарний selfSize по функціях
  const byFn = new Map<string, number>();
  let total = 0;
  const visit = (n: HeapNode): void => {
    const file = n.callFrame.url.split('/').pop() ?? '';
    const key = `${n.callFrame.functionName || '(anonymous)'} ${file}:${n.callFrame.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + n.selfSize);
    total += n.selfSize;
    n.children.forEach(visit);
  };
  visit(profiles.heap.profile.head);
  const top = [...byFn.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([fn, bytes]) => ({
      fn,
      mb: Math.round((bytes / 1048576) * 100) / 100,
      percent: Math.round((bytes / total) * 1000) / 10,
    }));
  await writeFile(`${outDir}/cpu-${label}.cpuprofile`, JSON.stringify(profiles.cpu));
  return { sampledAllocMb: Math.round((total / 1048576) * 100) / 100, topAllocators: top };
}

const frames = await passFrames();
const profile = await passProfile();
const report = { label, url, seconds, bots: botCount, query, ...frames, ...profile };
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/${label}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

declare global {
  interface Window {
    __perf: { frames: [number, number][]; start(): void; stop(): void };
  }
}
