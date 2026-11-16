// Web Worker: усі боти (з'єднання, розбір знімків, рішення) живуть тут, головний потік вільний для кадрів.
import { BotRunner } from './botRunner.ts';
import { ToWorkerSchema, type FromWorker } from './messages.ts';

let runner: BotRunner | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;

function post(message: FromWorker): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = ToWorkerSchema.safeParse(event.data);
  if (!parsed.success) return; // чужі чи зіпсовані повідомлення ігноруємо

  const msg = parsed.data;
  if (msg.type === 'start') {
    runner?.stop();
    runner = new BotRunner(msg);
    runner.start();
    statsTimer = setInterval(() => {
      if (runner) post({ type: 'stats', snapshots: runner.snapshots, connected: runner.connected });
    }, 1000);
    return;
  }

  runner?.stop();
  runner = null;
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
});

post({ type: 'ready' });
