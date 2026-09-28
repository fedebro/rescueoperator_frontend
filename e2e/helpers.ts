import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Shared Playwright plumbing for the feature specs. Every spec runs in both projects (desktop, mobile = Pixel 7).
 * `bootCareer` skips sign-up/onboarding/tutorial (covered once by core-loop.spec.ts) through the mock QA helpers
 * (`window.__rcMock.qa`, src/mocks/qa.ts), which use the same engine functions as the REST handlers.
 */
const problems = new WeakMap<Page, string[]>();

/**
 * WebKit reports a Next.js RSC prefetch (`?_rsc=`) cancelled by a navigation as a page error "… due to access control
 * checks" when a service worker is in the path — here MSW, the mock backend (no service worker handles those requests in
 * production). No application code is involved: not a problem of the app under test.
 */
export const isBenignBrowserNoise = (message: string): boolean =>
  /\?_rsc=\S* due to access control checks/.test(message) ||
  // The same WebKit wording for loads still in flight when a navigation tears the page down, with MSW's service worker in
  // the path: a mock-API fetch (seen on the runways query of the persistent map) and a MapLibre `blob:` resource of the
  // test page. WebKit truncates the message ("…/localhost:4000/api/v1/… due to access control checks."), so the patterns
  // match the tail only. Only WebKit words cancellations this way: real request failures still fail on Chromium.
  /localhost:\d+\/api\/v1\/\S+ due to access control checks/.test(message) ||
  /blob:http:\/\/localhost:\d+\/[0-9a-f-]+ due to access control checks|^t?t?p:\/\/localhost:\d+\/[0-9a-f-]{36} due to access control checks/.test(
    message,
  );

/** A page error with the top of its stack: a failure report that says where, not only what. */
export const describePageError = (e: Error): string =>
  `pageerror: ${e.message}${e.stack ? `\n${e.stack.split('\n').slice(0, 6).join('\n')}` : ''}`;

export function trackProblems(): void {
  test.beforeEach(async ({ page }) => {
    const list: string[] = [];
    problems.set(page, list);
    page.on('pageerror', (e) => {
      if (!isBenignBrowserNoise(e.message)) list.push(describePageError(e));
    });
    page.on('console', (m) => {
      if (
        m.type() === 'error' &&
        /MISSING_MESSAGE|FORMATTING_ERROR|Hydration|contract mismatch/i.test(m.text())
      )
        list.push(m.text());
    });
    // Tests must not depend on the public tile server: game layers render without basemap tiles.
    await page.route(/tiles\.openfreemap\.org/, (route) => route.abort());
  });
  test.afterEach(async ({ page }) => {
    expect(
      problems.get(page) ?? [],
      'no runtime errors, missing translations or contract mismatches',
    ).toEqual([]);
  });
}

export const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 1024;

/**
 * On phones toasts stack newest in front and only the front card takes input (the ones behind are `inert`): a toast
 * pushed right after the one a test wants to act on (a coaching line, a new call) would hide its action. Closes the
 * cards in front of `toast` until it is the front one. No-op on desktop (no `data-depth`).
 */
export async function bringToastToFront(page: Page, toast: Locator): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    const depth = await toast.getAttribute('data-depth');
    if (depth === null || depth === '0') return;
    await page.locator('[data-testid="toast"][data-depth="0"]').getByRole('button').last().click();
  }
}

export interface BootOptions {
  level?: number;
  credits?: number;
  tutorialDone?: boolean;
  /** Sign in as a staff account instead (admin@ / gameadmin@ / support@rescue-control.test). */
  email?: string;
  /** Mock time compression for this test (default: the server default, ×12). */
  speed?: number;
  /** Keep the push-permission sheet of this release (default: already shown — see `dismissPushPrompt`). */
  pushPrompt?: boolean;
}

