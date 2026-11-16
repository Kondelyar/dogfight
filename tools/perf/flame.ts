// Перетворює .cpuprofile (V8) на HTML-"flame chart": ширина прямокутника = час, рядок = глибина стеку.
import { z } from 'zod';

const NodeSchema = z.object({
  id: z.number(),
  callFrame: z.object({
    functionName: z.string(),
    url: z.string(),
    lineNumber: z.number(),
  }),
  children: z.array(z.number()).optional(),
});

export const CpuProfileSchema = z.object({
  nodes: z.array(NodeSchema),
  samples: z.array(z.number()),
  timeDeltas: z.array(z.number()),
});
export type CpuProfile = z.infer<typeof CpuProfileSchema>;

interface Frame {
  name: string;
  total: number;
  children: Map<number, Frame>;
}

const label = (n: z.infer<typeof NodeSchema>): string => {
  const { functionName, url, lineNumber } = n.callFrame;
  const file = url.split('/').pop() ?? '';
  return `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`;
};

const isIdle = (n: z.infer<typeof NodeSchema> | undefined): boolean =>
  n !== undefined &&
  (n.callFrame.functionName === '(idle)' || n.callFrame.functionName === '(program)');

export function buildTree(profile: CpuProfile): Frame {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);

  // вузол профілю -> шлях від кореня
  const pathOf = (id: number): number[] => {
    const path: number[] = [];
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) path.push(cur);
    return path.reverse();
  };

  const root: Frame = { name: 'root', total: 0, children: new Map() };
  const cache = new Map<number, number[]>();
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] ?? 0;
    const path = cache.get(id) ?? pathOf(id);
    cache.set(id, path);
    const idleSample = isIdle(byId.get(id));
    if (idleSample) return; // idle у flame chart не показуємо: цікавить лише робота
    root.total += dt;
    let frame = root;
    for (const nodeId of path.slice(1)) {
      const node = byId.get(nodeId);
      if (!node) continue;
      let child = frame.children.get(nodeId);
      if (!child) {
        child = { name: label(node), total: 0, children: new Map() };
        frame.children.set(nodeId, child);
      }
      child.total += dt;
      frame = child;
    }
  });
  return root;
}

const hue = (s: string): number => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

export function renderFlameHtml(profile: CpuProfile, title: string, width = 1600): string {
  const root = buildTree(profile);
  const rowH = 18;
  const rects: string[] = [];
  let maxDepth = 0;

  function walk(frame: Frame, x: number, depth: number): void {
    const w = (frame.total / root.total) * width;
    if (w < 1.2) return; // дрібниць не малюємо
    maxDepth = Math.max(maxDepth, depth);
    const idle = frame.name.startsWith('(idle)');
    const fill = idle ? '#2a2f3a' : `hsl(${hue(frame.name)} 55% 42%)`;
    const ms = (frame.total / 1000).toFixed(0);
    const text = w > 60 ? frame.name.slice(0, Math.floor(w / 6.5)) : '';
    rects.push(
      `<g><title>${frame.name} — ${ms} ms</title><rect x="${x.toFixed(1)}" y="${depth * rowH}" width="${(w - 0.5).toFixed(1)}" height="${rowH - 1}" fill="${fill}"/>` +
        (text
          ? `<text x="${(x + 3).toFixed(1)}" y="${depth * rowH + 13}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
          : '') +
        `</g>`,
    );
    let cx = x;
    const kids = [...frame.children.values()].sort((a, b) => b.total - a.total);
    for (const kid of kids) {
      walk(kid, cx, depth + 1);
      cx += (kid.total / root.total) * width;
    }
  }
  walk(root, 0, 0);

  const height = (maxDepth + 1) * rowH;
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0e14;color:#cdd6e4;font:12px monospace">
<div style="padding:8px 10px">${title} · ${(root.total / 1e6).toFixed(1)} s активного CPU (idle прибрано)</div>
<svg id="flame" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="display:block;font:11px monospace">
<style>text{fill:#fff;pointer-events:none}</style>${rects.join('')}</svg></body>`;
}
