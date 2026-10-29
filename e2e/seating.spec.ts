import { expect, test, type Page } from '@playwright/test';
import { closeSheet, openSheet, panel } from './helpers';

const STORAGE_KEY = 'magic-life/v1';

async function rotations(page: Page): Promise<string[]> {
  return page.locator('.panel').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rotation ?? ''));
}

test('seating "Na końcach" sets rotations, per-tile rotate, menu switch, reload persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Na końcach' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.panel')).toHaveCount(4);
  expect(await rotations(page)).toEqual(['180', '180', '0', '0']);

  // manual per-tile rotation: +90
  await openSheet(page, 2);
  await page.getByRole('button', { name: 'Obróć panel' }).click();
  await expect(panel(page, 2)).toHaveAttribute('data-rotation', '90');
  await closeSheet(page);

  // switch seating from the menu: rotations are recomputed (manual override dropped)
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Układ: na końcach/ }).click();
  expect(await rotations(page)).toEqual(['90', '270', '90', '270']);
  await page.getByRole('button', { name: /Układ: wzdłuż/ }).click();
  expect(await rotations(page)).toEqual(['180', '180', '0', '0']);
  await page.getByRole('button', { name: 'Zamknij' }).click();

  await page.waitForFunction(
    (key) => {
      const raw = window.localStorage.getItem(key);
      return !!raw && JSON.parse(raw).history.present.settings.seating === 'ends';
    },
    STORAGE_KEY,
  );
  await page.reload();
  await expect(page.locator('.panel')).toHaveCount(4);
  expect(await rotations(page)).toEqual(['180', '180', '0', '0']);
});

test('default seating is "wzdłuż" and the choice is hidden for 2 players', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Wzdłuż' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '2', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Na końcach' })).toHaveCount(0);
  await page.getByRole('button', { name: '4', exact: true }).first().click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  expect(await rotations(page)).toEqual(['90', '270', '90', '270']);
});
