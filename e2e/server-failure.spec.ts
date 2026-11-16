import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Власний процес сервера на окремому порту, щоб його можна було вбити, не зачепивши інші тести.
async function startServer(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
  const logDir = await mkdtemp(path.join(tmpdir(), 'dogfight-e2e-'));
  const child = spawn(process.execPath, ['server/src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_DIR: logDir,
      LOG_LEVEL: 'warn',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (chunk.includes('server listening')) resolve();
    });
    child.once('exit', (code) => reject(new Error(`server exited early: ${code}`)));
    // LOG_LEVEL=warn не пише "server listening", тому чекаємо готовності по /health
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) {
          clearInterval(poll);
          resolve();
        }
      } catch {
        // ще не слухає
      }
    }, 100);
    child.once('exit', () => clearInterval(poll));
  });
  return child;
}

async function joinRoom(page: Page, base: string, roomName: string): Promise<void> {
  await page.goto(`${base}/?e2e=1`);
  await page.locator('li', { hasText: roomName }).getByRole('button', { name: 'Join' }).click();
  await page.waitForFunction(() => (window.__dogfight?.lastTick() ?? 0) > 0);
}

test('сервер убито посеред гри: гравець сам повертається в лобі, а коли сервер піднявся, може зайти знову', async ({
  page,
  request,
}) => {
  const port = 3301;
  const base = `http://127.0.0.1:${port}`;
  let server = await startServer(port);
  try {
    await request.post(`${base}/api/rooms`, { data: { name: 'before-crash' } });
    await joinRoom(page, base, 'before-crash');
    await expect(page.locator('#chat')).toBeVisible();

    server.kill('SIGKILL'); // не SIGTERM: жодного shutdown, просто зник

    // кілька спроб перепідключення (0.5 + 1 + 2 + 4 с), потім лобі з поясненням
    await expect(page.locator('#overlay')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#overlay')).toContainText('Сервер недоступний');
    await expect(page.locator('#chat')).toBeHidden();

    // сервер піднявся: лобі саме оновлює список (раз на 5 с) і знову пускає в гру
    server = await startServer(port);
    await request.post(`${base}/api/rooms`, { data: { name: 'after-restart' } });
    await expect(page.locator('#overlay')).toContainText('after-restart', { timeout: 15_000 });
    await page
      .locator('li', { hasText: 'after-restart' })
      .getByRole('button', { name: 'Join' })
      .click();
    await page.waitForFunction(() => (window.__dogfight?.lastTick() ?? 0) > 0);
  } finally {
    server.kill('SIGKILL');
  }
});

test('сервер зупиняється за SIGTERM: клієнт отримує shutdown і повертається в лобі', async ({
  page,
  request,
}) => {
  test.skip(process.platform === 'win32', 'на Windows SIGTERM вбиває процес без обробників');
  const port = 3302;
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer(port);
  try {
    await request.post(`${base}/api/rooms`, { data: { name: 'graceful' } });
    await joinRoom(page, base, 'graceful');

    server.kill('SIGTERM');
    await expect(page.locator('#overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#overlay')).toContainText('Сервер зупиняється');
  } finally {
    server.kill('SIGKILL');
  }
});

test('чужий сайт не може відкрити сокет до сервера: Origin не збігається', async ({
  page,
  request,
}) => {
  // сторінка відкрита з сервера A (порт 3300), а сокет відкривається до сервера B (3303)
  const port = 3303;
  const other = await startServer(port);
  try {
    await request.get('/api/rooms');
    await page.goto('/');
    const outcome = await page.evaluate(
      (url) =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket(url);
          socket.onopen = () => resolve('open');
          socket.onerror = () => resolve('blocked');
        }),
      `ws://127.0.0.1:${port}/ws`,
    );
    expect(outcome).toBe('blocked');

    // а свій сервер пускає ту саму сторінку
    const own = await page.evaluate(
      (url) =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket(url);
          socket.onopen = () => {
            socket.close();
            resolve('open');
          };
          socket.onerror = () => resolve('blocked');
        }),
      `ws://${new URL(page.url()).host}/ws`,
    );
    expect(own).toBe('open');
  } finally {
    other.kill('SIGKILL');
  }
});
