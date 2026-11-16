import {
  STEP,
  releaseBullet,
  ARENA,
  wrapDelta,
  type Bullet,
  type ControlInput,
  type Seq,
  type Ship,
  type ShipRecord,
} from 'shared';
import type { RenderShip, Writable } from '../render/types.ts';
import { createShipSlot } from '../render/slots.ts';

const TELEPORT = 150; // така звірка - це відродження чи телепорт, плавно її не згладити
const SMOOTH_TAU = 0.05; // ~100 мс, щоб поправка розтанула

export class Prediction {
  ship: Ship;
  pending: ControlInput[] = []; // інпути, яких сервер ще не підтвердив
  smooth = { x: 0, y: 0 }; // візуальне зміщення, що тане до нуля

  constructor(ship: Ship) {
    this.ship = ship;
  }

  // той самий applyInput, що й на сервері, тому корабель реагує одразу
  apply(input: ControlInput): Bullet | null {
    this.pending.push(input);
    return this.ship.applyInput(input, STEP);
  }

  // Звірка: стан сервера -> викинути підтверджені інпути -> прогнати решту наново.
  // Повертає, на скільки пікселів передбачення розійшлось із сервером.
  reconcile(record: ShipRecord, ack: Seq): number {
    const ship = this.ship;
    const before = ship.pos;
    const motion = before.sub(ship.prevPos);
    const turn = ship.angle - ship.prevAngle;

    ship.applyState(record);
    this.#dropConfirmed(ack);
    for (const input of this.pending) {
      const replayed = ship.applyInput(input, STEP);
      if (replayed) releaseBullet(replayed); // куля вже показана як привид, повтор їй не потрібен
    }

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

  // викидає підтверджені інпути на місці, без нового масиву на кожен знімок
  #dropConfirmed(ack: Seq): void {
    let kept = 0;
    for (const input of this.pending) if (input.seq > ack) this.pending[kept++] = input;
    this.pending.length = kept;
  }

  decay(dt: number): void {
    const k = Math.exp(-dt / SMOOTH_TAU);
    this.smooth.x *= k;
    this.smooth.y *= k;
  }

  // Один об'єкт на весь час гри: переписується щокадру (раніше створювалось три об'єкти за кадр).
  // Тут pos і prevPos різні, бо власний корабель інтерполюється між кроками симуляції.
  #view: Writable<RenderShip> = { ...createShipSlot(), isMe: true, prevPos: { x: 0, y: 0 } };

  renderShip(): RenderShip {
    const { ship, smooth } = this;
    const view = this.#view;
    view.thrusting = ship.thrusting;
    view.radius = ship.radius;
    view.pos.x = ship.pos.x + smooth.x;
    view.pos.y = ship.pos.y + smooth.y;
    view.prevPos.x = ship.prevPos.x + smooth.x;
    view.prevPos.y = ship.prevPos.y + smooth.y;
    view.angle = ship.angle;
    view.prevAngle = ship.prevAngle;
    return view;
  }
}
