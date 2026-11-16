import { z } from 'zod';

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`${status} ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

// ---------- Маніфест ресурсів: приходить з мережі, тому форму перевіряємо схемою ----------

const EntrySchema = z.object({
  url: z.string(),
  optional: z.boolean().optional(),
  timeoutMs: z.number().optional(),
  delayMs: z.number().optional(),
});
export type ManifestEntry = z.infer<typeof EntrySchema>;

export const ManifestSchema = z.object({
  images: z.record(z.string(), EntrySchema),
  sounds: z.record(z.string(), EntrySchema),
  json: z.record(z.string(), EntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface LoadedAssets {
  images: Record<string, HTMLImageElement>;
  sounds: Record<string, AudioBuffer>;
  json: Record<string, unknown>;
}

export interface LoadFailure {
  key: string;
  error: Error;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  accept?: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

// fetch не reject-иться на 404, тому перевіряємо ok самі.
// Таймаут і зовнішній signal зливаємо в один.
export async function fetchOk(
  url: string,
  { signal, timeoutMs = 8000, accept, method, body, headers }: FetchOptions = {},
): Promise<Response> {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);

  const init: RequestInit = {
    signal: AbortSignal.any(signals),
    headers: { ...headers, ...(accept && { Accept: accept }) },
  };
  if (method) init.method = method;
  if (body !== undefined) init.body = body;

  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

// Результат мережі - unknown: хто викликає, той і перевіряє схемою.
export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const res = await fetchOk(url, { ...opts, accept: 'application/json' });
  const body: unknown = await res.json();
  return body;
}

export async function loadImage(url: string, opts: FetchOptions = {}): Promise<HTMLImageElement> {
  const res = await fetchOk(url, { ...opts, accept: 'image/*' });
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to decode ${url}`));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// декодуємо ще на екрані завантаження, щоб перший постріл не гальмував
export async function loadAudio(
  ctx: AudioContext,
  url: string,
  opts: FetchOptions = {},
): Promise<AudioBuffer> {
  const res = await fetchOk(url, { ...opts, accept: 'audio/*' });
  return ctx.decodeAudioData(await res.arrayBuffer());
}

// повторюємо лише те, що може минути саме: мережа, таймаут, 5xx.
// 4xx, abort і битий JSON повтором не лікуються.
function isTransient(err: unknown): boolean {
  if (err instanceof HttpError) return err.status >= 500;
  return err instanceof Error && (err.name === 'TypeError' || err.name === 'TimeoutError');
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  signal?: AbortSignal;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 300, signal }: RetryOptions = {},
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (i >= attempts - 1 || signal?.aborted || !isTransient(err)) throw err;
      const delay = baseMs * 2 ** i * (0.5 + Math.random() * 0.5);
      await sleep(delay, signal);
    }
  }
}

type Group = keyof Manifest;
interface Job {
  group: Group;
  key: string;
  entry: ManifestEntry;
}

export interface LoadOptions {
  ctx: AudioContext;
  onProgress?: (progress: number, label: string) => void;
  signal?: AbortSignal;
}

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

export async function loadAll(
  manifest: Manifest,
  { ctx, onProgress = () => {}, signal }: LoadOptions,
): Promise<{ assets: LoadedAssets; failed: LoadFailure[] }> {
  const groups: Group[] = ['images', 'sounds', 'json'];
  const jobs: Job[] = groups.flatMap((group) =>
    Object.entries(manifest[group]).map(([key, entry]) => ({ group, key, entry })),
  );

  const inner = new AbortController();
  const combined = signal ? AbortSignal.any([signal, inner.signal]) : inner.signal;
  const assets: LoadedAssets = { images: {}, sounds: {}, json: {} };
  const failed: LoadFailure[] = [];
  let done = 0;

  async function loadJob({ group, key, entry }: Job): Promise<void> {
    const opts: FetchOptions = { signal: combined };
    if (entry.timeoutMs !== undefined) opts.timeoutMs = entry.timeoutMs;
    const retry = { signal: combined };

    try {
      if (entry.delayMs) await sleep(entry.delayMs, combined);
      switch (group) {
        case 'images':
          assets.images[key] = await withRetry(() => loadImage(entry.url, opts), retry);
          return;
        case 'sounds':
          assets.sounds[key] = await withRetry(() => loadAudio(ctx, entry.url, opts), retry);
          return;
        case 'json':
          assets.json[key] = await withRetry(() => fetchJson(entry.url, opts), retry);
          return;
        default: {
          const unreachable: never = group;
          return unreachable;
        }
      }
    } catch (err: unknown) {
      if (!entry.optional || combined.aborted) throw err;
      failed.push({ key: `${group}/${key}`, error: toError(err) });
    }
  }

  const pending = jobs.map((job) =>
    loadJob(job).then(() => {
      done += 1;
      onProgress(done / jobs.length, `${job.group}/${job.key}`);
    }),
  );

  try {
    await Promise.all(pending);
  } catch (err: unknown) {
    inner.abort(); // Promise.all сусідів не зупиняє - зупиняємо самі
    throw err;
  }

  return { assets, failed };
}
