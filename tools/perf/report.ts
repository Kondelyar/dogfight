// node tools/perf/report.ts - збирає markdown-таблиці з docs/perf/*.json для README
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const SummarySchema = z.object({
  count: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  max: z.number(),
  mean: z.number(),
});
const RunSchema = z.object({
  label: z.string(),
  frames: z.number(),
  frameWorkMs: SummarySchema,
  frameIntervalMs: SummarySchema,
  longFrames: z.number(),
  gc: z.object({
    pauses: SummarySchema,
    over5ms: z.number(),
    totalMs: z.number(),
  }),
  sampledAllocMb: z.number(),
  topAllocators: z.array(z.object({ fn: z.string(), mb: z.number(), percent: z.number() })),
});
type Run = z.infer<typeof RunSchema>;

async function run(label: string): Promise<Run> {
  return RunSchema.parse(JSON.parse(await readFile(`docs/perf/${label}.json`, 'utf8')));
}

const before = await run('before');
const after = await run('after');
const main = await run('bots-main');
const worker = await run('bots-worker');

const delta = (a: number, b: number): string =>
  a === 0 ? '' : ` (${b <= a ? '' : '+'}${Math.round(((b - a) / a) * 100)} %)`;

console.log('### Кадр, 30 с, 8 ботів у кімнаті\n');
console.log('| Метрика | До | Після |');
console.log('|---|---|---|');
const rows: [string, string, string][] = [
  ['Кадрів за 30 с', String(before.frames), String(after.frames)],
  ['Час роботи кадру p50, мс', `${before.frameWorkMs.p50}`, `${after.frameWorkMs.p50}`],
  ['Час роботи кадру p95, мс', `${before.frameWorkMs.p95}`, `${after.frameWorkMs.p95}`],
  ['**Час роботи кадру p99, мс**', `${before.frameWorkMs.p99}`, `${after.frameWorkMs.p99}`],
  [
    'Інтервал між кадрами p50 / p99, мс',
    `${before.frameIntervalMs.p50} / ${before.frameIntervalMs.p99}`,
    `${after.frameIntervalMs.p50} / ${after.frameIntervalMs.p99}`,
  ],
  ['Кадрів довших за 16.7 мс', String(before.longFrames), String(after.longFrames)],
  [
    'Пауз GC за 30 с',
    String(before.gc.pauses.count),
    `${after.gc.pauses.count}${delta(before.gc.pauses.count, after.gc.pauses.count)}`,
  ],
  ['Найдовша пауза GC, мс', `${before.gc.pauses.max}`, `${after.gc.pauses.max}`],
  ['Пауз GC довших за 5 мс', String(before.gc.over5ms), String(after.gc.over5ms)],
  [
    'Сумарний час GC, мс',
    `${before.gc.totalMs}`,
    `${after.gc.totalMs}${delta(before.gc.totalMs, after.gc.totalMs)}`,
  ],
  [
    'Виділено пам’яті за 30 с, МБ (вибірка)',
    `${before.sampledAllocMb}`,
    `${after.sampledAllocMb}${delta(before.sampledAllocMb, after.sampledAllocMb)}`,
  ],
];
for (const [name, a, b] of rows) console.log(`| ${name} | ${a} | ${b} |`);

for (const [title, r] of [
  ['До', before],
  ['Після', after],
] as const) {
  console.log(`\n### Хто створює найбільше об'єктів: ${title}\n`);
  console.log('| Функція | МБ за 30 с | Частка |');
  console.log('|---|---|---|');
  for (const a of r.topAllocators.slice(0, 6))
    console.log(`| \`${a.fn}\` | ${a.mb} | ${a.percent} % |`);
}

console.log('\n### Боти на головному потоці і у Web Worker\n');
console.log('| Метрика | Боти на головному потоці | Боти у Worker |');
console.log('|---|---|---|');
const bot: [string, string, string][] = [
  [
    'Час роботи кадру p50 / p99 / max, мс',
    `${main.frameWorkMs.p50} / ${main.frameWorkMs.p99} / ${main.frameWorkMs.max}`,
    `${worker.frameWorkMs.p50} / ${worker.frameWorkMs.p99} / ${worker.frameWorkMs.max}`,
  ],
  [
    'Інтервал між кадрами p99 / max, мс',
    `${main.frameIntervalMs.p99} / ${main.frameIntervalMs.max}`,
    `${worker.frameIntervalMs.p99} / ${worker.frameIntervalMs.max}`,
  ],
  [
    'Виділено на головному потоці, МБ (вибірка)',
    `${main.sampledAllocMb}`,
    `${worker.sampledAllocMb}`,
  ],
];
for (const [name, a, b] of bot) console.log(`| ${name} | ${a} | ${b} |`);
