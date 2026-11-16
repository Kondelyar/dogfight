import { describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { BotClient, toWsUrl } from '../scripts/botClient.ts';
import { makeRoom, setup } from './helpers.ts';

const StatsSchema = z.object({
  rooms: z.array(z.object({ players: z.number(), tick: z.number() })),
});

describe('боти (той самий протокол, що й у людини)', () => {
  it('кілька ботів заходять у кімнату, отримують знімки й рухають кораблі', async () => {
    const { app, port, base } = await setup();
    const room = await makeRoom(base);
    const bots = [1, 2, 3].map(
      (n) => new BotClient({ wsUrl: toWsUrl(base), roomId: room.id, name: `bot${n}`, seed: n }),
    );
    await Promise.all(bots.map((b) => b.opened));
    await sleep(700);

    for (const bot of bots) {
      expect(bot.snapshots).toBeGreaterThan(10);
      expect(bot.bytesIn).toBeGreaterThan(0);
      expect(bot.closeCode).toBeNull();
    }
    const { rooms } = StatsSchema.parse(await (await fetch(`${base}/api/stats`)).json());
    expect(rooms[0]?.players).toBe(3);
    expect(port).toBeGreaterThan(0);

    bots.forEach((b) => b.stop());
    await sleep(100);
    await app.shutdown();
  });

  it('бот не відрізняється від людини: сервер приймає його інпути без закриття сокета', async () => {
    const { app, base } = await setup();
    const room = await makeRoom(base);
    const bot = new BotClient({ wsUrl: toWsUrl(base), roomId: room.id, name: 'solo', seed: 5 });
    await bot.opened;
    await sleep(1200);
    expect(bot.closeCode).toBeNull(); // жодного 4000 (поганий кадр) чи 4003 (rate limit)
    bot.stop();
    await app.shutdown();
  });

  it('toWsUrl перетворює http на ws', () => {
    expect(toWsUrl('http://localhost:3000')).toBe('ws://localhost:3000/ws');
    expect(toWsUrl('https://game.example')).toBe('wss://game.example/ws');
  });
});
