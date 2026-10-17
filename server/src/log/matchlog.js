import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { on } from 'node:events';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// об'єкт на вході -> рядок NDJSON на виході
export function toNdjson() {
  return new Transform({
    writableObjectMode: true,
    transform(event, _encoding, callback) {
      callback(null, JSON.stringify(event) + '\n');
    },
  });
}

async function* eventsOf(events) {
  try {
    for await (const [event] of events) yield event;
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  }
}

export function startMatchLog(room, logDir) {
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
