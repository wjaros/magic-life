import { expect, type Locator, type Page } from '@playwright/test';

/** Setup screen: default is 4 players, 40 life, no turn limit. Starts the game. */
export async function startFourPlayerGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Magic Life' })).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.panel')).toHaveCount(4);
}

/** The i-th player panel (0-based, in seating order). */
export function panel(page: Page, index: number): Locator {
  return page.locator('.panel').nth(index);
}

export function lifeOf(page: Page, index: number): Locator {
  return panel(page, index).locator('.life');
}

/** Opens the counter sheet of the i-th panel via its stats strip. */
export async function openSheet(page: Page, index: number): Promise<void> {
  await panel(page, index).getByRole('button', { name: 'Liczniki' }).click();
  await expect(page.locator('.sheet')).toBeVisible();
}

export async function closeSheet(page: Page): Promise<void> {
  await page.locator('.sheet').getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

/** The i-th player row on the setup screen (0-based). */
export function setupRow(page: Page, index: number): Locator {
  return page.locator('.prow').nth(index);
}
