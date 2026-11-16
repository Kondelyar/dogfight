import { describe, expect, it } from 'vitest';
import {
  BotBrain,
  EventType,
  Kind,
  entityId,
  seq,
  tick,
  type EntityRecord,
  type Snapshot,
} from '../src/index.ts';

const ME = entityId(1);

function ship(id: number, x: number, y: number, angle: number, alive = true): EntityRecord {
  return {
    id: entityId(id),
    kind: Kind.SHIP,
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    alive,
    thrusting: false,
    hp: 100,
    score: 0,
    cooldown: 0,
    rapid: 0,
  };
}

function rock(id: number, x: number, y: number): EntityRecord {
  return {
    id: entityId(id),
    kind: Kind.ASTEROID,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 20,
    homing: false,
  };
}

const snap = (entities: EntityRecord[]): Snapshot => ({
  tick: tick(5),
  ack: seq(0),
  entities,
  events: [{ type: EventType.HIT, x: 0, y: 0 }],
});

describe('BotBrain', () => {
  it('без свого корабля (чи мертвий) нічого не натискає', () => {
    const brain = new BotBrain(1);
    expect(brain.decide(snap([]), ME)).toMatchObject({ turn: 0, thrust: false, fire: false });
    expect(brain.decide(snap([ship(1, 100, 100, 0, false)]), ME)).toMatchObject({ fire: false });
  });

  it('seq росте на одиницю з кожним рішенням, tick береться зі знімка', () => {
    const brain = new BotBrain(1);
    const a = brain.decide(snap([ship(1, 100, 100, 0)]), ME);
    const b = brain.decide(snap([ship(1, 100, 100, 0)]), ME);
    expect([a.seq, b.seq, a.tick]).toEqual([1, 2, 5]);
    expect(brain.lastSeq).toBe(2);
  });

  it('повертає до цілі найкоротшим шляхом', () => {
    const left = new BotBrain(1).decide(
      snap([ship(1, 500, 300, 0), rock(2, 500, 100)]), // ціль вгорі, корабель дивиться праворуч
      ME,
    );
    expect(left.turn).toBe(-1);

    const right = new BotBrain(1).decide(snap([ship(1, 500, 300, 0), rock(2, 500, 500)]), ME);
    expect(right.turn).toBe(1);
  });

  it('цілиться через край арени, якщо так ближче (wrap)', () => {
    const input = new BotBrain(1).decide(snap([ship(1, 10, 300, Math.PI), rock(2, 1270, 300)]), ME);
    expect(input.turn).toBe(0); // ціль «ліворуч» через край і корабель уже дивиться ліворуч
  });

  it('стріляє лише коли ціль у конусі і близько', () => {
    let fired = 0;
    for (let seed = 0; seed < 30; seed++) {
      const near = new BotBrain(seed).decide(snap([ship(1, 100, 100, 0), rock(2, 300, 100)]), ME);
      if (near.fire) fired++;
      const far = new BotBrain(seed).decide(snap([ship(1, 100, 100, 0), rock(2, 1000, 100)]), ME);
      expect(far.fire).toBe(false);
      const behind = new BotBrain(seed).decide(snap([ship(1, 100, 100, 0), rock(2, 100, 400)]), ME);
      expect(behind.fire).toBe(false);
    }
    expect(fired).toBeGreaterThan(10);
  });

  it('детермінований: однаковий seed дає однакові рішення', () => {
    const entities = [ship(1, 100, 100, 0), rock(2, 400, 120), ship(3, 700, 500, 1)];
    const a = new BotBrain(42);
    const b = new BotBrain(42);
    for (let i = 0; i < 50; i++)
      expect(a.decide(snap(entities), ME)).toEqual(b.decide(snap(entities), ME));
  });

  it('ігнорує мертві кораблі як цілі й сам себе', () => {
    const input = new BotBrain(1).decide(
      snap([ship(1, 100, 100, 0), ship(2, 300, 100, 0, false)]),
      ME,
    );
    expect(input.turn).toBe(0);
    expect(input.thrust).toBe(true); // цілі нема, летить далі
  });
});
