import { expect, test } from '@playwright/test';
import { closeSheet, lifeOf, openSheet, panel, startFourPlayerGame } from './helpers';

test('21 commander damage from one opponent eliminates the player; undo restores', async ({ page }) => {
  await startFourPlayerGame(page);

  // Open the counter sheet of player 1 (first panel) and deal 21 from "Gracz 2".
  await openSheet(page, 0);
  const fromOpponent = page.locator('.sheet').getByRole('button', { name: 'Gracz 2 plus' });
  for (let i = 0; i < 21; i++) {
    await fromOpponent.click();
  }
  await closeSheet(page);

  await expect(panel(page, 0)).toHaveClass(/\bout\b/);
  await expect(panel(page, 0).locator('.reason')).toHaveText('Obrażenia od dowódcy');
  // Commander damage also costs life (21 damage from 40 -> 19).
  await expect(lifeOf(page, 0)).toHaveText('19');

  // One undo removes the last point of damage: 20 damage, life 20, no longer eliminated.
  await page.getByRole('button', { name: 'Cofnij', exact: true }).click();

  await expect(panel(page, 0)).not.toHaveClass(/\bout\b/);
  await expect(panel(page, 0).locator('.reason')).toHaveCount(0);
  await expect(lifeOf(page, 0)).toHaveText('20');
});

test('10 poison eliminates the player', async ({ page }) => {
  await startFourPlayerGame(page);

  await openSheet(page, 1);
  const poisonPlus = page.locator('.sheet').getByRole('button', { name: 'Trucizna plus' });
  for (let i = 0; i < 9; i++) {
    await poisonPlus.click();
  }
  await closeSheet(page);
  await expect(panel(page, 1)).not.toHaveClass(/\bout\b/);

  await openSheet(page, 1);
  await poisonPlus.click();
  await closeSheet(page);

  await expect(panel(page, 1)).toHaveClass(/\bout\b/);
  await expect(panel(page, 1).locator('.reason')).toHaveText('Trucizna');
});
