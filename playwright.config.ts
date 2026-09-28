import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3210);

/**
 * E2E runs against a production build wired to the in-browser mock backend (no real API needed).
 * Projects = the two first-class layouts (D-12): desktop Chromium and a phone (Pixel 7, Chromium: real touch input
 * through DevTools). Plus an iPhone on WebKit (D-79) for the phone-specific suites — the bottom sheet's gestures, the
 * core loop and the in-app browsers (iOS in-app browsers are WKWebView) — so Safari's engine is exercised where the mobile
 * UX lives (`pnpm exec playwright install webkit`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Every page runs the whole mock backend (simulation loop, MSW) next to the production server: with Playwright's default
  // (half the CPU cores, 5 on the 10-core dev machine) some timing-sensitive specs miss their 15 s windows at random.
  // Three workers keep the full run at ~10 minutes and deterministic. Override with `--workers` or E2E_WORKERS.
  workers: Number(process.env.E2E_WORKERS ?? 3),
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
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'] },
      testMatch: /(mobile-ux|core-loop|in-app-browsers)\.spec\.ts$/,
    },
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
