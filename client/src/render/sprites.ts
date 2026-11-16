import { z } from 'zod';

// frames.json приходить з мережі, тому форму перевіряємо схемою
export const FramesSchema = z.record(
  z.string(),
  z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
);
export type Frames = z.infer<typeof FramesSchema>;

export interface Sprites {
  // кут і розмір передаються числами, а не об'єктом: об'єкт параметрів - це алокація на кожен виклик
  draw(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    angle: number,
    size: number,
  ): void;
}

export function createSprites(sheet: CanvasImageSource, frames: Frames): Sprites {
  function draw(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    angle: number,
    size: number,
  ): void {
    const f = frames[name];
    if (!f) return;
    const w = size > 0 ? size : f.w;
    const h = w * (f.h / f.w);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  return { draw };
}
