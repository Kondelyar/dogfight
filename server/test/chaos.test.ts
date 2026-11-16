import { describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { BotClient, toWsUrl } from '../scripts/botClient.ts';
import { connect, join, makeRoom, setup } from './helpers.ts';

const StatsSchema = z.object({
  rooms: z.array(
    z.object({
      room: z.string(),
      players: z.number(),
      tick: z.number(),
      tickMs: z.object({ p50: z.number(), p99: z.number(), max: z.number() }),
    }),
  ),
});

async function statsOf(base: string, roomId: string) {
  const { rooms } = StatsSchema.parse(await (await fetch(`${base}/api/stats`)).json());
  const found = rooms.find((r) => r.room === roomId);
  if (!found) throw new Error(`кімнати ${roomId} нема в статистиці`);
  return found;
}

describe('збої: клієнт зникає посеред матчу', () => {
  it('обрив з’єднання без закриття (terminate): гравець зникає з кімнати, інші грають далі', async () => {
    const { app, port, base } = await setup();
    const room = await makeRoom(base);
    const a = await join(port, room.id, 'Ann');
    const b = await join(port, room.id, 'Bob');
    await a.next('roster', (m) => m.players.length === 2);
    await sleep(200);

    const tickBefore = (await statsOf(base, room.id)).tick;
    b.socket.terminate(); // як вимкнений Wi-Fi: жодного close-рукостискання

    const roster = await a.next('roster', (m) => m.players.length === 1);
    expect(roster.players).toEqual(['Ann']);

    await sleep(300);
    const after = await statsOf(base, room.id);
    expect(after.players).toBe(1);
    expect(after.tick).toBeGreaterThan(tickBefore); // матч не зупинився
    expect(a.snapshots().at(-1)?.tick ?? 0).toBeGreaterThan(tickBefore);

    a.socket.close();
    await app.shutdown();
  });

  it('усі гравці зникли: кімната видаляється, процес живий і приймає нових', async () => {
    const { app, port, base } = await setup();
    const first = await makeRoom(base, 'one');
    const a = await join(port, first.id, 'Ann');
    a.socket.terminate();
    await sleep(200);
    expect(app.rooms.size).toBe(0);

    const second = await makeRoom(base, 'two');
    const b = await join(port, second.id, 'Bob');
    expect(b.welcome.tickRate).toBe(30);
    b.socket.close();
    await app.shutdown();
  });
});

describe('збої: потік битих кадрів', () => {
  it('~1000 битих кадрів за секунду: порушника відключено, час кроку інших кімнат не росте', async () => {
    const { app, port, base } = await setup();

    // кімната B: боти грають як звичайно
    const quiet = await makeRoom(base, 'quiet');
    const bots = [1, 2, 3].map(
      (n) => new BotClient({ wsUrl: toWsUrl(base), roomId: quiet.id, name: `bot${n}`, seed: n }),
    );
    await Promise.all(bots.map((bot) => bot.opened));
    await sleep(800);
    const before = await statsOf(base, quiet.id);

    // кімната A: зловмисник
    const noisy = await makeRoom(base, 'noisy');
    const attacker = connect(port);
    await attacker.opened;
    attacker.send({ type: 'join', room: noisy.id, name: 'Mallory' });
    await attacker.next('welcome');

    const started = Date.now();
    let sent = 0;
    // 1000 кадрів/с протягом 1.5 с: суміш битого JSON, сміття й обрізаного бінарного
    for (let i = 0; i < 1500 && attacker.socket.readyState === 1; i++) {
      attacker.socket.send(
        i % 3 === 0
          ? '{broken json'
          : i % 3 === 1
            ? 'not json at all'
            : new Uint8Array([1, 2, 3, i & 255]),
      );
      sent++;
      if (i % 50 === 49) await sleep(50);
    }
    const code = await attacker.closed;
    const disconnectedAfter = Date.now() - started;

    expect(code).toBe(4000); // BAD_MESSAGE
    expect(disconnectedAfter).toBeLessThan(2000);
    expect(sent).toBeLessThan(1500); // відключили ще до кінця потоку

    await sleep(500);
    const during = await statsOf(base, quiet.id);
    expect(during.tickMs.p99).toBeLessThan(33); // крок інших кімнат у межах 33 мс
    expect(during.tickMs.p99).toBeLessThan(before.tickMs.p99 + 10); // і не виріс помітно
    expect((await statsOf(base, quiet.id)).players).toBe(3);

    const metrics = await (await fetch(`${base}/metrics`)).text();
    expect(metrics).toMatch(/dogfight_bad_frames_total [1-9]/);

    bots.forEach((bot) => bot.stop());
    await app.shutdown();
  });

  it('потік коректних, але частих повідомлень: rate limit (4003)', async () => {
    const { app, port, base } = await setup({ ratePerSec: 5, rateBurst: 5 });
    const room = await makeRoom(base);
    const c = await join(port, room.id, 'Spam');
    for (let i = 0; i < 100; i++) c.send({ type: 'chat', text: `m${i}` });
    expect(await c.closed).toBe(4003);
    await app.shutdown();
  });

  it('бінарне сміття поза join: теж відключення, а не падіння процесу', async () => {
    const { app, port, base } = await setup();
    const c = connect(port);
    await c.opened;
    c.socket.send(new Uint8Array(500).fill(255));
    expect(await c.closed).toBe(4000);
    expect((await fetch(`${base}/health`)).status).toBe(200); // сервер живий
    await app.shutdown();
  });
});
