import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/index.ts';

type Events = { ping: number; done: null };

describe('Emitter', () => {
  it('викликає підписників із даними події', () => {
    const e = new Emitter<Events>();
    const seen: number[] = [];
    e.on('ping', (n) => seen.push(n));
    e.emit('ping', 1);
    e.emit('ping', 2);
    expect(seen).toEqual([1, 2]);
  });

  it('on повертає функцію відписки', () => {
    const e = new Emitter<Events>();
    const listener = vi.fn();
    const off = e.on('ping', listener);
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('off прибирає лише потрібного слухача', () => {
    const e = new Emitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    e.on('ping', a);
    e.on('ping', b);
    e.off('ping', a);
    e.emit('ping', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(1);
  });

  it('emit без підписників нічого не робить', () => {
    const e = new Emitter<Events>();
    expect(() => e.emit('done', null)).not.toThrow();
  });

  it('відписка під час emit не ламає обхід', () => {
    const e = new Emitter<Events>();
    const calls: string[] = [];
    const off = e.on('ping', () => {
      calls.push('first');
      off();
    });
    e.on('ping', () => calls.push('second'));
    e.emit('ping', 1);
    e.emit('ping', 2);
    expect(calls).toEqual(['first', 'second', 'second']);
  });
});
