import { createReadStream } from 'node:fs';

// читає файл шматками і віддає розібрані події, не тримаючи весь файл у пам'яті
export async function* replay(file) {
  let tail = '';
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    const lines = (tail + chunk).split('\n');
    tail = lines.pop();
    for (const line of lines) {
      if (line) yield JSON.parse(line);
    }
  }
  if (tail) yield JSON.parse(tail);
}
