import { expect, test } from '@playwright/test';

interface WebManifest {
  name?: string;
  short_name?: string;
  icons?: Array<{ src: string; sizes?: string; purpose?: string }>;
}

test('manifest is linked from the page and fetchable with name and 192/512 icons', async ({ page, request }) => {
  await page.goto('/');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href, 'manifest link href').toBeTruthy();

  const manifestUrl = new URL(href!, page.url()).toString();
  const response = await request.get(manifestUrl);
  expect(response.status()).toBe(200);

  const manifest = (await response.json()) as WebManifest;
  expect(manifest.name?.trim().length ?? 0).toBeGreaterThan(0);

  const sizes = (manifest.icons ?? []).map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');

  // Every declared icon must be fetchable, not just listed.
  for (const icon of manifest.icons ?? []) {
    const iconResponse = await request.get(new URL(icon.src, manifestUrl).toString());
    expect(iconResponse.status(), `icon ${icon.src}`).toBe(200);
  }
});
