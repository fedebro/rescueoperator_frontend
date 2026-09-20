import { expect, test, type Page } from '@playwright/test';

/**
 * Shared Playwright plumbing for the feature specs. Every spec runs in both projects (desktop, mobile = Pixel 7).
 * `bootCareer` skips sign-up/onboarding/tutorial (covered once by core-loop.spec.ts) through the mock QA helpers
 * (`window.__rcMock.qa`, src/mocks/qa.ts), which use the same engine functions as the REST handlers.
 */
const problems = new WeakMap<Page, string[]>();

export function trackProblems(): void {
  test.beforeEach(async ({ page }) => {
    const list: string[] = [];
    problems.set(page, list);
    page.on('pageerror', (e) => list.push(`pageerror: ${e.message}`));
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

export interface BootOptions {
  level?: number;
  credits?: number;
  tutorialDone?: boolean;
  /** Sign in as a staff account instead (admin@ / gameadmin@ / support@rescue-control.test). */
  email?: string;
  /** Mock time compression for this test (default: the server default, ×12). */
  speed?: number;
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
  await page.goto('/game');
  await expect(page.getByTestId('topbar')).toBeVisible();
  return directorName;
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
