import { BotRunner, type BotRunnerOptions } from './botRunner.ts';
import { FromWorkerSchema, type ToWorker } from './messages.ts';

export type BotMode = 'main' | 'worker';

export interface BotHandle {
  mode: BotMode;
  stop(): void;
}

// ?bots=8&botMode=worker|main - боти для навантаження. Той самий код, різне місце виконання:
// так можна чесно порівняти кадр з ботами на головному потоці і в Web Worker.
export function startBots(mode: BotMode, opts: BotRunnerOptions): BotHandle {
  if (mode === 'main') {
    const runner = new BotRunner(opts);
    runner.start();
    return { mode, stop: () => runner.stop() };
  }

  const worker = new Worker(new URL('./bots.worker.ts', import.meta.url), { type: 'module' });
  const start: ToWorker = { type: 'start', ...opts };
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const msg = FromWorkerSchema.safeParse(event.data);
    if (msg.success && msg.data.type === 'ready') worker.postMessage(start);
  });
  return {
    mode,
    stop() {
      const stop: ToWorker = { type: 'stop' };
      worker.postMessage(stop);
      worker.terminate();
    },
  };
}
