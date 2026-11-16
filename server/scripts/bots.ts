// node server/scripts/bots.ts [--url http://localhost:3000] [--count 8] [--seconds 40] [--room id]
// Підключає ботів в одну кімнату (створює її, якщо --room не задано) і тримає їх N секунд.
import { setTimeout as sleep } from 'node:timers/promises';
import { BotClient, createRoom, toWsUrl } from './botClient.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const url = arg('url', 'http://localhost:3000');
const count = Number(arg('count', '8'));
const seconds = Number(arg('seconds', '40'));
const roomId = arg('room', '') || (await createRoom(url, 'bots'));

const bots = Array.from(
  { length: count },
  (_, i) => new BotClient({ wsUrl: toWsUrl(url), roomId, name: `bot${i + 1}`, seed: 1000 + i }),
);
await Promise.all(bots.map((b) => b.opened));
console.log(`room ${roomId}: ${count} ботів підключено`);

await sleep(seconds * 1000);

const snapshots = bots.reduce((sum, b) => sum + b.snapshots, 0);
console.log(
  `отримано знімків: ${snapshots}, закрито кодами: ${bots.map((b) => b.closeCode).join(',')}`,
);
for (const bot of bots) bot.stop();
