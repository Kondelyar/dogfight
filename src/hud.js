const POPUP_MS = 900;

export function createHud(bus) {
  const popups = [];

  bus.addEventListener('scored', (e) => {
    const { points, x, y } = e.detail;
    popups.push({ text: `+${points}`, x, y, born: performance.now() });
  });

  return {
    draw(ctx) {
      const now = performance.now();
      while (popups.length && now - popups[0].born > POPUP_MS) popups.shift();

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
