import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { on } from 'node:events';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Room } from '../rooms.ts';
import { RoomLogEventSchema, type RoomLogEvent } from './events.ts';

// об'єкт на вході -> рядок NDJSON на виході
export function toNdjson(): Transform {
  return new Transform({
    writableObjectMode: true,
    transform(event: unknown, _encoding, callback) {
      callback(null, JSON.stringify(event) + '\n');
    },
  });
}

async function* eventsOf(events: AsyncIterable<unknown[]>): AsyncGenerator<RoomLogEvent> {
  try {
    for await (const args of events) {
      yield RoomLogEventSchema.parse(args[0]); // аргумент події "event", перевірений схемою
    }
  } catch (err: unknown) {
    if (!(err instanceof Error) || err.name !== 'AbortError') throw err;
  }
}

export interface MatchLog {
  file: string;
  done: Promise<void>;
  stop(): void;
}

export function startMatchLog(room: Room, logDir: string): MatchLog {
  const controller = new AbortController();
  // слухач реєструється одразу, щоб не пропустити події, поки створюється файл
  const events = on(room, 'event', { signal: controller.signal });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(logDir, `${room.id}-${stamp}.ndjson`);

  const done = (async () => {
    await mkdir(logDir, { recursive: true });
    await pipeline(Readable.from(eventsOf(events)), toNdjson(), createWriteStream(file));
  })();

  return { file, done, stop: () => controller.abort() };
}
