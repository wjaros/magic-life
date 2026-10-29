import { expect, test } from '@playwright/test';
import { lifeOf, panel, startFourPlayerGame } from './helpers';

test('tap on + and - zones changes life by 1', async ({ page }) => {
  await startFourPlayerGame(page);

  await panel(page, 0).locator('.zone-plus').tap();
  await expect(lifeOf(page, 0)).toHaveText('41');

  await panel(page, 0).locator('.zone-minus').tap();
  await expect(lifeOf(page, 0)).toHaveText('40');

  await panel(page, 1).locator('.zone-minus').tap();
  await expect(lifeOf(page, 1)).toHaveText('39');
  await expect(lifeOf(page, 0)).toHaveText('40');
});

test('long press on - zone subtracts 10', async ({ page }) => {
  await startFourPlayerGame(page);

  const zone = panel(page, 2).locator('.zone-minus');
  const box = await zone.boundingBox();
  if (!box) throw new Error('minus zone has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // Hold past the 500 ms long-press threshold, but release before the 400 ms repeat fires twice.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(600); // timing is the subject: the long press must be detected
  await page.mouse.up();

  await expect(lifeOf(page, 2)).toHaveText('30');
});

test('long press on + zone adds 10', async ({ page }) => {
  await startFourPlayerGame(page);

  const zone = panel(page, 3).locator('.zone-plus');
  const box = await zone.boundingBox();
  if (!box) throw new Error('plus zone has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();

  await expect(lifeOf(page, 3)).toHaveText('50');
});
