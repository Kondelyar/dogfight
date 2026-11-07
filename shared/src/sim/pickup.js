import { Entity } from './entity.js';
import { RULES } from './constants.js';

// pickup - не клас, а звичайний Entity з рядком-ефектом (композиція, Lab 2)
export function createPickup(x, y, effect) {
  const entity = new Entity({ x, y, radius: 10, kind: 'pickup' });
  entity.effect = effect; // 'shield' | 'rapidfire'
  return entity;
}

export function applyPickup(ship, effect) {
  if (effect === 'shield') ship.heal(RULES.shieldHeal);
  if (effect === 'rapidfire') ship.rapidSteps = RULES.rapidSteps;
}
