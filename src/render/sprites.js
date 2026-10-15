export function createSprites(sheet, frames) {
  function draw(ctx, name, x, y, { angle = 0, size } = {}) {
    const f = frames[name];
    if (!f) return;
    const w = size ?? f.w;
    const h = w * (f.h / f.w);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  return { draw };
}
