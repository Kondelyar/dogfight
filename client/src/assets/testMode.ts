import type { Manifest } from './loader.ts';

// ?test=404 | badjson | timeout | slow  - щоб відтворити помилки для README (M4)
export function applyTestMode(manifest: Manifest, mode: string | null): Manifest {
  switch (mode) {
    case '404':
      manifest.images['nebula'] = { url: '/assets/nebula.png', optional: true };
      break;
    case 'badjson':
      manifest.json['broken'] = { url: '/assets/broken.json', optional: true };
      break;
    case 'timeout': {
      const arena = manifest.json['arena'];
      if (arena) arena.timeoutMs = 1;
      break;
    }
    case 'slow': {
      let i = 0;
      for (const items of Object.values(manifest)) {
        for (const item of Object.values(items)) item.delayMs = 500 * ++i;
      }
      break;
    }
  }
  return manifest;
}
