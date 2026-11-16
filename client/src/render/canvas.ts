export interface CanvasHandle {
  ctx: CanvasRenderingContext2D;
  width(): number;
  height(): number;
}

export function setupCanvas(canvas: HTMLCanvasElement): CanvasHandle {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d is not supported');

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);

  return {
    ctx,
    width: () => window.innerWidth,
    height: () => window.innerHeight,
  };
}
