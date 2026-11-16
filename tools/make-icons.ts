// node tools/make-icons.ts - малює іконки PWA (корабель на темному тлі) у client/public/icons
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// maskable: Android може обрізати іконку колом, тому корабель менший і в безпечній зоні (80 %)
const svg = (size: number, scale: number): string => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#05070d"/>
  <g transform="translate(50 52) scale(${scale})">
    <polygon points="0,-34 22,26 0,15 -22,26" fill="#8fd3ff" stroke="#e9f6ff" stroke-width="2" stroke-linejoin="round"/>
    <polygon points="0,18 8,34 -8,34" fill="#ff9d4d"/>
  </g>
  <circle cx="82" cy="20" r="2.2" fill="#1c2740"/><circle cx="16" cy="30" r="1.6" fill="#1c2740"/>
  <circle cx="24" cy="82" r="2" fill="#1c2740"/><circle cx="86" cy="78" r="1.4" fill="#1c2740"/>
</svg>`;

const jobs = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
];

await mkdir('client/public/icons', { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
for (const { file, size, scale } of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size, scale)}</body>`);
  await page.screenshot({ path: `client/public/icons/${file}` });
  await page.close();
  console.log(`client/public/icons/${file}`);
}
await browser.close();
