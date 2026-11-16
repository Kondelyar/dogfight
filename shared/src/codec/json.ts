import { fail, ok, type Result } from '../brand.ts';
import { BINARY_VERSION } from '../protocol.ts';
import { parseServerMessage, type ControlInput, type Snapshot } from '../messages.ts';

// той самий зміст, що й у бінарного кодека, але текстом (для порівняння байтів і часу)
export function encodeInput(input: ControlInput): string {
  return JSON.stringify({ v: BINARY_VERSION, type: 'input', ...input });
}

export function encodeSnapshot({ tick, ack, entities, events }: Snapshot): string {
  return JSON.stringify({ v: BINARY_VERSION, type: 'snapshot', tick, ack, entities, events });
}

// Текст з мережі: перевіряємо схемою, а не довіряємо JSON.parse.
export function decodeSnapshot(text: string): Result<Snapshot> {
  const parsed = parseServerMessage(text);
  if (!parsed.ok) return parsed;
  const msg = parsed.value;
  if (msg.type !== 'snapshot') return fail(`expected snapshot, got ${msg.type}`);
  return ok({ tick: msg.tick, ack: msg.ack, entities: msg.entities, events: msg.events });
}
