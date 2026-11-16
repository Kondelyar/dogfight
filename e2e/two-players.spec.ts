import { expect, test, type Browser, type Page } from '@playwright/test';
import { z } from 'zod';

const RoomSchema = z.object({ room: z.object({ id: z.string(), name: z.string() }) });
const ShipsSchema = z.array(z.object({ x: z.number(), y: z.number(), isMe: z.boolean() }));

// Два окремі браузерні контексти (як два різні гравці) заходять в одну кімнату.
async function joinAs(browser: Browser, roomName: string, pilot: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto('/?e2e=1');
  await page.locator('input').first().fill(pilot);
  await page.locator('li', { hasText: roomName }).getByRole('button', { name: 'Join' }).click();
  await expect(page.locator('#chat')).toBeVisible();
  await page.waitForFunction(() => (window.__dogfight?.lastTick() ?? 0) > 0);
  return page;
}

async function ships(page: Page) {
  return ShipsSchema.parse(await page.evaluate(() => window.__dogfight?.ships() ?? []));
}

test('другий гравець бачить рух першого, чат доходить в обидва боки', async ({
  browser,
  request,
}) => {
  const roomName = `e2e-${Date.now()}`;
  const created = await request.post('/api/rooms', { data: { name: roomName } });
  expect(created.status()).toBe(201);
  RoomSchema.parse(await created.json());

  const alice = await joinAs(browser, roomName, 'Alice');
  const bob = await joinAs(browser, roomName, 'Bob');

  // список гравців у кімнаті бачать обидва
  await expect(alice.locator('#chat')).toContainText('Alice, Bob');
  await expect(bob.locator('#chat')).toContainText('Alice, Bob');

  // Bob бачить обидва кораблі; запам'ятовуємо, де Alice була
  await expect.poll(async () => (await ships(bob)).length).toBe(2);
  const before = (await ships(bob)).find((s) => !s.isMe);
  expect(before).toBeDefined();

  // Alice тримає тягу і повертає ~1.5 с
  await alice.keyboard.down('ArrowUp');
  await alice.keyboard.down('ArrowRight');
  await alice.waitForTimeout(1500);
  await alice.keyboard.up('ArrowRight');
  await alice.keyboard.up('ArrowUp');

  // у Bob чужий корабель зрушив із місця
  await expect
    .poll(
      async () => {
        const other = (await ships(bob)).find((s) => !s.isMe);
        if (!other || !before) return 0;
        // відстань по колу арени нам не важлива: достатньо, що позиція помітно змінилась
        return Math.hypot(other.x - before.x, other.y - before.y);
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(20);

  // чат: Alice пише, Bob бачить
  await alice.locator('#chat input').fill('привіт від Alice');
  await alice.locator('#chat input').press('Enter');
  await expect(bob.locator('.chat-log')).toContainText('Alice: привіт від Alice');

  // і навпаки
  await bob.locator('#chat input').fill('і тобі, Alice');
  await bob.locator('#chat input').press('Enter');
  await expect(alice.locator('.chat-log')).toContainText('Bob: і тобі, Alice');

  await alice.context().close();
  await bob.context().close();
});

test('вихід гравця оновлює список гравців в іншого', async ({ browser, request }) => {
  const roomName = `e2e-leave-${Date.now()}`;
  await request.post('/api/rooms', { data: { name: roomName } });

  const alice = await joinAs(browser, roomName, 'Alice');
  const bob = await joinAs(browser, roomName, 'Bob');
  await expect(alice.locator('#chat')).toContainText('Alice, Bob');

  await bob.context().close(); // Bob закрив вкладку
  await expect(alice.locator('#chat')).not.toContainText('Bob', { timeout: 10_000 });
  await expect(alice.locator('#chat')).toContainText('Alice');

  await alice.context().close();
});

// хук, який клієнт відкриває при ?e2e=1 (client/src/e2e.ts)
declare global {
  interface Window {
    __dogfight?: {
      ships(): { x: number; y: number; isMe: boolean }[];
      lastTick(): number;
    };
  }
}
