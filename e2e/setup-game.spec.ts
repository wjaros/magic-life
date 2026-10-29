import { expect, test } from '@playwright/test';
import { lifeOf, panel, startFourPlayerGame } from './helpers';

test('setup starts a 4-player game with 40 life each', async ({ page }) => {
  await startFourPlayerGame(page);

  await expect(page.locator('.panel')).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(panel(page, i)).toBeVisible();
    await expect(lifeOf(page, i)).toHaveText('40');
  }
  await expect(page.locator('.tb-turn')).toHaveText('Tura 1');
});
