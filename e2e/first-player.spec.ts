import { expect, test, type Page } from '@playwright/test';
import { startFourPlayerGame } from './helpers';

async function expectWinner(page: Page) {
  const badge = page.locator('.first-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveText('Zaczynasz!');
  await expect(page.locator('.panel.active')).toHaveCount(1);
  await expect(page.locator('.panel.active .first-badge')).toHaveCount(1);
  await expect(page.locator('.tb-turn')).toHaveText('Tura 1');
  await expect(page.locator('.tb-play')).toHaveAttribute('aria-label', 'Start');
}

test('draw button picks exactly one first player (animated)', async ({ page }) => {
  await startFourPlayerGame(page);
  const roll = page.getByRole('button', { name: /Losuj pierwszego gracza/ });
  await expect(roll).toBeVisible();
  await roll.click();
  // Tapping during the animation is harmless.
  await roll.click({ force: true, timeout: 1000 }).catch(() => {});
  await expectWinner(page);
  // the badge goes away, the button is gone, the active player stays
  await expect(page.locator('.first-badge')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.panel.active')).toHaveCount(1);
  await expect(roll).toHaveCount(0);
});

test('reduced motion skips straight to the result; menu entry re-rolls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startFourPlayerGame(page);
  await page.getByRole('button', { name: /Losuj pierwszego gracza/ }).click();
  await expectWinner(page);
  await expect(page.locator('.first-badge')).toHaveCount(0, { timeout: 5000 });

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: '🎲 Losuj pierwszego' }).click();
  await expectWinner(page);
});
