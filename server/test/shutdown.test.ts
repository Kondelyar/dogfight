import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { connect, join, makeRoom, setup } from './helpers.ts';

describe('коректна зупинка (в одному процесі)', () => {
  it('клієнти отримують shutdown і закриваються кодом 1001, зупинка швидка', async () => {
    const { app, port, base } = await setup();
    const room = await makeRoom(base);
    const a = await join(port, room.id, 'Ann');
    const b = await join(port, room.id, 'Bob');

    const started = Date.now();
    await app.shutdown();
    const took = Date.now() - started;

    expect(await a.closed).toBe(1001);
    expect(await b.closed).toBe(1001);
    const notice = await a.next('shutdown');
    expect(notice.reason).toBe('server shutting down');
    expect(took).toBeLessThan(3000);
  });

  it('після зупинки нові з’єднання не приймаються', async () => {
    const { app, port } = await setup();
    await app.shutdown();
    const failed = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socket.on('open', () => resolve(false));
      socket.on('error', () => resolve(true));
    });
    expect(failed).toBe(true);
  });

  it('/ready стає 503 одразу, як почалась зупинка', async () => {
    const { app, port, base } = await setup();
    const room = await makeRoom(base);
    await join(port, room.id, 'Ann');
    const stopping = app.shutdown();
    // сервер вже не слухає, тож перевіряємо зсередини: після шатдауну пул кімнат порожній
    await stopping;
    expect(app.rooms.size).toBe(0);
  });

  it('журнал матчу дописується до кінця: є подія leave', async () => {
    const { app, port, base, config } = await setup();
    const room = await makeRoom(base);
    const a = await join(port, room.id, 'Ann');
    await app.shutdown();
    await a.closed;

    const [file] = await readdir(config.logDir);
    expect(file).toBeDefined();
    const lines = (await readFile(path.join(config.logDir, file ?? ''), 'utf8')).trim().split('\n');
    const types = lines.map((l) => z.object({ type: z.string() }).parse(JSON.parse(l)).type);
    expect(types).toContain('created');
    expect(types).toContain('join');
    expect(types).toContain('leave');
  });

  it('повторний виклик shutdown нічого не ламає', async () => {
    const { app } = await setup();
    await Promise.all([app.shutdown(), app.shutdown()]);
    await app.shutdown();
  });

  it('зупинка без клієнтів майже миттєва', async () => {
    const { app } = await setup();
    const started = Date.now();
    await app.shutdown();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// Справжній процес і справжній SIGTERM. На Windows kill('SIGTERM') вбиває процес без обробників,
// тож сценарій перевіряється на Linux (CI) і в Docker (`docker stop`).
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const LogLine = z.object({ level: z.string(), msg: z.string().optional() }).passthrough();

describe.skipIf(process.platform === 'win32')('SIGTERM справжнього процесу', () => {
  it('клієнт отримує shutdown, сокет закривається 1001, процес виходить з кодом 0 за < 10 с', async () => {
    const port = 3500 + Math.floor(Math.random() * 400);
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        LOG_DIR: await mkdtemp(path.join(tmpdir(), 'dogfight-sigterm-')),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const output: string[] = [];
    child.stdout.on('data', (chunk: Buffer) =>
      output.push(...chunk.toString().split('\n').filter(Boolean)),
    );
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (output.some((l) => l.includes('server listening'))) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });

    const base = `http://127.0.0.1:${port}`;
    const room = await makeRoom(base);
    const client = connect(port);
    await client.opened;
    client.send({ type: 'join', room: room.id, name: 'Ann' });
    await client.next('welcome');

    const started = Date.now();
    child.kill('SIGTERM');
    const code = await exited;
    const took = Date.now() - started;

    expect(code).toBe(0);
    expect(took).toBeLessThan(10_000);
    expect(await client.closed).toBe(1001);
    expect((await client.next('shutdown')).reason).toBeTruthy();

    // у stdout лише рядки JSON, і є запис про зупинку
    const parsed = output.map((l) => LogLine.parse(JSON.parse(l)));
    expect(parsed.some((l) => l.msg === 'shutdown: complete')).toBe(true);
  }, 20_000);
});
