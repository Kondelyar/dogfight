import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

function reply(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export async function serveStatic(req, res, pathname, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed');

  let relative;
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
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();

  await pipeline(createReadStream(file), res).catch(() => {});
}
