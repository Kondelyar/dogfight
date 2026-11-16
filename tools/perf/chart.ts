// node tools/perf/chart.ts - малює docs/perf/load.svg з результатів server/scripts/load.ts
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const RowSchema = z.object({
  clients: z.number(),
  stepP50: z.number(),
  stepP99: z.number(),
  stepMax: z.number(),
});
const ResultSchema = z.object({
  layout: z.string(),
  budgetMs: z.number(),
  rows: z.array(RowSchema),
});

async function load(file: string) {
  return ResultSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

const rooms = await load('docs/perf/load-rooms.json');
const single = await load('docs/perf/load-single.json');

const W = 760;
const H = 420;
const m = { left: 70, right: 170, top: 40, bottom: 56 };
const innerW = W - m.left - m.right;
const innerH = H - m.top - m.bottom;

// логарифмічна вісь Y: від 0.01 мс до 100 мс, щоб на одному графіку було видно і 0.05, і 33
const yMin = Math.log10(0.01);
const yMax = Math.log10(100);
const y = (ms: number): number =>
  m.top + innerH - ((Math.log10(Math.max(ms, 0.01)) - yMin) / (yMax - yMin)) * innerH;

const xs = rooms.rows.map((r) => r.clients);
const x = (i: number): number => m.left + (i / (xs.length - 1)) * innerW;

const series = [
  {
    name: 'по 8 в кімнаті, p99',
    data: rooms.rows.map((r) => r.stepP99),
    color: '#2a7fff',
    dash: '',
  },
  {
    name: 'по 8 в кімнаті, max',
    data: rooms.rows.map((r) => r.stepMax),
    color: '#2a7fff',
    dash: '4 3',
  },
  {
    name: 'одна кімната, p99',
    data: single.rows.map((r) => r.stepP99),
    color: '#e07b00',
    dash: '',
  },
  {
    name: 'одна кімната, max',
    data: single.rows.map((r) => r.stepMax),
    color: '#e07b00',
    dash: '4 3',
  },
];

const parts: string[] = [];
for (const tick of [0.01, 0.1, 1, 10, 100]) {
  parts.push(
    `<line x1="${m.left}" x2="${W - m.right}" y1="${y(tick)}" y2="${y(tick)}" stroke="#8884" />`,
    `<text x="${m.left - 8}" y="${y(tick) + 4}" text-anchor="end">${tick} мс</text>`,
  );
}
xs.forEach((c, i) => {
  parts.push(`<text x="${x(i)}" y="${H - m.bottom + 22}" text-anchor="middle">${c}</text>`);
});
parts.push(
  `<text x="${m.left + innerW / 2}" y="${H - 12}" text-anchor="middle">клієнтів (ботів)</text>`,
  `<line x1="${m.left}" x2="${W - m.right}" y1="${y(rooms.budgetMs)}" y2="${y(rooms.budgetMs)}" stroke="#d6293a" stroke-width="2" stroke-dasharray="6 4" />`,
  `<text x="${W - m.right + 6}" y="${y(rooms.budgetMs) + 4}" fill="#d6293a">ліміт ${rooms.budgetMs.toFixed(1)} мс</text>`,
);

series.forEach((s, k) => {
  const points = s.data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  parts.push(
    `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} />`,
  );
  s.data.forEach((v, i) =>
    parts.push(
      `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.color}"><title>${s.name}: ${v} мс</title></circle>`,
    ),
  );
  const ly = m.top + 10 + k * 20;
  parts.push(
    `<line x1="${W - m.right + 6}" x2="${W - m.right + 30}" y1="${ly}" y2="${ly}" stroke="${s.color}" stroke-width="2.5" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} />`,
    `<text x="${W - m.right + 36}" y="${ly + 4}" font-size="11">${s.name}</text>`,
  );
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">
<rect width="${W}" height="${H}" fill="#ffffff" />
<style>text{fill:#222}</style>
<text x="${m.left}" y="22" font-size="14" font-weight="600">Час кроку сервера залежно від кількості клієнтів (логарифмічна вісь)</text>
${parts.join('\n')}
</svg>
`;

await writeFile('docs/perf/load.svg', svg);
console.log('docs/perf/load.svg записано');
