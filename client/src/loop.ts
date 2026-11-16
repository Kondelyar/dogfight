import type { LoopStats } from './render/draw.ts';

export interface LoopOptions {
  step?: number;
  simulate(step: number): void;
  render(alpha: number): void;
}

export interface Loop {
  start(): void;
  stop(): void;
  stats: LoopStats;
}

export function createLoop({ step = 1 / 60, simulate, render }: LoopOptions): Loop {
  let accumulator = 0;
  let last = 0;
  let rafId: number | null = null;

  let stepsThisSecond = 0;
  let framesThisSecond = 0;
  let statTimer = 0;

  const stats: LoopStats = { stepsPerSecond: 0, framesPerSecond: 0, frameMs: 0 };

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;

    accumulator += dt;
    while (accumulator >= step) {
      simulate(step);
      accumulator -= step;
      stepsThisSecond++;
    }

    render(accumulator / step);
    framesThisSecond++;

    statTimer += dt;
    if (statTimer >= 1) {
      stats.stepsPerSecond = stepsThisSecond;
      stats.framesPerSecond = framesThisSecond;
      stepsThisSecond = 0;
      framesThisSecond = 0;
      statTimer = 0;
    }
    stats.frameMs = dt * 1000;

    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      last = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    stats,
  };
}
