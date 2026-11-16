import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { clientIp, isOriginAllowed } from '../src/origin.ts';
import { makeRoom, setup } from './helpers.ts';

const open = { allowedOrigins: [], allowNoOrigin: true };

describe('isOriginAllowed (чиста функція)', () => {
  it('без списку пускає лише ту саму адресу (Origin збігається з Host)', () => {
    expect(isOriginAllowed('https://game.example', 'game.example', open)).toBe(true);
    expect(isOriginAllowed('https://evil.example', 'game.example', open)).toBe(false);
    expect(isOriginAllowed('http://localhost:3000', 'localhost:3000', open)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', 'localhost:4000', open)).toBe(false);
  });

  it('зі списком пускає лише перелічені Origin (порівнюється нормалізований origin)', () => {
    const policy = {
      allowedOrigins: ['https://game.example', 'http://localhost:5173'],
      allowNoOrigin: false,
    };
    expect(isOriginAllowed('https://game.example', 'whatever', policy)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', 'whatever', policy)).toBe(true);
    expect(isOriginAllowed('https://game.example.evil.com', 'whatever', policy)).toBe(false);
    expect(isOriginAllowed('http://game.example', 'whatever', policy)).toBe(false); // інша схема
  });

  it('відсутній Origin залежить від allowNoOrigin (боти, curl)', () => {
    expect(isOriginAllowed(undefined, 'h', { ...open, allowNoOrigin: true })).toBe(true);
    expect(isOriginAllowed(undefined, 'h', { ...open, allowNoOrigin: false })).toBe(false);
    expect(isOriginAllowed('', 'h', { ...open, allowNoOrigin: false })).toBe(false);
  });

  it('сміття, "null" і чужі схеми відхиляються завжди', () => {
    for (const bad of [
      'null',
      'not a url',
      'file:///etc/passwd',
      'chrome-extension://abc',
      'javascript:alert(1)',
    ]) {
      expect(isOriginAllowed(bad, 'h', open)).toBe(false);
    }
  });
});

describe('clientIp', () => {
  const request = (headers: Record<string, string>, remote = '10.0.0.1'): IncomingMessage => {
    const req = { headers, socket: { remoteAddress: remote } };
    // мінімальний об'єкт, достатній для clientIp
    return req as unknown as IncomingMessage;
  };

  it('без довіреного проксі бере адресу сокета, ігноруючи X-Forwarded-For', () => {
    expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4' }), false)).toBe('10.0.0.1');
  });

  it('за довіреним проксі бере перший елемент X-Forwarded-For', () => {
    expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4, 10.0.0.9' }), true)).toBe('1.2.3.4');
    expect(clientIp(request({}), true)).toBe('10.0.0.1');
  });
});

// статус відповіді на рукостискання: 101, якщо пустили, інакше код відмови
function handshake(port: number, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    socket.on('open', () => {
      socket.close();
      resolve(101);
    });
    socket.on('unexpected-response', (_req, res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    socket.on('error', () => {});
  });
}

describe('рукостискання WebSocket (живий сервер)', () => {
  it('чужий Origin отримує 403, свій і відсутній пускаються', async () => {
    const { app, port } = await setup();
    expect(await handshake(port, { Origin: 'https://evil.example' })).toBe(403);
    expect(await handshake(port, { Origin: `http://127.0.0.1:${port}` })).toBe(101);
    expect(await handshake(port)).toBe(101);
    await app.shutdown();
  });

  it('зі списком ALLOWED_ORIGINS пускає лише його', async () => {
    const { app, port } = await setup({ allowedOrigins: ['https://game.example'] });
    expect(await handshake(port, { Origin: 'https://game.example' })).toBe(101);
    expect(await handshake(port, { Origin: `http://127.0.0.1:${port}` })).toBe(403);
    await app.shutdown();
  });

  it('allowNoOrigin=false відхиляє клієнта без Origin', async () => {
    const { app, port } = await setup({ allowNoOrigin: false });
    expect(await handshake(port)).toBe(403);
    await app.shutdown();
  });

  it('ліміт з’єднань з одного IP: третє при ліміті 2 отримує 429, після закриття місце звільняється', async () => {
    const { app, port } = await setup({ maxConnPerIp: 2 });
    const keep = [0, 1].map(() => new WebSocket(`ws://127.0.0.1:${port}/ws`));
    await Promise.all(keep.map((s) => new Promise((resolve) => s.once('open', resolve))));
    expect(await handshake(port)).toBe(429);

    keep[0]?.close();
    await new Promise((resolve) => keep[0]?.once('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await handshake(port)).toBe(101);

    keep[1]?.close();
    await app.shutdown();
  });

  it('метрика rejected рахує відмови на рукостисканні', async () => {
    const { app, port, base } = await setup();
    await handshake(port, { Origin: 'https://evil.example' });
    await handshake(port, { Origin: 'https://evil2.example' });
    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).toMatch(/dogfight_rejected_total 2/);
    await app.shutdown();
  });

  it('шлях, відмінний від /ws, дає 404', async () => {
    const { app, port } = await setup();
    const status = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/other`);
      socket.on('unexpected-response', (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      socket.on('error', () => {});
    });
    expect(status).toBe(404);
    await app.shutdown();
  });

  it('кімната лишається доступною: join зі свого Origin працює повністю', async () => {
    const { app, port, base } = await setup();
    const room = await makeRoom(base);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: base } });
    const welcome = new Promise<boolean>((resolve) => {
      socket.on('message', (data, isBinary) => {
        if (!isBinary && data.toString().includes('"welcome"')) resolve(true);
      });
    });
    socket.on('open', () =>
      socket.send(JSON.stringify({ v: 1, type: 'join', room: room.id, name: 'Own' })),
    );
    expect(await welcome).toBe(true);
    socket.close();
    await app.shutdown();
  });
});
