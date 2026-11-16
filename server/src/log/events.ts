import { z } from 'zod';

// Журнал матчу: те, що кімната пише в NDJSON і що replay читає назад з диска.
export const RoomLogEventSchema = z.discriminatedUnion('type', [
  z.object({ t: z.number(), type: z.literal('created'), name: z.string() }),
  z.object({ t: z.number(), type: z.literal('join'), player: z.string() }),
  z.object({ t: z.number(), type: z.literal('leave'), player: z.string() }),
  z.object({ t: z.number(), type: z.literal('chat'), player: z.string(), text: z.string() }),
]);

export type RoomLogEvent = z.infer<typeof RoomLogEventSchema>;
