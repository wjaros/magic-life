import { expect, test } from '@playwright/test';
import { panel, startFourPlayerGame } from './helpers';

const playToggle = (page: import('@playwright/test').Page) =>
  page.locator('.tb-play');

test('clock starts, counts game time, and pause stops it', async ({ page }) => {
  await startFourPlayerGame(page);
  const time = page.locator('.tb-time');
  await expect(time).toHaveText('0:00');

  await playToggle(page).click();
  await expect(playToggle(page)).toHaveAttribute('aria-label', 'Pauza');

  // Timing is the subject here: let the running clock accumulate time.
  await page.waitForTimeout(1200);
  await expect(time).not.toHaveText('0:00');

  await playToggle(page).click();
  await expect(playToggle(page)).toHaveAttribute('aria-label', 'Start');

  const pausedAt = await time.textContent();
  await page.waitForTimeout(1200);
  await expect(time).toHaveText(pausedAt ?? '');
});

test('next turn moves the active player and increments the turn number', async ({ page }) => {
  await startFourPlayerGame(page);
  await expect(page.locator('.tb-turn')).toHaveText('Tura 1');

  await page.getByRole('button', { name: 'Następna tura' }).click();
  await expect(page.locator('.tb-turn')).toHaveText('Tura 2');
  const firstActive = page.locator('.panel.active');
  await expect(firstActive).toHaveCount(1);
  const firstName = await firstActive.locator('.p-name').textContent();

  await page.getByRole('button', { name: 'Następna tura' }).click();
  await expect(page.locator('.tb-turn')).toHaveText('Tura 3');
  const secondActive = page.locator('.panel.active');
  await expect(secondActive).toHaveCount(1);
  await expect(secondActive.locator('.p-name')).not.toHaveText(firstName ?? '');
});

test('clock time is attributed to the active player and shown on the panel', async ({ page }) => {
  await startFourPlayerGame(page);
  await playToggle(page).click();
  await page.getByRole('button', { name: 'Następna tura' }).click();
  await expect(page.locator('.panel.active')).toHaveCount(1);

  // Timing is the subject: the active player's counter must advance.
  await page.waitForTimeout(1200);
  await expect(page.locator('.panel.active .stat.time')).not.toHaveText(/⏱ 0:00$/);
  await expect(panel(page, 0).locator('.stat.time')).toBeVisible();
});
