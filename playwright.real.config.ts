import { defineConfig, devices } from '@playwright/test';

/**
 * REAL-backend end-to-end suite.
 *
 * Unlike `playwright.config.ts` (in-browser MSW mock, what CI runs on every push), this config starts the actual
 * Express API against MariaDB, Redis, OSRM and Mailpit, rebuilds the client with `NEXT_PUBLIC_API_MOCK=0`, and plays
 * the critical path through the real wire. See `e2e-real/README.md` for how to run it.
 *
 * Isolation from the mock suite:
 *  - its own database (`rescue_control_test_e2e`), Redis logical db 11 and BullMQ prefix, recreated by the global setup;
 *  - its own ports (API 4100, web 3211) so a dev server on 4000/3000 can stay up;
 *  - its own Next output directory (`NEXT_DIST_DIR`), because `NEXT_PUBLIC_*` is inlined at build time and the two
 *    suites need opposite values of `NEXT_PUBLIC_API_MOCK`.
 *
 * Timing: the real server runs in real time (no mock speed-up), so the budgets are generous and every wait polls
 * server state (`e2e-real/helpers.ts#waitFor`). There are no fixed sleeps.
 */

const API_PORT = Number(process.env.REAL_API_PORT ?? 4100);
const WEB_PORT = Number(process.env.REAL_WEB_PORT ?? 3211);
const API_URL = `http://localhost:${API_PORT}`;
const APP_URL = `http://localhost:${WEB_PORT}`;
const DATABASE_URL =
  process.env.REAL_DATABASE_URL ?? 'mysql://rescue:rescue@127.0.0.1:3316/rescue_control_test_e2e';
const REDIS_URL = process.env.REAL_REDIS_URL ?? 'redis://127.0.0.1:6380/11';
const BULL_PREFIX = process.env.REAL_BULL_PREFIX ?? 'rc:e2e:bull';

const backendEnv = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  PORT: String(API_PORT),
  PUBLIC_API_URL: API_URL,
  APP_URL,
  CORS_ORIGINS: APP_URL,
  DATABASE_URL,
  REDIS_URL,
  BULL_PREFIX,
  CATALOG_SOURCE: 'yaml',
  // Deterministic and offline: no live weather call in a test run.
  WEATHER_PROVIDER: 'simulated',
  SHOP_RETURN_PATH: '/game/credits',
  RATE_LIMIT_ENABLED: 'false',
};

export default defineConfig({
  testDir: './e2e-real',
  // A real mission runs in real time (preparation + travel + work on scene), so a spec legitimately takes minutes.
  timeout: 25 * 60_000,
  expect: { timeout: 30_000 },
  // Two workers at most: both projects share one API process and one database.
  workers: 2,
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-real' }]],
  outputDir: 'test-results-real',
  use: {
    baseURL: APP_URL,
    // A click that can never land must fail with its own call log instead of silently eating the whole test budget.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  },
  projects: [
    { name: 'real-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'real-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // The reset runs as part of starting the API, because Playwright starts `webServer` BEFORE `globalSetup`:
      // the API would otherwise come up against a database that does not exist yet. `reuseExistingServer: false`
      // guarantees one fresh world per run — `scripts/reset-db.mjs` drops and rebuilds the database, migrates,
      // seeds, imports the Abruzzo release and flushes the Redis logical db.
      command: 'pnpm reset:db && pnpm exec tsx src/entrypoints/all.ts',
      cwd: '../rescue-control-backend',
      url: `${API_URL}/health/ready`,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: backendEnv,
    },
    {
      command: `pnpm build && pnpm exec next start -p ${WEB_PORT}`,
      url: `${APP_URL}/auth`,
      timeout: 600_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_DIST_DIR: '.next-real',
        NEXT_PUBLIC_API_MOCK: '0',
        NEXT_PUBLIC_API_URL: API_URL,
        // Local self-hosted basemap (infra/tiles): the suite never depends on a public tile server.
        NEXT_PUBLIC_PMTILES_URL:
          process.env.NEXT_PUBLIC_PMTILES_URL ?? 'http://127.0.0.1:8088/abruzzo.pmtiles',
        NEXT_PUBLIC_MAP_GLYPHS_URL:
          process.env.NEXT_PUBLIC_MAP_GLYPHS_URL ?? 'http://127.0.0.1:8088/fonts/{fontstack}/{range}.pbf',
        NEXT_PUBLIC_MAP_FONT_BOLD: process.env.NEXT_PUBLIC_MAP_FONT_BOLD ?? 'Noto Sans Medium',
      },
    },
  ],
});
