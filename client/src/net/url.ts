// Адреса сокета. З публічної сторінки (https) сокет лише wss://. Незахищений ws:// дозволений тільки
// для локальної розробки: на чужому хості він віддав би дані й Origin відкритим текстом.
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface PageLocation {
  protocol: string;
  hostname: string;
  host: string;
}

export const isLocalHost = (hostname: string): boolean =>
  LOCAL.has(hostname) || hostname.endsWith('.localhost');

export function socketScheme(page: Pick<PageLocation, 'protocol' | 'hostname'>): 'ws' | 'wss' {
  if (page.protocol === 'https:') return 'wss';
  if (isLocalHost(page.hostname)) return 'ws';
  throw new Error(
    'Сторінку на публічному хості треба відкривати по https: ws:// дозволений лише для localhost',
  );
}

export function socketUrl(page: PageLocation, query = ''): string {
  const suffix = query ? `?${query}` : '';
  return `${socketScheme(page)}://${page.host}/ws${suffix}`;
}
