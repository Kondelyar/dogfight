import type { RenderAsteroid, RenderBullet, RenderPickup, RenderShip, Writable } from './types.ts';

// Слоти для покадрового пулу: pos і prevPos тут один об'єкт, бо чужі сутності вже інтерполюються
// між знімками (кадрова інтерполяція alpha для них нічого не змінює).
export function createShipSlot(): Writable<RenderShip> {
  const pos = { x: 0, y: 0 };
  return {
    kind: 'ship',
    isMe: false,
    thrusting: false,
    radius: 12,
    pos,
    prevPos: pos,
    angle: 0,
    prevAngle: 0,
  };
}

export function createBulletSlot(): Writable<RenderBullet> {
  const pos = { x: 0, y: 0 };
  return { kind: 'bullet', radius: 3, pos, prevPos: pos, angle: 0, prevAngle: 0 };
}

export function createAsteroidSlot(): Writable<RenderAsteroid> {
  const pos = { x: 0, y: 0 };
  return { kind: 'asteroid', homing: false, radius: 10, pos, prevPos: pos, angle: 0, prevAngle: 0 };
}

export function createPickupSlot(): Writable<RenderPickup> {
  const pos = { x: 0, y: 0 };
  return {
    kind: 'pickup',
    effect: 'shield',
    radius: 10,
    pos,
    prevPos: pos,
    angle: 0,
    prevAngle: 0,
  };
}

interface Placeable {
  pos: { x: number; y: number };
  angle: number;
  prevAngle: number;
}

export function place(slot: Placeable, x: number, y: number, angle: number): void {
  slot.pos.x = x;
  slot.pos.y = y;
  slot.angle = angle;
  slot.prevAngle = angle;
}
