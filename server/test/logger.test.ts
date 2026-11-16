import { describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { createLogger } from '../src/logger.ts';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { connect, makeRoom, setup } from './helpers.ts';

const Line = z
  .object({ level: z.string(), time: z.string(), msg: z.string().optional() })
  .passthrough();

function capture(level: 'info' | 'debug' = 'info') {
  const lines: string[] = [];
  const log = createLogger(
    { logLevel: level, gitSha: 'abc123' },
    { write: (s: string) => void lines.push(s) },
  );
  const parsed = () => lines.map((l) => Line.parse(JSON.parse(l)));
  return { log, lines, parsed };
}

describe('pino: логи це рядки JSON', () => {
  it('кожен запис це один рядок JSON із рівнем словом, часом ISO і sha збірки', () => {
    const { log, lines, parsed } = capture();
    log.info({ room: 'r1' }, 'hello');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    const [entry] = parsed();
    expect(entry).toMatchObject({ level: 'info', msg: 'hello', room: 'r1', sha: 'abc123' });
    expect(Number.isNaN(Date.parse(entry?.time ?? ''))).toBe(false);
  });

  it('child-логер додає id кімнати і гравця до кожного запису', () => {
    const { log, parsed } = capture();
    log.child({ room: 'r1' }).child({ player: 'p9' }).warn('bad');
    expect(parsed()[0]).toMatchObject({ room: 'r1', player: 'p9', level: 'warn' });
  });

  it('паролі, токени й ключі затираються, навіть якщо їх випадково передали', () => {
    const { log, lines } = capture();
    log.info(
      { password: 'hunter2', token: 'abc', apiKey: 'k-123', user: { password: 'x', secret: 'y' } },
      'oops',
    );
    const text = lines.join('');
    for (const secret of ['hunter2', 'abc"', 'k-123', '"x"', '"y"'])
      expect(text).not.toContain(secret);
    expect(text).toContain('[redacted]');
  });

  it('рівень silent нічого не пише, debug пропускається на info', () => {
    const quiet = createLogger({ logLevel: 'silent', gitSha: 'x' }, { write: () => {} });
    expect(quiet.level).toBe('silent');
    const { log, lines } = capture('info');
    log.debug('hidden');
    expect(lines).toHaveLength(0);
  });

  it('помилка серіалізується зі стеком', () => {
    const { log, parsed } = capture();
    log.error({ err: new Error('boom') }, 'failed');
    const entry = z
      .object({ err: z.object({ message: z.string(), stack: z.string() }) })
      .parse(parsed()[0]);
    expect(entry.err.message).toBe('boom');
  });
});

describe('логи сервера', () => {
  it('вхід гравця: запис містить id кімнати і гравця, і жодних секретів', async () => {
    const lines: string[] = [];
    const config = {
      ...loadConfig({ GIT_SHA: 'sha-777', APP_VERSION: 'v9' }),
      port: 0,
      host: '127.0.0.1',
      seed: 1,
      logLevel: 'info' as const,
    };
    const log = createLogger(config, { write: (s: string) => void lines.push(s) });
    const app = createApp(config, { log });
    const port = await app.start();
    const base = `http://127.0.0.1:${port}`;

    const room = await makeRoom(base, 'logged');
    const c = connect(port);
    await c.opened;
    c.send({ type: 'join', room: room.id, name: 'Ann' });
    await c.next('welcome');
    c.socket.close();
    await c.closed;
    await sleep(100);
    await app.shutdown();

    const entries = lines.map((l) => Line.parse(JSON.parse(l)));
    const joined = entries.find((e) => e.msg === 'player joined');
    expect(joined).toMatchObject({ room: room.id, name: 'Ann', sha: 'sha-777' });
    expect(typeof joined?.['player']).toBe('string');
    expect(entries.map((e) => e.msg)).toEqual(
      expect.arrayContaining([
        'server listening',
        'room created',
        'player left',
        'shutdown: complete',
      ]),
    );
    const text = lines.join('');
    expect(text).not.toMatch(/password|secret|token/i);
  });

  it('відмова на рукостисканні потрапляє в лог із причиною', async () => {
    const lines: string[] = [];
    const { config } = await setup({ logLevel: 'silent' }).then(async (s) => {
      await s.app.shutdown();
      return s;
    });
    const log = createLogger(
      { logLevel: 'warn', gitSha: 'x' },
      { write: (s: string) => void lines.push(s) },
    );
    const app = createApp({ ...config, port: 0, logLevel: 'warn' }, { log });
    const port = await app.start();
    const { WebSocket } = await import('ws');
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Origin: 'https://evil.example' },
      });
      socket.on('unexpected-response', (_req, res) => {
        res.resume();
        resolve();
      });
      socket.on('error', () => {});
    });
    await app.shutdown();
    const refused = lines
      .map((l) => Line.parse(JSON.parse(l)))
      .find((e) => e.msg === 'websocket handshake refused');
    expect(refused).toMatchObject({
      reason: 'origin',
      origin: 'https://evil.example',
      level: 'warn',
    });
  });
});
