import type { NetStats } from '../net/netstats.ts';
import type { Session } from '../net/session.ts';

const LINE = 16;
const REFRESH_MS = 250; // числа в netgraph читають очима, частіше їх міняти немає сенсу

// Текст збирається не частіше ніж раз на REFRESH_MS: раніше вісім рядків створювались щокадру.
const text: { builtAt: number; lines: string[] } = { builtAt: -Infinity, lines: [] };

function rebuild(stats: NetStats, session: Session, now: number): void {
  const { baseMs, jitterMs, drop } = stats.lag;
  text.builtAt = now;
  text.lines = [
    `rtt ${Math.round(stats.rtt)} ms`,
    `snapshot age ${Math.round(stats.snapshotAge(now))} ms`,
    `in ${(stats.inBytesPerSec / 1024).toFixed(1)} KB/s  out ${(stats.outBytesPerSec / 1024).toFixed(2)} KB/s`,
    `pending inputs ${stats.pending}`,
    `correction ${stats.correction.toFixed(3)} px`,
    `interp delay ${Math.round(session.interpolator.delay)} ms  ([ ])`,
    `codec ${session.codec}, predict ${session.predict ? 'on' : 'off'}`,
    `lag ${baseMs}/${jitterMs} ms, drop ${Math.round(drop * 100)}%  (L, K)`,
  ];
}

export function drawNetgraph(
  ctx: CanvasRenderingContext2D,
  stats: NetStats,
  session: Session,
  width: number,
): void {
  const now = performance.now();
  if (now - text.builtAt >= REFRESH_MS) rebuild(stats, session, now);

  ctx.save();
  ctx.font = '12px monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fd3ff';
  for (let i = 0; i < text.lines.length; i++) {
    ctx.fillText(text.lines[i] ?? '', width - 12, 20 + i * LINE);
  }

  // величина звірки на кожен знімок: стовпчик на знімок, 1 px = 0.25 px корекції
  const top = 20 + text.lines.length * LINE;
  ctx.fillStyle = '#ff9d4d';
  const corrections = stats.corrections;
  for (let i = 0; i < corrections.length; i++) {
    const h = Math.min(40, (corrections[i] ?? 0) * 4);
    ctx.fillRect(width - 12 - (corrections.length - i) * 3, top + 40 - h, 2, Math.max(h, 1));
  }
  ctx.restore();
}
