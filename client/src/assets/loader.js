export class HttpError extends Error {
  constructor(status, url) {
    super(`${status} ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// fetch не reject-иться на 404, тому перевіряємо ok самі.
// Таймаут і зовнішній signal зливаємо в один.
export async function fetchOk(
  url,
  { signal, timeoutMs = 8000, accept, method, body, headers } = {},
) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);

  const res = await fetch(url, {
    method,
    body,
    signal: AbortSignal.any(signals),
    headers: { ...headers, ...(accept && { Accept: accept }) },
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchOk(url, { ...opts, accept: 'application/json' });
  return res.json();
}

export const loadJson = fetchJson;

export async function loadImage(url, opts = {}) {
  const res = await fetchOk(url, { ...opts, accept: 'image/*' });
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    return await new Promise((resolve, reject) => {
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
export async function loadAudio(ctx, url, opts = {}) {
  const res = await fetchOk(url, { ...opts, accept: 'audio/*' });
  return ctx.decodeAudioData(await res.arrayBuffer());
}

// повторюємо лише те, що може минути саме: мережа, таймаут, 5xx.
// 4xx, abort і битий JSON повтором не лікуються.
function isTransient(err) {
  if (err instanceof HttpError) return err.status >= 500;
  return err.name === 'TypeError' || err.name === 'TimeoutError';
}

export async function withRetry(fn, { attempts = 3, baseMs = 300, signal } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || signal?.aborted || !isTransient(err)) throw err;
      const delay = baseMs * 2 ** i * (0.5 + Math.random() * 0.5);
      await sleep(delay, signal);
    }
  }
}

const loaders = {
  images: (entry, opts) => loadImage(entry.url, opts),
  sounds: (entry, opts) => loadAudio(opts.ctx, entry.url, opts),
  json: (entry, opts) => loadJson(entry.url, opts),
};

export async function loadAll(manifest, { ctx, onProgress = () => {}, signal } = {}) {
  const entries = Object.entries(manifest).flatMap(([group, items]) =>
    Object.entries(items).map(([key, item]) => ({ group, key, ...item })),
  );

  const inner = new AbortController();
  const combined = signal ? AbortSignal.any([signal, inner.signal]) : inner.signal;
  const failed = [];
  let done = 0;

  async function loadEntry(entry) {
    try {
      if (entry.delayMs) await sleep(entry.delayMs, combined);
      return await withRetry(
        () => loaders[entry.group](entry, { ctx, signal: combined, timeoutMs: entry.timeoutMs }),
        { signal: combined },
      );
    } catch (err) {
      if (!entry.optional || combined.aborted) throw err;
      failed.push({ key: `${entry.group}/${entry.key}`, error: err });
      return null;
    }
  }

  const jobs = entries.map((entry) =>
    loadEntry(entry).then((value) => {
      done += 1;
      onProgress(done / entries.length, `${entry.group}/${entry.key}`);
      return value;
    }),
  );

  let values;
  try {
    values = await Promise.all(jobs);
  } catch (err) {
    inner.abort(); // Promise.all сусідів не зупиняє - зупиняємо самі
    throw err;
  }

  const assets = {};
  entries.forEach((entry, i) => {
    if (values[i]) (assets[entry.group] ??= {})[entry.key] = values[i];
  });
  return { assets, failed };
}
