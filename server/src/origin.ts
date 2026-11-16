import type { IncomingMessage } from 'node:http';

export interface OriginPolicy {
  allowedOrigins: readonly string[];
  allowNoOrigin: boolean;
}

// Перевірка заголовка Origin на рукостисканні WebSocket. Браузер завжди шле Origin сторінки, що
// відкриває сокет, і сторонній сайт не може його підробити. Без перевірки будь-яка чужа сторінка
// могла б від імені відвідувача підключитись до нашого сервера (cross-site WebSocket hijacking).
//   - Origin немає: це не браузер (бот, curl), пускаємо лише якщо allowNoOrigin;
//   - є список allowedOrigins: Origin мусить у ньому бути;
//   - списку нема: пускаємо тільки сторінку з того самого хоста (Origin збігається з Host).
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  policy: OriginPolicy,
): boolean {
  if (origin === undefined || origin === '') return policy.allowNoOrigin;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // "null" (пісочниця) і сміття
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  if (policy.allowedOrigins.length > 0) return policy.allowedOrigins.includes(parsed.origin);
  return host !== undefined && parsed.host === host;
}

// IP клієнта: адреса сокета або, за довіреним проксі, перший елемент X-Forwarded-For.
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
