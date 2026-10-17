function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

const SHIP_SIZE = 30;

export function drawShip(ctx, ship, alpha, sprites) {
  const x = lerp(ship.prevPos.x, ship.pos.x, alpha);
  const y = lerp(ship.prevPos.y, ship.pos.y, alpha);
  const angle = lerpAngle(ship.prevAngle, ship.angle, alpha);

  if (ship.thrusting) {
    ctx.globalAlpha = 0.6 + Math.random() * 0.4;
    sprites.draw(ctx, 'flame', x, y, { angle, size: SHIP_SIZE });
    ctx.globalAlpha = 1;
  }
  sprites.draw(ctx, 'ship', x, y, { angle, size: SHIP_SIZE });
}

export function drawBullet(ctx, bullet, alpha, sprites) {
  const x = lerp(bullet.prevPos.x, bullet.pos.x, alpha);
  const y = lerp(bullet.prevPos.y, bullet.pos.y, alpha);
  sprites.draw(ctx, 'bullet', x, y, { size: 14 });
}

export function drawAsteroid(ctx, asteroid, alpha, sprites) {
  const x = lerp(asteroid.prevPos.x, asteroid.pos.x, alpha);
  const y = lerp(asteroid.prevPos.y, asteroid.pos.y, alpha);
  const angle = lerpAngle(asteroid.prevAngle, asteroid.angle, alpha);
  const name = asteroid.homing ? 'hunter' : 'asteroid';
  sprites.draw(ctx, name, x, y, { angle, size: asteroid.radius * 2.2 });
}

export function drawExplosion(ctx, explosion) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, explosion.ttl / 0.6);
  ctx.fillStyle = '#ff9d4d';
  for (const p of explosion.particles) {
    ctx.fillRect(explosion.pos.x + p.offset.x, explosion.pos.y + p.offset.y, 3, 3);
  }
  ctx.restore();
}

export function drawPickup(ctx, pickup, sprites) {
  const name = pickup.effect === 'shield' ? 'shield' : 'rapid';
  sprites.draw(ctx, name, pickup.pos.x, pickup.pos.y, { size: pickup.radius * 2.4 });
}

export function drawStarfield(ctx, width, height, stars) {
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1c2740';
  for (const s of stars) {
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
}

export function drawHud(ctx, stats, ship, info) {
  ctx.fillStyle = '#8fd3ff';
  ctx.font = '14px monospace';
  ctx.fillText(`steps/s ${stats.stepsPerSecond}`, 12, 20);
  ctx.fillText(`frames/s ${stats.framesPerSecond}`, 12, 38);
  ctx.fillText(`frame ${stats.frameMs.toFixed(2)} ms`, 12, 56);
  ctx.fillText(`hp ${ship.hp}`, 12, 80);
  ctx.fillText(`score ${ship.score}`, 12, 98);
  ctx.fillText(`${info.name} @ ${info.room}`, 12, 122);
}
