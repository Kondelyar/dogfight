export const TICK_RATE = 30;
export const STEP = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

// арена однакова для всіх: клієнт лише масштабує її під вікно
export const ARENA = { width: 1280, height: 720 };

export const RULES = {
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
