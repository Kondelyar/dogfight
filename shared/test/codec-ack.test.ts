import { describe, expect, it } from 'vitest';
import { EventType, codecs, entityId, seq, tick, type Snapshot } from '../src/index.ts';

const { binary } = codecs;

const base = (): Snapshot => ({
  tick: tick(12),
  ack: seq(0),
  entities: [],
  events: [{ type: EventType.FIRED, x: 1, y: 2, owner: entityId(4) }],
});

describe('withAck (один кадр на всіх, свій ack у кожного)', () => {
  it('міняє лише ack у заголовку: решта байтів однакова', () => {
    const frame = binary.encodeSnapshot(base());
    const copy = binary.withAck(frame, seq(777));
    const a = new Uint8Array(frame);
    const b = new Uint8Array(copy);
    expect(b.length).toBe(a.length);
    const differing = [...a].flatMap((byte, i) => (byte === b[i] ? [] : [i]));
    expect(differing.every((i) => i >= 6 && i < 10)).toBe(true);
  });

  it('після withAck знімок декодується з новим ack і тим самим змістом', () => {
    const snap = base();
    const copy = binary.withAck(binary.encodeSnapshot(snap), seq(4_000_000_000));
    const decoded = binary.decodeSnapshot(copy);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.ack).toBe(4_000_000_000);
    expect(decoded.value.tick).toBe(snap.tick);
    expect(decoded.value.events).toEqual(snap.events);
  });

  it('оригінал не змінюється (копія, а не вікно на ті самі байти)', () => {
    const frame = binary.encodeSnapshot(base());
    binary.withAck(frame, seq(5));
    const decoded = binary.decodeSnapshot(frame);
    expect(decoded.ok && decoded.value.ack).toBe(0);
  });

  it('кожен клієнт отримує окремий буфер', () => {
    const frame = binary.encodeSnapshot(base());
    const a = binary.withAck(frame, seq(1));
    const b = binary.withAck(frame, seq(2));
    expect(a).not.toBe(b);
    const ackOf = (f: ArrayBuffer) => new DataView(f).getUint32(6, true);
    expect([ackOf(a), ackOf(b)]).toEqual([1, 2]);
  });
});
