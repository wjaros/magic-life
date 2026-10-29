import { expect, test, type Page } from '@playwright/test';

// A fake AudioContext records the frequency of every oscillator that gets started.
// Time is controlled with Playwright's clock (installed before goto, paused after start): it fakes both Date.now and
// setInterval, which is exactly what the app's clock and the 200 ms cue scheduler use, so
// page.clock.runFor() advances game time and fires the scheduler ticks deterministically.
// Cue frequencies: minute 880 (+1760 overtone), tick 660, countdown 1320, timeout 880 then 440.
const FAKE_AUDIO = () => {
  (window as unknown as { __cues: number[] }).__cues = [];
  class FakeParam {
    value = 0;
    setValueAtTime() { return this; }
    linearRampToValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
  }
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createGain() { return { gain: new FakeParam(), connect() {} }; }
    createOscillator() {
      const frequency = new FakeParam();
      return {
        frequency,
        type: 'sine',
        connect() {},
        stop() {},
        start() { (window as unknown as { __cues: number[] }).__cues.push(frequency.value); },
      };
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
};

const cues = (page: Page) => page.evaluate(() => (window as unknown as { __cues: number[] }).__cues);

async function startWithLimit(page: Page) {
  await page.addInitScript(FAKE_AUDIO);
  await page.clock.install({ time: new Date('2030-01-01T12:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: '1 min', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.panel')).toHaveCount(4);
  await page.locator('.tb-play').click(); // starts the clock (also the user gesture)
  await expect(page.locator('.tb-play')).toHaveAttribute('aria-label', 'Pauza');
  // Freeze time so only runFor() advances it; otherwise real time leaks in between steps
  // on a loaded machine and can push the turn past the next threshold.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
}

test('turn-limit countdown plays tick and countdown cues, then timeout', async ({ page }) => {
  await startWithLimit(page);
  expect(await cues(page)).toEqual([]);

  await page.clock.runFor(1_000); // lets the scheduler take its baseline
  await page.clock.runFor(29_100); // 30 s remaining
  expect(await cues(page)).toEqual([660]);

  await page.clock.runFor(10_000); // 20 s remaining
  expect(await cues(page)).toEqual([660, 660]);

  await page.clock.runFor(10_000); // 10 s remaining
  expect(await cues(page)).toEqual([660, 660, 660]);

  await page.clock.runFor(5_000); // 5 s remaining
  expect(await cues(page)).toEqual([660, 660, 660, 1320]);

  await page.clock.runFor(5_000); // 4,3,2,1 then 0
  expect(await cues(page)).toEqual([660, 660, 660, 1320, 1320, 1320, 1320, 1320, 880, 440]);
});

test('turning sound off silences the cues', async ({ page }) => {
  await startWithLimit(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('switch', { name: /Dźwięk/ }).click();
  await expect(page.getByRole('switch', { name: /Dźwięk/ })).toHaveText(/wył\./);
  await page.getByRole('button', { name: 'Zamknij' }).click();

  await page.clock.runFor(1_000);
  await page.clock.runFor(30_000);
  expect(await cues(page)).toEqual([]);

  // and on again: the next cue (20 s remaining) is audible
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('switch', { name: /Dźwięk/ }).click();
  await page.getByRole('button', { name: 'Zamknij' }).click();
  await page.clock.runFor(10_000);
  expect(await cues(page)).toEqual([660]);
});
