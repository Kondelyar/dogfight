import type { NetStats } from '../net/netstats.ts';
import type { Session } from '../net/session.ts';

const LINE = 16;

export function drawNetgraph(
  ctx: CanvasRenderingContext2D,
  stats: NetStats,
  session: Session,
  width: number,
): void {
  const now = performance.now();
  const { baseMs, jitterMs, drop } = stats.lag;
  const lines = [
    `rtt ${Math.round(stats.rtt)} ms`,
    `snapshot age ${Math.round(stats.snapshotAge(now))} ms`,
    `in ${(stats.inBytesPerSec / 1024).toFixed(1)} KB/s  out ${(stats.outBytesPerSec / 1024).toFixed(2)} KB/s`,
    `pending inputs ${stats.pending}`,
    `correction ${stats.correction.toFixed(3)} px`,
    `interp delay ${Math.round(session.interpolator.delay)} ms  ([ ])`,
    `codec ${session.codec}, predict ${session.predict ? 'on' : 'off'}`,
    `lag ${baseMs}/${jitterMs} ms, drop ${Math.round(drop * 100)}%  (L, K)`,
  ];

  ctx.save();
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fd3ff';
  lines.forEach((line, i) => ctx.fillText(line, width - 12, 20 + i * LINE));

  // величина звірки на кожен знімок: стовпчик на знімок, 1 px = 0.25 px корекції
  const top = 20 + lines.length * LINE;
  ctx.fillStyle = '#ff9d4d';
  stats.corrections.forEach((c, i) => {
    const h = Math.min(40, c * 4);
    ctx.fillRect(width - 12 - (stats.corrections.length - i) * 3, top + 40 - h, 2, Math.max(h, 1));
  });
  ctx.restore();
}
