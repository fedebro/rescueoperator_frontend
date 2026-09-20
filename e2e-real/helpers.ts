import { spawnSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Plumbing for the REAL-backend suite (`playwright.real.config.ts`).
 *
 * Unlike `e2e/`, nothing here is simulated: the app talks to the Express API on `REAL_API_URL`, which talks to
 * MariaDB, Redis, OSRM and Mailpit. The suite therefore has to do three things the mock suite gets for free:
 *  - read the one-time code out of Mailpit instead of typing `123456`;
 *  - reach privileged operations through the backend CLI (the documented support tooling) instead of a QA hook;
 *  - wait for state the server owns, by POLLING it — never with a fixed sleep. `waitFor` below is the only timing
 *    primitive in the suite, and every wait has an explicit budget.
 */

export const API_URL = process.env.REAL_API_URL ?? 'http://localhost:4100';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
const BACKEND_DIR = new URL('../../rescue-control-backend/', import.meta.url).pathname;

/* ───────────────────────────── problem tracking ───────────────────────────── */

const problems = new WeakMap<Page, string[]>();

/**
 * Fails the test on runtime errors, missing translations, contract mismatches — and, because this suite talks to the
 * real API, on any 5xx and on the untranslated-warning fallbacks that only surface against the real server.
 */
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
    page.on('response', (r) => {
      if (r.status() >= 500) list.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });
  });
  test.afterEach(async ({ page }) => {
    expect(problems.get(page) ?? [], 'no runtime errors, 5xx responses or contract mismatches').toEqual([]);
  });
}

/** Lets one expected failure through (used where a 4xx/5xx is the point of the assertion). */
export function ignoreProblem(page: Page, pattern: RegExp): void {
  const list = problems.get(page);
  if (list)
    problems.set(
      page,
      list.filter((p) => !pattern.test(p)),
    );
}

/* ───────────────────────────── polling ───────────────────────────── */

/**
 * Polls `check` until it returns a truthy value. The only wait in this suite: no `waitForTimeout`, no hardcoded
 * durations that assume how fast the machine is.
 */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | null | undefined | false>,
  { timeoutMs = 60_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value) return value as T;
      last = value;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what} (last: ${String(last)})`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/* ───────────────────────────── Mailpit ───────────────────────────── */

interface MailpitMessage {
  ID: string;
  Subject: string;
  Created: string;
  To: { Address: string }[];
}

/**
 * The 6-digit code the backend really sent to `address`, read from Mailpit. The code is in the subject
 * ("880223 è il tuo codice di accesso…"), which keeps this independent of the HTML template and of the locale.
 * `after` guards against reading the previous code when a test asks for a second one.
 */
export async function otpFor(address: string, after = 0): Promise<string> {
  return waitFor(
    `an OTP e-mail for ${address}`,
    async () => {
      const res = await fetch(
        `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=20`,
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { messages?: MailpitMessage[] };
      const match = (body.messages ?? [])
        .filter((m) => Date.parse(m.Created) > after)
        .map((m) => ({ at: Date.parse(m.Created), code: /\b(\d{6})\b/.exec(m.Subject)?.[1] }))
        .filter((m): m is { at: number; code: string } => !!m.code)
        .sort((a, b) => b.at - a.at)[0];
      return match?.code ?? null;
    },
    { timeoutMs: 30_000, intervalMs: 400 },
  );
}

/* ───────────────────────────── backend CLI (support tooling) ───────────────────────────── */

/**
 * Runs `pnpm cli …` against the same database the suite drives. Used only for operations a support operator would
 * really perform (grant credits/XP through the ledger, grant a staff role, spawn a scripted incident, flip a flag):
 * everything the player can do goes through the UI.
 */
export function cli(...args: string[]): string {
  const result = spawnSync('pnpm', ['cli', ...args], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.REAL_DATABASE_URL ?? 'mysql://rescue:rescue@127.0.0.1:3316/rescue_control_test_e2e',
      REDIS_URL: process.env.REAL_REDIS_URL ?? 'redis://127.0.0.1:6380/11',
      BULL_PREFIX: process.env.REAL_BULL_PREFIX ?? 'rc:e2e:bull',
      PORT: String(new URL(API_URL).port || 4100),
      PUBLIC_API_URL: API_URL,
      APP_URL: process.env.REAL_APP_URL ?? 'http://localhost:3211',
    },
  });
  if (result.status !== 0)
    throw new Error(`pnpm cli ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

/* ───────────────────────────── sign-up ───────────────────────────── */

export interface Account {
  email: string;
  directorName: string;
}

export const uniqueAccount = (prefix: string): Account => {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  // `DirectorName` is capped at 24 characters and the input silently truncates: build a name that always fits, or
  // the stored value stops matching what the test looks for.
  const short = prefix.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return { email: `e2e.${prefix}.${id}@rescue-control.test`, directorName: `QA ${short} ${id.slice(-5)}` };
};

