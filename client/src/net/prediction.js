import { STEP, ARENA, wrapDelta } from 'shared';

const TELEPORT = 150; // така звірка - це відродження чи телепорт, плавно її не згладити
const SMOOTH_TAU = 0.05; // ~100 мс, щоб поправка розтанула

export class Prediction {
  constructor(ship) {
    this.ship = ship;
    this.pending = []; // інпути, яких сервер ще не підтвердив
    this.smooth = { x: 0, y: 0 }; // візуальне зміщення, що тане до нуля
  }

  // той самий applyInput, що й на сервері, тому корабель реагує одразу
  apply(input) {
    this.pending.push(input);
    return this.ship.applyInput(input, STEP);
  }

  // Звірка: стан сервера -> викинути підтверджені інпути -> прогнати решту наново.
  // Повертає, на скільки пікселів передбачення розійшлось із сервером.
  reconcile(record, ack) {
    const ship = this.ship;
    const before = ship.pos;
    const motion = before.sub(ship.prevPos);
    const turn = ship.angle - ship.prevAngle;

    ship.applyState(record);
    this.pending = this.pending.filter((input) => input.seq > ack);
    for (const input of this.pending) ship.applyInput(input, STEP);

    if (this.pending.length === 0) {
      // нічого не прогнали, тож зберігаємо рух останнього кроку для плавної інтерполяції кадрів
      ship.prevPos = ship.pos.sub(motion);
      ship.prevAngle = ship.angle - turn;
    }

    const dx = wrapDelta(before.x - ship.pos.x, ARENA.width);
    const dy = wrapDelta(before.y - ship.pos.y, ARENA.height);
    const magnitude = Math.hypot(dx, dy);

    if (magnitude > TELEPORT) {
      this.smooth = { x: 0, y: 0 };
    } else {
      this.smooth.x += dx;
      this.smooth.y += dy;
    }
    return magnitude;
  }

  decay(dt) {
    const k = Math.exp(-dt / SMOOTH_TAU);
    this.smooth.x *= k;
    this.smooth.y *= k;
  }

  renderShip() {
    const { ship, smooth } = this;
    return {
      kind: 'ship',
      isMe: true,
      alive: ship.alive,
      thrusting: ship.thrusting,
      radius: ship.radius,
      pos: { x: ship.pos.x + smooth.x, y: ship.pos.y + smooth.y },
      prevPos: { x: ship.prevPos.x + smooth.x, y: ship.prevPos.y + smooth.y },
      angle: ship.angle,
      prevAngle: ship.prevAngle,
    };
  }
}
