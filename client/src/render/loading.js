export function drawLoading(ctx, width, height, { progress, label, error }) {
  const barW = Math.min(320, width - 80);
  const x = (width - barW) / 2;
  const y = height / 2;

  ctx.save();
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#8fd3ff';
  ctx.font = '22px monospace';
  ctx.fillText('dogfight', width / 2, y - 36);

  ctx.strokeStyle = '#8fd3ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, 14);
  ctx.fillRect(x, y, barW * progress, 14);

  ctx.font = '13px monospace';
  if (error) {
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText(error, width / 2, y + 40);
  } else {
    ctx.fillText(`${label} · ${Math.round(progress * 100)}%`, width / 2, y + 40);
  }
  ctx.restore();
}
