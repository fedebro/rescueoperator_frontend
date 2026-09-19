import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3210);

/**
 * E2E runs against a production build wired to the in-browser mock backend (no real API needed).
 * Two projects = the two first-class layouts (D-12): desktop Chromium and a phone viewport.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/auth`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_API_MOCK: '1',
      NEXT_PUBLIC_MOCK_SPEED: '12',
      NEXT_PUBLIC_API_URL: 'http://localhost:4000',
    },
  },
});
