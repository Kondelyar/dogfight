import { mulberry32, ARENA } from 'shared';

const EXPLOSION_TTL = 0.6;

// вибухи - лише картинка на клієнті, тож тут можна Math.random (на симуляцію це не впливає)
export function createExplosion(x, y) {
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

export function updateExplosions(list, dt) {
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
export function makeStars(seed, count = 140) {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: rng() * ARENA.width,
    y: rng() * ARENA.height,
    size: rng() < 0.15 ? 2 : 1,
  }));
}
