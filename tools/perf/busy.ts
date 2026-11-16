// node tools/perf/busy.ts a.cpuprofile b.cpuprofile ... - скільки головний потік реально працював (без idle)
import { readFile } from 'node:fs/promises';
import { CpuProfileSchema } from './flame.ts';

for (const file of process.argv.slice(2)) {
  const profile = CpuProfileSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const names = new Map(profile.nodes.map((n) => [n.id, n.callFrame.functionName]));
  let busy = 0;
  let total = 0;
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] ?? 0;
    total += dt;
    const name = names.get(id);
    if (name !== '(idle)') busy += dt;
  });
  console.log(
    `${file.split('/').pop()}: активно ${(busy / 1000).toFixed(0)} мс із ${(total / 1000).toFixed(0)} мс = ${((busy / total) * 100).toFixed(1)} %`,
  );
}
