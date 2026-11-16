import { createReadStream } from 'node:fs';
import { RoomLogEventSchema, type RoomLogEvent } from './events.ts';

function parseLine(line: string): RoomLogEvent {
  const raw: unknown = JSON.parse(line);
  return RoomLogEventSchema.parse(raw); // файл на диску теж ввід: перевіряємо схемою
}

// читає файл шматками і віддає розібрані події, не тримаючи весь файл у пам'яті
export async function* replay(file: string): AsyncGenerator<RoomLogEvent> {
  let tail = '';
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    const lines = (tail + chunk).split('\n');
    tail = lines.pop() ?? '';
    for (const line of lines) {
      if (line) yield parseLine(line);
    }
  }
  if (tail) yield parseLine(tail);
}
