import { expect, test } from '@playwright/test';
import { z } from 'zod';

const ManifestSchema = z.object({
  name: z.string().min(1),
  short_name: z.string().min(1),
  start_url: z.string(),
  display: z.enum(['standalone', 'fullscreen', 'minimal-ui']),
  background_color: z.string(),
  theme_color: z.string(),
  icons: z.array(z.object({ src: z.string(), sizes: z.string(), type: z.string() })).min(2),
});

test('гру можна встановити: маніфест, іконки і service worker на місці', async ({
  page,
  request,
}) => {
  await page.goto('/');

  // сторінка посилається на маніфест, а він відповідає вимогам встановлення
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const manifest = ManifestSchema.parse(await res.json());
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');

  // кожна іконка справді існує і є PNG
  for (const icon of manifest.icons) {
    const iconRes = await request.get(icon.src);
    expect(iconRes.status(), icon.src).toBe(200);
    expect(iconRes.headers()['content-type']).toBe('image/png');
  }

  // service worker віддається без довгого кешу і реєструється
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['cache-control']).toBe('no-cache');
  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active !== null;
  });
  expect(registered).toBe(true);
});

test('сторінка віддається із заголовками безпеки, а CSP не пускає ws:// на чужий хост', async ({
  request,
}) => {
  const res = await request.get('/');
  const headers = res.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  // сокет: свій хост, будь-який wss і ws лише для localhost
  expect(csp).toMatch(/connect-src [^;]*wss:/);
  expect(csp).not.toMatch(/connect-src [^;]*\sws:(?!\/\/)/);
});
