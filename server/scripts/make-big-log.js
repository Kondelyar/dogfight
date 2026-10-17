// node scripts/make-big-log.js [файл] [мегабайти] - синтетичний лог для досліду з backpressure
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

const file = process.argv[2] ?? 'logs/big-200mb.ndjson';
const target = Number(process.argv[3] ?? 200) * 1024 * 1024;

await mkdir(path.dirname(file), { recursive: true });
const out = createWriteStream(file);

let written = 0;
for (let i = 0; written < target; i++) {
  const line = JSON.stringify({ t: i, type: 'chat', player: 'bot', text: 'x'.repeat(80) }) + '\n';
  written += Buffer.byteLength(line);
  if (!out.write(line)) await once(out, 'drain');
}
out.end();
await once(out, 'finish');
console.log(`${file}: ${(written / 1024 / 1024).toFixed(0)} MB`);
