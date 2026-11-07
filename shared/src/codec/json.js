import { BINARY_VERSION } from '../protocol.js';

// той самий зміст, що й у бінарного кодека, але текстом (для порівняння байтів і часу)
export function encodeInput(input) {
  return JSON.stringify({ v: BINARY_VERSION, type: 'input', ...input });
}

export function encodeSnapshot({ tick, ack, entities, events }) {
  return JSON.stringify({ v: BINARY_VERSION, type: 'snapshot', tick, ack, entities, events });
}

export function decodeSnapshot(text) {
  const msg = JSON.parse(text);
  return { tick: msg.tick, ack: msg.ack, entities: msg.entities, events: msg.events };
}
