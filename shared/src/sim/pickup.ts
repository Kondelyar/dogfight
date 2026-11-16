import type { EffectName } from '../protocol.ts';
import { Entity } from './entity.ts';
import { RULES } from './constants.ts';
import type { Ship } from './ship.ts';

// pickup - Entity з рядком-ефектом ('shield' | 'rapidfire'), без власної поведінки (Lab 2)
export class Pickup extends Entity {
  readonly kind = 'pickup';
  readonly effect: EffectName;

  constructor(x: number, y: number, effect: EffectName) {
    super({ x, y, radius: 10 });
    this.effect = effect;
  }
}

export function applyPickup(ship: Ship, effect: EffectName): void {
  switch (effect) {
    case 'shield':
      ship.heal(RULES.shieldHeal);
      return;
    case 'rapidfire':
      ship.rapidSteps = RULES.rapidSteps;
      return;
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}
