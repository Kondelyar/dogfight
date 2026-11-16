// node server/scripts/bench-tick.ts [--ships 8] [--ticks 3000]
// Міряє справжній тік сервера (інпути -> world.step -> знімок -> кодування для кожного клієнта)
// без мережі й таймерів: у циклі викликається Match.tickOnce(). Паралельно рахує паузи GC.
import { PerformanceObserver } from 'node:perf_hooks';
import { scriptedInput, seq, tick } from 'shared';
import { Match } from '../src/match.ts';
import { RoomManager, type Player } from '../src/rooms.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1] ?? fallback) : fallback;
}

const ships = arg('ships', 8);
const ticks = arg('ticks', 3000);
const warmup = 300;

const manager = new RoomManager({ maxRooms: 1, maxPlayers: ships + 1 });
const room = manager.create('bench');
if (!room) throw new Error('room was not created');
const match = new Match(room, { seed: 7 });

let bytes = 0;
const players: Player[] = Array.from({ length: ships }, (_, i) => ({
  id: `p${i}`,
  name: `p${i}`,
  codec: 'binary',
  send() {},
  sendState(data) {
    bytes += typeof data === 'string' ? data.length : data.byteLength;
  },
}));
for (const p of players) room.join(p);
match.stop(); // тіки крутимо самі

const gcPauses: number[] = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gcPauses.push(entry.duration);
});
observer.observe({ entryTypes: ['gc'] });

const durations: number[] = [];
for (let i = 0; i < ticks + warmup; i++) {
  players.forEach((player, n) => {
    const base = scriptedInput(i + n * 7);
    // seq має рости: сервер відкидає старі й повторені
    room.emit('input', player, {
      ...base,
      seq: seq(i + 1),
      tick: tick(0),
      fire: (i + n) % 3 === 0,
    });
  });
  const start = performance.now();
  match.tickOnce();
  if (i >= warmup) durations.push(performance.now() - start);
}
await new Promise((resolve) => setTimeout(resolve, 50)); // GC-записи приходять асинхронно
observer.disconnect();

const sorted = [...durations].sort((a, b) => a - b);
const pct = (p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const round = (n: number): number => Math.round(n * 1000) / 1000;
const major = gcPauses.filter((d) => d > 5).length;

console.log(
  JSON.stringify({
    ships,
    ticks,
    tickMs: {
      p50: round(pct(50)),
      p95: round(pct(95)),
      p99: round(pct(99)),
      max: round(sorted.at(-1) ?? 0),
    },
    over33ms: sorted.filter((d) => d > 33.3).length,
    gc: {
      pauses: gcPauses.length,
      over5ms: major,
      totalMs: round(gcPauses.reduce((s, d) => s + d, 0)),
    },
    mbSent: Math.round((bytes / 1048576) * 10) / 10,
  }),
);
process.exit(0);
