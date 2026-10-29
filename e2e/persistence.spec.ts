import { expect, test } from '@playwright/test';
import { lifeOf, panel, startFourPlayerGame } from './helpers';

const STORAGE_KEY = 'magic-life/v1';

test('reload mid-game keeps life totals and turn number', async ({ page }) => {
  await startFourPlayerGame(page);

  await panel(page, 0).locator('.zone-plus').tap();
  await panel(page, 0).locator('.zone-plus').tap();
  await panel(page, 1).locator('.zone-minus').tap();
  await page.getByRole('button', { name: 'Następna tura' }).click();
  await expect(page.locator('.tb-turn')).toHaveText('Tura 2');
  await expect(lifeOf(page, 0)).toHaveText('42');
  await expect(lifeOf(page, 1)).toHaveText('39');

  // Persistence is debounced (300 ms); wait for the saved state to reflect the last change.
  await page.waitForFunction(
    (key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      return saved.history.present.clock.turn === 2;
    },
    STORAGE_KEY,
  );

  await page.reload();

  await expect(page.locator('.panel')).toHaveCount(4);
  await expect(lifeOf(page, 0)).toHaveText('42');
  await expect(lifeOf(page, 1)).toHaveText('39');
  await expect(lifeOf(page, 2)).toHaveText('40');
  await expect(page.locator('.tb-turn')).toHaveText('Tura 2');
});
