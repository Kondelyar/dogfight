import { Pool, mulberry32, ARENA } from 'shared';
import type { Star } from './render/draw.ts';

export const EXPLOSION_TTL = 0.6;
const PARTICLES = 16;

export interface Particle {
  offset: { x: number; y: number };
  vel: { x: number; y: number };
}

export interface Explosion {
  pos: { x: number; y: number };
  ttl: number;
  particles: Particle[];
}

function blankExplosion(): Explosion {
  return {
    pos: { x: 0, y: 0 },
    ttl: 0,
    particles: Array.from({ length: PARTICLES }, () => ({
      offset: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
    })),
  };
}

// вибухи - лише картинка на клієнті, тож тут можна Math.random (на симуляцію це не впливає)
function launch(e: Explosion, x: number, y: number): Explosion {
  e.pos.x = x;
  e.pos.y = y;
  e.ttl = EXPLOSION_TTL;
  for (const p of e.particles) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    p.offset.x = 0;
    p.offset.y = 0;
    p.vel.x = Math.cos(angle) * speed;
    p.vel.y = Math.sin(angle) * speed;
  }
  return e;
}

// Вибух з 16 частинок раніше створював ~50 об'єктів на кожен вибух і новий масив щокадру.
// Тепер вибухи беруться з пулу і повертаються, коли час життя вийшов.
export class Explosions {
  readonly active: Explosion[] = [];
  #pool = new Pool<Explosion>(blankExplosion, { max: 64 });

  get pool(): Pool<Explosion> {
    return this.#pool;
  }

  spawn(x: number, y: number): Explosion {
    const e = launch(this.#pool.acquire(), x, y);
    this.active.push(e);
    return e;
  }

  // оновлює частинки й на місці прибирає ті вибухи, що догоріли
  update(dt: number): void {
    let kept = 0;
    for (const e of this.active) {
      e.ttl -= dt;
      if (e.ttl <= 0) {
        this.#pool.release(e);
        continue;
      }
      for (const p of e.particles) {
        p.offset.x += p.vel.x * dt;
        p.offset.y += p.vel.y * dt;
      }
      this.active[kept++] = e;
    }
    this.active.length = kept;
  }
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
