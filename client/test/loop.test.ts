import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoop } from '../src/loop.ts';

// Ігровий цикл під фейковими таймерами: час рухаємо руками, браузера не потрібно.
describe('createLoop (фейкові таймери)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('секунда при 60 Гц дає ~60 кроків симуляції і ~60 кадрів', () => {
    const simulate = vi.fn();
    const render = vi.fn();
    const loop = createLoop({ step: 1 / 60, simulate, render });
    loop.start();
    vi.advanceTimersByTime(1000);
    loop.stop();

    expect(simulate.mock.calls.length).toBeGreaterThanOrEqual(58);
    expect(simulate.mock.calls.length).toBeLessThanOrEqual(61);
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(58);
  });

  it('simulate завжди отримує фіксований крок, незалежно від частоти кадрів', () => {
    const steps = new Set<number>();
    const loop = createLoop({ step: 1 / 30, simulate: (s) => steps.add(s), render: () => {} });
    loop.start();
    vi.advanceTimersByTime(500);
    loop.stop();
    expect([...steps]).toEqual([1 / 30]);
  });

  it('render отримує alpha від 0 до 1 (частка кроку, що лишилась)', () => {
    const alphas: number[] = [];
    const loop = createLoop({ step: 1 / 20, simulate: () => {}, render: (a) => alphas.push(a) });
    loop.start();
    vi.advanceTimersByTime(300);
    loop.stop();
    expect(alphas.length).toBeGreaterThan(5);
    expect(alphas.every((a) => a >= 0 && a < 1)).toBe(true);
  });

  it('після довгої паузи дельта обрізається до 0.25 с (немає «спіралі смерті»)', () => {
    // ручний rAF: самі вирішуємо, коли і з яким часом викликається кадр
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('performance', { now: () => 0 });

    const simulate = vi.fn();
    const loop = createLoop({ step: 1 / 60, simulate, render: () => {} });
    loop.start();
    frame?.(5000); // вкладка «заснула» на 5 с
    loop.stop();

    // 0.25 с / (1/60 с) = 15 кроків, а не 300
    expect(simulate.mock.calls.length).toBeLessThanOrEqual(15);
    expect(simulate.mock.calls.length).toBeGreaterThanOrEqual(14);
    vi.unstubAllGlobals();
  });

  it('stats оновлюються раз на секунду', () => {
    const loop = createLoop({ step: 1 / 60, simulate: () => {}, render: () => {} });
    loop.start();
    expect(loop.stats.framesPerSecond).toBe(0);
    vi.advanceTimersByTime(1100);
    loop.stop();
    expect(loop.stats.framesPerSecond).toBeGreaterThan(50);
    expect(loop.stats.stepsPerSecond).toBeGreaterThan(50);
    expect(loop.stats.frameMs).toBeGreaterThan(0);
  });

  it('stop зупиняє кадри, повторний start відновлює', () => {
    const render = vi.fn();
    const loop = createLoop({ step: 1 / 60, simulate: () => {}, render });
    loop.start();
    vi.advanceTimersByTime(100);
    loop.stop();
    const frames = render.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(render.mock.calls.length).toBe(frames);
    loop.start();
    vi.advanceTimersByTime(100);
    expect(render.mock.calls.length).toBeGreaterThan(frames);
    loop.stop();
  });
});