/** Creates a ready-to-play career in the mock backend and lands on /game. Returns the director name. */
export async function bootCareer(page: Page, projectName: string, opts: BootOptions = {}): Promise<string> {
  const unique = `${projectName}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = opts.email ?? `qa.${unique}@example.com`;
  const directorName = `QA ${unique.slice(-10)}`;
  await page.goto('/auth');
  if (opts.speed) await page.evaluate((s) => localStorage.setItem('rc-mock-speed', String(s)), opts.speed);
  await page.waitForFunction(() => '__rcMock' in window);
  await page.evaluate(
    ({ email, directorName, level, credits, tutorialDone }) =>
      (
        window as unknown as {
          __rcMock: { qa: { createReadyCareer: (o: Record<string, unknown>) => unknown } };
        }
      ).__rcMock.qa.createReadyCareer({ email, directorName, level, credits, tutorialDone }),
    {
      email,
      directorName,
      level: opts.level ?? 1,
      credits: opts.credits,
      tutorialDone: opts.tutorialDone ?? true,
    },
  );
  await dismissInstallHint(page);
  if (!opts.pushPrompt) await dismissPushPrompt(page);
  await page.goto('/game');
  await expect(page.getByTestId('topbar')).toBeVisible();
  return directorName;
}

/**
 * The one-time "install the app" hint is a toast raised 20 s into a session wherever an install is possible — on the
 * iPhone project (iOS user agent) that is every game session. A toast landing at a random moment in front of the one a
 * test is about to tap makes the run flaky, so booted careers start with it already seen (the same persisted flag the
 * hint sets itself; the Settings entry, covered by platform.spec, does not depend on it). Takes effect on the next load.
 */
export async function dismissInstallHint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const key = 'rc-settings';
    let saved: { state?: Record<string, unknown>; version?: number } = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? '{}') as typeof saved;
    } catch {
      saved = {};
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        ...saved,
        state: { ...saved.state, installHintDismissed: true },
        version: saved.version ?? 1,
      }),
    );
  });
}

/**
 * The push-permission sheet (D-98) opens a few seconds into a game session, once per release, on every device without
 * notifications — headless Chromium reports the permission as "denied" (the "blocked" card), the iPhone project gets the
 * Home Screen variant. A modal landing at a random moment breaks unrelated specs, so booted careers start with it already
 * shown for THIS build: the same per-device memory the sheet writes (`rc-push` → `promptedRelease`), keyed by the
 * build's `<meta name="rc-release">`. e2e/push.spec.ts covers the sheet itself. Takes effect on the next load.
 */
export async function dismissPushPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = document.querySelector('meta[name="rc-release"]')?.getAttribute('content');
    if (!release) throw new Error('<meta name="rc-release"> is missing: is this a build of the game?');
    const key = 'rc-push';
    let saved: { state?: Record<string, unknown>; version?: number } = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? '{}') as typeof saved;
    } catch {
      saved = {};
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        ...saved,
        state: { ...saved.state, promptedRelease: release },
        version: saved.version ?? 1,
      }),
    );
  });
}

/** Calls a mock QA helper: `qa(page, 'spawn', 'MED_FALL', 4)`. */
export async function qa<T = unknown>(page: Page, helper: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ helper, args }) =>
      (window as unknown as { __rcMock: { qa: Record<string, (...a: unknown[]) => unknown> } }).__rcMock.qa[
        helper
      ]!(...args) as never,
    { helper, args },
  );
}

/** Navigates through the real navigation (sidebar on desktop, bottom bar / "Altro" on mobile). */
export async function goTo(page: Page, name: RegExp | string, underMore = false): Promise<void> {
  if (isMobile(page) && underMore)
    await page.getByTestId('bottom-nav').getByRole('link', { name: 'Altro' }).click();
  await page.getByRole('link', { name }).first().click();
}

/**
 * Against a dev server the Next.js dev-tools badge sits on top of the mobile bottom nav.
 * It does not exist in the production build the CI runs against, so it is only hidden here.
 * `addInitScript` runs before the very first document exists, hence the readyState guard:
 * touching `document.documentElement` too early throws and fails the no-runtime-errors assertion.
 */
export async function hideDevToolsBadge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const apply = () => {
      const root = document.head ?? document.documentElement;
      if (!root) return false;
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none!important}';
      root.appendChild(style);
      return true;
    };
    if (!apply()) document.addEventListener('DOMContentLoaded', () => void apply(), { once: true });
  });
}
