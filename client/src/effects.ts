import { mulberry32, ARENA } from 'shared';
import type { Star } from './render/draw.ts';

const EXPLOSION_TTL = 0.6;

export interface Particle {
  offset: { x: number; y: number };
  vel: { x: number; y: number };
}

export interface Explosion {
  pos: { x: number; y: number };
  ttl: number;
  particles: Particle[];
}

// вибухи - лише картинка на клієнті, тож тут можна Math.random (на симуляцію це не впливає)
export function createExplosion(x: number, y: number): Explosion {
  return {
    pos: { x, y },
    ttl: EXPLOSION_TTL,
    particles: Array.from({ length: 16 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      return {
        offset: { x: 0, y: 0 },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      };
    }),
  };
}

export function updateExplosions(list: Explosion[], dt: number): Explosion[] {
  for (const e of list) {
    e.ttl -= dt;
    for (const p of e.particles) {
      p.offset.x += p.vel.x * dt;
      p.offset.y += p.vel.y * dt;
    }
  }
  return list.filter((e) => e.ttl > 0);
}

// зірки з seed сервера: у всіх гравців однакове небо
export function makeStars(seed: number, count = 140): Star[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: rng() * ARENA.width,
    y: rng() * ARENA.height,
    size: rng() < 0.15 ? 2 : 1,
  }));
}
