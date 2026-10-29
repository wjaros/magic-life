import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const RELAY_PORT = Number(process.env.E2E_RELAY_PORT ?? 4174);
// Specs that need the real relay server (server/index.ts): host-connect, remote UI.
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
      // Builds dist/ for every project (the relay server below serves the same build).
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'node server/index.ts',
      env: { STATIC_DIR: 'dist', PORT: String(RELAY_PORT) },
      url: `http://localhost:${RELAY_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
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
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://localhost:${RELAY_PORT}`,
      },
    },
  ],
});
