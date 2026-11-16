import type { EffectName } from 'shared';

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface RenderBase {
  readonly pos: Point;
  readonly prevPos: Point;
  readonly angle: number;
  readonly prevAngle: number;
  readonly radius: number;
}

// Що саме малювати: окремий тип від сутностей симуляції і від записів знімка.
// Розрізняємо полем kind, тож switch у малюванні вичерпний.
export interface RenderShip extends RenderBase {
  readonly kind: 'ship';
  readonly isMe: boolean;
  readonly thrusting: boolean;
}
export interface RenderBullet extends RenderBase {
  readonly kind: 'bullet';
}
export interface RenderAsteroid extends RenderBase {
  readonly kind: 'asteroid';
  readonly homing: boolean;
}
export interface RenderPickup extends RenderBase {
  readonly kind: 'pickup';
  readonly effect: EffectName;
}

export type RenderEntity = RenderShip | RenderBullet | RenderAsteroid | RenderPickup;
