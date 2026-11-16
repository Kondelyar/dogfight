import { describe, expect, it } from 'vitest';
import {
  Kind,
  STEP,
  Ship,
  entityId,
  releaseBullet,
  seq,
  tick,
  type ControlInput,
  type ShipRecord,
} from 'shared';
import { Prediction } from '../src/net/prediction.ts';

const input = (n: number, patch: Partial<ControlInput> = {}): ControlInput => ({
  seq: seq(n),
  tick: tick(0),
  turn: 0,
  thrust: false,
  fire: false,
  ...patch,
});

// «сервер»: такий самий Ship, що застосовує ті самі інпути
function serverShip(): Ship {
  const ship = new Ship(640, 360);
  ship.id = entityId(1);
  return ship;
}

function recordOf(ship: Ship): ShipRecord {
  return {
    id: ship.id,
    kind: Kind.SHIP,
    x: ship.pos.x,
    y: ship.pos.y,
    vx: ship.vel.x,
    vy: ship.vel.y,
    angle: ship.angle,
    alive: ship.alive,
    thrusting: ship.thrusting,
    hp: ship.hp,
    score: ship.score,
    cooldown: ship.fireSteps,
    rapid: ship.rapidSteps,
  };
}

describe('Prediction', () => {
  it('apply рухає корабель одразу і запам’ятовує інпут як непідтверджений', () => {
    const p = new Prediction(serverShip());
    p.apply(input(1, { thrust: true }));
    expect(p.pending).toHaveLength(1);
    expect(p.ship.pos.y).toBeLessThan(360);
  });

  it('apply повертає кулю, коли інпут стріляє', () => {
    const p = new Prediction(serverShip());
    const bullet = p.apply(input(1, { fire: true }));
    expect(bullet).not.toBeNull();
    if (bullet) releaseBullet(bullet);
  });

  it('знімок, що збігається з передбаченням, дає нульову розбіжність', () => {
    const predicted = serverShip();
    const authoritative = serverShip();
    const p = new Prediction(predicted);
    for (let i = 1; i <= 10; i++) {
      p.apply(input(i, { thrust: true, turn: 1 }));
      authoritative.applyInput(input(i, { thrust: true, turn: 1 }), STEP);
    }
    const correction = p.reconcile(recordOf(authoritative), seq(10));
    expect(correction).toBeLessThan(1e-9);
    expect(p.pending).toHaveLength(0);
  });

  it('підтверджені інпути викидаються, решта програється наново поверх стану сервера', () => {
    const p = new Prediction(serverShip());
    const authoritative = serverShip();
    for (let i = 1; i <= 8; i++) {
      p.apply(input(i, { thrust: true }));
      if (i <= 5) authoritative.applyInput(input(i, { thrust: true }), STEP);
    }
    const correction = p.reconcile(recordOf(authoritative), seq(5));
    expect(p.pending.map((i) => i.seq)).toEqual([6, 7, 8]);
    expect(correction).toBeLessThan(1e-9); // той самий код, ті самі інпути: нічого не розійшлось
  });

  it('якщо сервер не виконав інпут (втрата), розбіжність видно і вона згладжується', () => {
    const p = new Prediction(serverShip());
    const authoritative = serverShip();
    for (let i = 1; i <= 6; i++) {
      p.apply(input(i, { thrust: true }));
      if (i !== 3) authoritative.applyInput(input(i, { thrust: true }), STEP);
    }
    const correction = p.reconcile(recordOf(authoritative), seq(6));
    expect(correction).toBeGreaterThan(0.1);
    expect(Math.hypot(p.smooth.x, p.smooth.y)).toBeGreaterThan(0.1);
    p.decay(1);
    expect(Math.hypot(p.smooth.x, p.smooth.y)).toBeLessThan(1e-6);
  });

  it('великий розрив (відродження) не згладжується, а приймається', () => {
    const p = new Prediction(serverShip());
    const far = serverShip();
    far.respawn(100, 100);
    p.reconcile(recordOf(far), seq(0));
    expect(p.smooth).toEqual({ x: 0, y: 0 });
    expect(p.ship.pos.x).toBe(100);
  });

  it('renderShip додає згладжування до позиції і реюзає один і той самий об’єкт', () => {
    const p = new Prediction(serverShip());
    p.smooth.x = 5;
    p.smooth.y = -2;
    const first = p.renderShip();
    expect([first.pos.x, first.pos.y]).toEqual([645, 358]);
    expect(first.isMe).toBe(true);
    const second = p.renderShip();
    expect(second).toBe(first);
  });

  it('повтор інпутів зі стрільбою не залишає куль «в повітрі» (вони повертаються в пул)', () => {
    const p = new Prediction(serverShip());
    for (let i = 1; i <= 20; i++) {
      const b = p.apply(input(i, { fire: true }));
      if (b) releaseBullet(b);
    }
    // не повинно кидати і не повинно накопичувати непідтверджені після ack
    p.reconcile(recordOf(serverShip()), seq(20));
    expect(p.pending).toHaveLength(0);
  });
});
