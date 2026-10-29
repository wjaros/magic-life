import { expect, test } from '@playwright/test';

test('app still renders offline after the service worker controls the page', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Magic Life' })).toBeVisible();

  // Wait for the service worker to be active, then reload once so it controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Magic Life' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
