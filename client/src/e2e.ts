import type { Session } from './net/session.ts';

// Хук для Playwright (?e2e=1): тест бачить стан гри, хоча все малюється на canvas, а не в DOM.
export interface DogfightHook {
  ships(): { x: number; y: number; isMe: boolean }[];
  lastTick(): number;
}

declare global {
  interface Window {
    __dogfight?: DogfightHook;
  }
}

export function exposeTestHook(session: Session): void {
  window.__dogfight = {
    ships: () =>
      session
        .renderEntities(performance.now())
        .flatMap((e) => (e.kind === 'ship' ? [{ x: e.pos.x, y: e.pos.y, isMe: e.isMe }] : [])),
    lastTick: () => session.lastTick,
  };
}
