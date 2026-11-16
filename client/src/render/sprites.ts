import { z } from 'zod';

// frames.json приходить з мережі, тому форму перевіряємо схемою
export const FramesSchema = z.record(
  z.string(),
  z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
);
export type Frames = z.infer<typeof FramesSchema>;

export interface DrawOptions {
  angle?: number;
  size?: number;
}

export interface Sprites {
  draw(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    options?: DrawOptions,
  ): void;
}

export function createSprites(sheet: CanvasImageSource, frames: Frames): Sprites {
  function draw(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    { angle = 0, size }: DrawOptions = {},
  ): void {
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
