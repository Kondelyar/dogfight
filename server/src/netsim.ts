// Емулятор поганої мережі для розробки нетокоду: затримка, jitter, втрати.
// baseMs - додатковий RTT: на кожен напрямок іде половина. jitterMs - до скількох мс
// випадково додається на напрямок. drop діє лише на "ненадійні" повідомлення (інпути, знімки):
// справжній WebSocket це TCP, тому чат і roster не губимо.

export interface NetConditions {
  baseMs: number;
  jitterMs: number;
  drop: number;
}

export interface NetSim {
  readonly conditions: NetConditions;
  set(next: { [K in keyof NetConditions]?: unknown }): void;
  inbound(fn: () => void, options?: { unreliable?: boolean }): void;
  outbound(fn: () => void, options?: { unreliable?: boolean }): void;
}

// значення можуть прийти з адреси сокета (рядок або null), тому приймаємо unknown
const clamp = (n: unknown, max: number): number => Math.min(Math.max(Number(n) || 0, 0), max);

interface Pending {
  at: number;
  fn: () => void;
}

export function createNetSim(): NetSim {
  let cond: NetConditions = { baseMs: 0, jitterMs: 0, drop: 0 };
  const lastAt = { in: 0, out: 0 };
  // одна черга і один таймер на напрямок: порядок гарантований, а не залежить від точності setTimeout
  const queues: Record<'in' | 'out', Pending[]> = { in: [], out: [] };
  const timers: Record<'in' | 'out', NodeJS.Timeout | null> = { in: null, out: null };

  function drain(direction: 'in' | 'out'): void {
    const queue = queues[direction];
    timers[direction] = null;
    const now = Date.now();
    while (queue[0] && queue[0].at <= now) queue.shift()?.fn();
    arm(direction);
  }

  function arm(direction: 'in' | 'out'): void {
    const head = queues[direction][0];
    if (!head || timers[direction]) return;
    timers[direction] = setTimeout(() => drain(direction), Math.max(0, head.at - Date.now()));
  }

  function run(direction: 'in' | 'out', fn: () => void, unreliable: boolean): void {
    if (unreliable && Math.random() < cond.drop) return;
    const now = Date.now();
    const delay = cond.baseMs / 2 + Math.random() * cond.jitterMs;
    // не обганяємо те, що вже чекає: TCP не переставляє повідомлення
    const at = Math.max(now + delay, lastAt[direction]);
    lastAt[direction] = at;
    if (at <= now && queues[direction].length === 0) return fn();
    queues[direction].push({ at, fn });
    arm(direction);
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
