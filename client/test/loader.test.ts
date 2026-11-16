import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  ManifestSchema,
  fetchJson,
  fetchOk,
  sleep,
  withRetry,
  type Manifest,
} from '../src/assets/loader.ts';
import { applyTestMode } from '../src/assets/testMode.ts';

const manifest = (): Manifest => ({
  images: { sheet: { url: '/a.png' } },
  sounds: { hit: { url: '/hit.wav', optional: true } },
  json: { arena: { url: '/arena.json' } },
});

describe('fetchOk / fetchJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('404 це HttpError (fetch сам не кидає на 404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 404 })),
    );
    await expect(fetchOk('/x')).rejects.toMatchObject({ name: 'HttpError', status: 404 });
  });

  it('fetchJson повертає unknown, який ще треба перевірити схемою', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"a":1}')),
    );
    expect(await fetchJson('/x')).toEqual({ a: 1 });
  });

  it('заголовок Accept і метод передаються в запит', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await fetchJson('/x', { method: 'POST', body: '{}', headers: { 'X-Test': '1' } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Accept: 'application/json', 'X-Test': '1' });
  });
});

describe('withRetry (фейкові таймери)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('повторює тимчасові помилки (5xx, мережа) і зрештою віддає результат', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpError(503, '/x'))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValue('ok');
    const promise = withRetry(fn, { attempts: 3, baseMs: 100 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('4xx повтором не лікується: падає одразу', async () => {
    const fn = vi.fn(async () => {
      throw new HttpError(404, '/x');
    });
    await expect(withRetry(fn, { attempts: 3 })).rejects.toMatchObject({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('після всіх спроб кидає останню помилку', async () => {
    const fn = vi.fn(async () => {
      throw new HttpError(500, '/x');
    });
    const promise = withRetry(fn, { attempts: 2, baseMs: 10 });
    const assertion = expect(promise).rejects.toMatchObject({ status: 500 });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sleep перериваєтьсяsignal-ом', async () => {
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    const assertion = expect(promise).rejects.toBeDefined();
    controller.abort(new Error('stop'));
    await assertion;
  });
});

describe('манифест і ?test=', () => {
  it('схема приймає правильний манифест і відхиляє зіпсований', () => {
    expect(ManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(ManifestSchema.safeParse({ images: {} }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...manifest(), json: { arena: { url: 5 } } }).success).toBe(
      false,
    );
  });

  it('?test=404 додає неіснуючий необов’язковий файл', () => {
    const m = applyTestMode(manifest(), '404');
    expect(m.images['nebula']).toEqual({ url: '/assets/nebula.png', optional: true });
  });

  it('?test=badjson додає зіпсований json', () => {
    expect(applyTestMode(manifest(), 'badjson').json['broken']?.optional).toBe(true);
  });

  it('?test=timeout ставить таймаут 1 мс для arena.json', () => {
    expect(applyTestMode(manifest(), 'timeout').json['arena']?.timeoutMs).toBe(1);
  });

  it('?test=slow розставляє зростаючі затримки, без параметра нічого не міняється', () => {
    const slow = applyTestMode(manifest(), 'slow');
    const delays = [
      slow.images['sheet']?.delayMs,
      slow.sounds['hit']?.delayMs,
      slow.json['arena']?.delayMs,
    ];
    expect(delays).toEqual([500, 1000, 1500]);
    expect(applyTestMode(manifest(), null)).toEqual(manifest());
  });
});
