import type { Emitter, WorldEvents } from 'shared';

const POPUP_MS = 900;

interface Popup {
  text: string;
  x: number;
  y: number;
  born: number;
}

export interface Hud {
  draw(ctx: CanvasRenderingContext2D): void;
}

export function createHud(bus: Emitter<WorldEvents>): Hud {
  const popups: Popup[] = [];

  bus.on('scored', ({ points, x, y }) => {
    popups.push({ text: `+${points}`, x, y, born: performance.now() });
  });

  return {
    draw(ctx) {
      const now = performance.now();
      while (popups[0] && now - popups[0].born > POPUP_MS) popups.shift();

      ctx.save();
      ctx.fillStyle = '#ffe066';
      ctx.font = '16px monospace';
      for (const p of popups) {
        const t = (now - p.born) / POPUP_MS;
        ctx.globalAlpha = 1 - t;
        ctx.fillText(p.text, p.x, p.y - t * 30);
      }
      ctx.restore();
    },
  };
}