/** Real sign-up: e-mail → OTP from Mailpit → director name + consents. Lands on /onboarding. */
export async function signUp(page: Page, account: Account): Promise<void> {
  const requestedAt = Date.now() - 1000;
  await page.goto('/auth');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Email').press('Enter');
  await expect(page.getByRole('heading', { name: 'Controlla la posta' })).toBeVisible();

  const code = await otpFor(account.email, requestedAt);
  await page.getByTestId('otp-0').click();
  await page.keyboard.type(code);

  await expect(page.getByRole('heading', { name: 'Benvenuto, Direttore' })).toBeVisible();
  await page.getByLabel('Nome del Direttore').fill(account.directorName);
  await page.locator('#acceptTerms').click();
  await page.locator('#confirmAge').click();
  await page.getByRole('button', { name: 'Crea il mio account' }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });
}

/** Onboarding against the real geodata: search Pescara, pick the central starter site, create the career. */
export async function createCareer(page: Page): Promise<void> {
  await page.getByTestId('location-search').fill('Pescara');
  const pescara = page.getByTestId('location-result').filter({ hasText: 'Pescara' }).first();
  await expect(pescara).toHaveAttribute('data-playable', 'true', { timeout: 30_000 });
  await pescara.click();
  await expect(page.getByTestId('site-card')).toHaveCount(3, { timeout: 30_000 });
  await page.getByTestId('start-career').click();
  await expect(page).toHaveURL(/\/game$/, { timeout: 60_000 });
  await expect(page.getByTestId('topbar')).toBeVisible();
}

/** The career id of the signed-in player, read from the client's own API calls. */
export async function careerIdOf(page: Page): Promise<string> {
  return waitFor('the career id', async () => {
    const id = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource').map((e) => e.name);
      for (const url of entries) {
        const match = /\/careers\/(car_[0-9A-Z]{26})/.exec(url);
        if (match) return match[1];
      }
      return null;
    });
    return id;
  });
}

/* ───────────────────────────── interruptions ───────────────────────────── */

/**
 * The real server keeps playing while a test does something else: a background incident resolves and the outcome
 * modal opens, a level-up unlocks a family and its celebration opens. Both are modal, so they swallow the next
 * click. These handlers dismiss them wherever they appear, which is exactly what a player does.
 *
 * Both QUEUE: two pending outcomes show two modals in a row, and a jump of several levels unlocks several families,
 * one celebration each (a `career:grant` of 4000 XP unlocks EMS *and* POLICE). `noWaitAfter` is therefore required —
 * without it Playwright waits for the locator to disappear after the handler, and the next dialog of the queue has
 * already taken its place, so the wait never ends. With it, the handler simply runs again before the next action.
 *
 * They are separate because a handler is invisible to assertions: a spec that WANTS to assert its own mission
 * outcome must arm `dismissOutcomes` only after that step, or the handler closes the modal first.
 */
export async function dismissOutcomes(page: Page): Promise<void> {
  await page.addLocatorHandler(
    page.getByTestId('outcome-modal'),
    async () => {
      await page.getByTestId('outcome-continue').click({ timeout: 10_000 });
    },
    { noWaitAfter: true },
  );
}

export async function dismissUnlockCelebrations(page: Page): Promise<void> {
  await page.addLocatorHandler(
    page.getByTestId('family-unlock'),
    async (dialog) => {
      await dialog.getByRole('button', { name: 'Più tardi' }).click({ timeout: 10_000 });
    },
    { noWaitAfter: true },
  );
}

/** Both of the above. Use it when the spec never asserts an outcome modal itself. */
export async function dismissInterruptions(page: Page): Promise<void> {
  await dismissOutcomes(page);
  await dismissUnlockCelebrations(page);
}

/* ───────────────────────────── navigation ───────────────────────────── */

export const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 1024;

/** Navigates through the real navigation (sidebar on desktop, bottom bar / "Altro" on mobile). */
export async function goTo(page: Page, name: RegExp | string, underMore = false): Promise<void> {
  if (isMobile(page) && underMore)
    await page.getByTestId('bottom-nav').getByRole('link', { name: 'Altro' }).click();
  await page.getByRole('link', { name }).first().click();
}

export const creditsOf = async (page: Page): Promise<number> =>
  Number((await page.getByTestId('credits').innerText()).replace(/\D/g, ''));

/* ───────────────────────────── speed-ups ───────────────────────────── */

/**
 * Finishes a managerial timer through the real speed-up feature (quote → confirm → the server runs the normal
 * handler). It is how the suite compresses construction / delivery / onboarding waits without faking a clock: the
 * server still executes the real completion, it just executes it now.
 *
 * A timer can finish by itself between the button appearing and the dialog opening — the dialog then says so and
 * charges nothing. That is a legitimate outcome, so it is reported rather than treated as a failure.
 */
export async function speedUp(page: Page, scope?: Locator): Promise<'paid' | 'already-done'> {
  const root = scope ?? page.locator('body');
  const button = root.getByTestId('speedup-button').first();
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();

  const dialog = page.getByTestId('speedup-dialog');
  await expect(dialog).toBeVisible();
  const cost = dialog.getByTestId('speedup-cost');
  const done = dialog.getByText('già terminato');
  await expect(cost.or(done)).toBeVisible({ timeout: 30_000 });

  if (await cost.isVisible()) {
    await dialog.getByTestId('speedup-confirm').click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    return 'paid';
  }
  await dialog.getByRole('button', { name: 'Annulla' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  return 'already-done';
}
