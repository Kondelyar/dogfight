export const TICK_RATE = 30;
export const STEP = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

// арена однакова для всіх: клієнт лише масштабує її під вікно
export const ARENA: { readonly width: number; readonly height: number } = {
  width: 1280,
  height: 720,
};

interface Rules {
  readonly asteroids: number;
  readonly hunters: number;
  readonly pickupEverySteps: number;
  readonly maxPickups: number;
  readonly respawnSteps: number;
  readonly asteroidScore: number;
  readonly killScore: number;
  readonly shieldHeal: number;
  readonly rapidSteps: number;
}

export const RULES: Rules = {
  asteroids: 5,
  hunters: 1,
  pickupEverySteps: 240,
  maxPickups: 3,
  respawnSteps: 60,
  asteroidScore: 10,
  killScore: 50,
  shieldHeal: 40,
  rapidSteps: 150,
};
