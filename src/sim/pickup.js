import { Entity } from './entity.js';

// pickup не рухається й не стріляє - йому не потрібен власний клас
// у дереві спадкування. Беремо готовий Entity (vel = 0, стоїть на місці,
// колізії й так рахують radius) і просто навішуємо ефект.
export function createPickup(x, y, effect) {
  const entity = new Entity({ x, y, radius: 10, kind: 'pickup' });
  entity.effect = effect; // 'shield' | 'rapidfire'

  entity.apply = (ship) => {
    if (effect === 'shield') ship.heal(40);
    if (effect === 'rapidfire') ship.rapidFireUntil = performance.now() + 5000;
  };

  return entity;
}
