import { expect, test } from '@playwright/test';

// iOS fallbacks can only be checked structurally here (no WebKit in CI): the keep-awake video is
// injected after a tap on an iPhone user agent, and both helper media files are served.
test.use({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
});

test('iPhone: a muted looping inline video keeps the screen awake after the first tap', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const video = page.locator('video');
  await expect(video).toHaveCount(1);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, loop: v.loop, inline: v.playsInline, src: v.src })))
    .toMatchObject({ muted: true, loop: true, inline: true, src: expect.stringMatching(/nosleep\.mp4$/) });
});

test('keep-awake video and silence clip are served', async ({ request }) => {
  for (const [path, type] of [['nosleep.mp4', 'video/mp4'], ['silence.wav', 'audio/wav']]) {
    const r = await request.get(path);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain(type.split('/')[0]);
  }
});
