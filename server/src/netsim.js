// Емулятор поганої мережі для розробки нетокоду: затримка, jitter, втрати.
// baseMs - додатковий RTT: на кожен напрямок іде половина. jitterMs - до скількох мс
// випадково додається на напрямок. drop діє лише на "ненадійні" повідомлення (інпути, знімки):
// справжній WebSocket це TCP, тому чат і roster не губимо.

const clamp = (n, max) => Math.min(Math.max(Number(n) || 0, 0), max);

export function createNetSim() {
  let cond = { baseMs: 0, jitterMs: 0, drop: 0 };
  const lastAt = { in: 0, out: 0 };

  function run(direction, fn, unreliable) {
    if (unreliable && Math.random() < cond.drop) return;
    const now = Date.now();
    const delay = cond.baseMs / 2 + Math.random() * cond.jitterMs;
    // не обганяємо те, що вже чекає: TCP не переставляє повідомлення
    const at = Math.max(now + delay, lastAt[direction]);
    lastAt[direction] = at;
    if (at <= now) fn();
    else setTimeout(fn, at - now);
  }

  return {
    get conditions() {
      return cond;
    },
    set({ baseMs, jitterMs, drop }) {
      cond = {
        baseMs: clamp(baseMs, 1000),
        jitterMs: clamp(jitterMs, 500),
        drop: clamp(drop, 0.5),
      };
    },
    inbound: (fn, { unreliable = false } = {}) => run('in', fn, unreliable),
    outbound: (fn, { unreliable = false } = {}) => run('out', fn, unreliable),
  };
}
