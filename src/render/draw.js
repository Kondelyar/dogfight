function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function drawShip(ctx, ship, alpha) {
  const x = lerp(ship.prevX, ship.x, alpha);
  const y = lerp(ship.prevY, ship.y, alpha);
  const angle = lerpAngle(ship.prevAngle, ship.angle, alpha);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.strokeStyle = '#8fd3ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-10, 8);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-10, -8);
  ctx.closePath();
  ctx.stroke();

  if (ship.thrusting) {
    ctx.strokeStyle = '#ff9d4d';
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(-16 - Math.random() * 6, 0);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawStarfield(ctx, width, height, stars) {
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1c2740';
  for (const s of stars) {
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
}

export function drawHud(ctx, stats) {
  ctx.fillStyle = '#8fd3ff';
  ctx.font = '14px monospace';
  ctx.fillText(`steps/s ${stats.stepsPerSecond}`, 12, 20);
  ctx.fillText(`frames/s ${stats.framesPerSecond}`, 12, 38);
  ctx.fillText(`frame ${stats.frameMs.toFixed(2)} ms`, 12, 56);
}
