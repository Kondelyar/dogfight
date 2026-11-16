import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

// Звідки сторінці можна вантажити ресурси. connect-src: сокет лише wss:// (ws:// дозволено тільки
// для localhost, щоб працювала розробка); 'self' покриває той самий хост.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' wss: ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function reply(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  root: string,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed');

  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return reply(res, 400, 'bad path');
  }
  if (relative.includes('\0')) return reply(res, 400, 'bad path');
  if (relative.endsWith('/')) relative += 'index.html';

  // захист від ../: після join шлях мусить лишатись всередині root
  const file = path.join(root, relative);
  if (!file.startsWith(root + path.sep)) return reply(res, 403, 'forbidden');

  let info;
  try {
    info = await stat(file);
  } catch {
    return reply(res, 404, 'not found');
  }
  if (!info.isFile()) return reply(res, 404, 'not found');

  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    // оболонка, service worker і маніфест не кешуються довго: нова версія гри має підхопитись одразу
    'Cache-Control':
      ext === '.html' || file.endsWith('sw.js') || ext === '.webmanifest'
        ? 'no-cache'
        : 'public, max-age=3600',
    ...SECURITY_HEADERS,
    ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
  });
  if (req.method === 'HEAD') return void res.end();

  await pipeline(createReadStream(file), res).catch(() => {});
}
