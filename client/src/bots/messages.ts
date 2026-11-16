import { z } from 'zod';

// Повідомлення між головним потоком і воркером ботів. postMessage віддає unknown,
// тому кожна сторона перевіряє те, що отримала, схемою.
export const ToWorkerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    wsUrl: z.string(),
    roomId: z.string(),
    count: z.number().int().min(1).max(64),
    seed: z.number().int(),
  }),
  z.object({ type: z.literal('stop') }),
]);
export type ToWorker = z.infer<typeof ToWorkerSchema>;

export const FromWorkerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('stats'), snapshots: z.number(), connected: z.number() }),
]);
export type FromWorker = z.infer<typeof FromWorkerSchema>;
