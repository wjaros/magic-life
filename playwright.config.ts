import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const RELAY_PORT = 4174;
/** Specs that need the real relay server (node server/index.ts) instead of vite preview. */
const RELAY_SPECS = ['**/*remote*.spec.ts', '**/host-*.spec.ts'];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Serves dist/ (built by the server above; Playwright waits for both) and relays /ws.
      command: 'node server/index.ts',
      env: { PORT: String(RELAY_PORT), STATIC_DIR: 'dist' },
      url: `http://localhost:${RELAY_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'pixel-7',
      testIgnore: RELAY_SPECS,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'iphone-like',
      testIgnore: RELAY_SPECS,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'relay',
      testMatch: RELAY_SPECS,
      use: { baseURL: `http://localhost:${RELAY_PORT}` },
    },
  ],
});
