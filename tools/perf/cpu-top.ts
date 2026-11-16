// node tools/perf/cpu-top.ts профіль.cpuprofile [N] - де йде CPU: self-час по функціях
import { readFile } from 'node:fs/promises';
import { CpuProfileSchema } from './flame.ts';

const file = process.argv[2];
if (!file) throw new Error('usage: cpu-top.ts <file.cpuprofile> [N]');
const top = Number(process.argv[3] ?? 14);
const profile = CpuProfileSchema.parse(JSON.parse(await readFile(file, 'utf8')));

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map<string, number>();
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  if (!n) return;
  const { functionName, url, lineNumber } = n.callFrame;
  const key = `${functionName || '(anonymous)'} ${url.split('/').pop() ?? ''}:${lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [key, us] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
  console.log(`${((us / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}
