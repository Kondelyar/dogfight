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
  const x = lerp(ship.prevPos.x, ship.pos.x, alpha);
  const y = lerp(ship.prevPos.y, ship.pos.y, alpha);
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

export function drawBullet(ctx, bullet, alpha) {
  const x = lerp(bullet.prevPos.x, bullet.pos.x, alpha);
  const y = lerp(bullet.prevPos.y, bullet.pos.y, alpha);

  ctx.fillStyle = '#ffe066';
  ctx.beginPath();
  ctx.arc(x, y, bullet.radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawAsteroid(ctx, asteroid, alpha) {
  const x = lerp(asteroid.prevPos.x, asteroid.pos.x, alpha);
  const y = lerp(asteroid.prevPos.y, asteroid.pos.y, alpha);
  const angle = lerpAngle(asteroid.prevAngle, asteroid.angle, alpha);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = asteroid.homing ? '#ff6b6b' : '#9aa5b1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, asteroid.radius, 0, Math.PI * 2);
  ctx.moveTo(0, 0);
  ctx.lineTo(asteroid.radius, 0);
  ctx.stroke();
  ctx.restore();
}

export function drawExplosion(ctx, explosion) {
  ctx.fillStyle = '#ff9d4d';
  for (const p of explosion.particles) {
    ctx.fillRect(explosion.pos.x + p.offset.x, explosion.pos.y + p.offset.y, 2, 2);
  }
}

export function drawPickup(ctx, pickup) {
  ctx.strokeStyle = pickup.effect === 'shield' ? '#4dff88' : '#4dd2ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pickup.pos.x, pickup.pos.y, pickup.radius, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawStarfield(ctx, width, height, stars) {
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1c2740';
  for (const s of stars) {
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
}

export function drawHud(ctx, stats, ship) {
  ctx.fillStyle = '#8fd3ff';
  ctx.font = '14px monospace';
  ctx.fillText(`steps/s ${stats.stepsPerSecond}`, 12, 20);
  ctx.fillText(`frames/s ${stats.framesPerSecond}`, 12, 38);
  ctx.fillText(`frame ${stats.frameMs.toFixed(2)} ms`, 12, 56);
  ctx.fillText(`hp ${ship.hp}`, 12, 80);
  ctx.fillText(`score ${ship.score}`, 12, 98);
}
