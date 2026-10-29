import { expect, test } from '@playwright/test';
import { lifeOf, openSheet, closeSheet, panel, setupRow } from './helpers';

test('pinned energy and custom counter work from the panel and survive reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Magic Life' })).toBeVisible();

  await setupRow(page, 0).getByRole('button', { name: /Energia/ }).click();
  const row2 = setupRow(page, 1);
  await row2.getByLabel('Własny licznik gracza 2').fill('Skarby');
  await row2.getByRole('button', { name: 'Dodaj licznik gracza 2' }).click();
  await expect(row2.getByRole('button', { name: 'Usuń licznik Skarby' })).toBeVisible();

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.panel')).toHaveCount(4);

  const energyPlus = panel(page, 0).getByRole('button', { name: 'Gracz 1: Energia plus' });
  const skarbyPlus = panel(page, 1).getByRole('button', { name: 'Gracz 2: Skarby plus' });
  await expect(energyPlus).toBeVisible();
  await expect(skarbyPlus).toBeVisible();

  for (let i = 0; i < 3; i++) await energyPlus.tap();
  await skarbyPlus.tap();

  await expect(panel(page, 0).locator('.pin-val')).toHaveText('3');
  await expect(panel(page, 1).locator('.pin-val')).toHaveText('1');
  await expect(lifeOf(page, 0)).toHaveText('40');
  await expect(lifeOf(page, 1)).toHaveText('40');

  // Sheet shows the same values and the pin toggles.
  await openSheet(page, 1);
  await expect(page.locator('.sheet').getByText('Własne liczniki')).toBeVisible();
  await expect(page.locator('.sheet').getByRole('button', { name: 'Skarby: przypnij do panelu' })).toHaveAttribute('aria-pressed', 'true');
  await closeSheet(page);

  await page.waitForTimeout(500); // let the debounced save flush
  await page.reload();
  await expect(page.locator('.panel')).toHaveCount(4);
  await expect(panel(page, 0).locator('.pin-val')).toHaveText('3');
  await expect(panel(page, 1).locator('.pin-val')).toHaveText('1');
  await expect(lifeOf(page, 0)).toHaveText('40');
});
