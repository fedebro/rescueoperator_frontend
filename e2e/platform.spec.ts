import { expect, test, type Page, type Request } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

trackProblems();

// The server is shared with every other spec (and, in development, compiles routes on demand): be patient.
test.describe.configure({ timeout: 300_000 });

/** The shared dev server compiles a route on first visit: navigations get a generous timeout. */
const NAV = 60_000;

const unreadInMock = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __rcMock: { qa: { career: () => { notifications: { readAt: string | null }[] } } };
        }
      ).__rcMock.qa
        .career()
        .notifications.filter((n) => n.readAt === null).length,
  );

const bell = (page: Page) => page.getByTestId('notifications-button');
const badge = (page: Page) => page.getByTestId('notifications-badge');

test.describe('notifications centre', () => {
  test('live badge → centre → category filter → direct action → read-all, persisted', async ({
    page,
  }, testInfo) => {
    await bootCareer(page, testInfo.project.name, { credits: 50_000 });
    // Exact unread counts need a silent world: off duty, no open incidents, everything read.
    await qa(page, 'quiet');
    await page.reload();
    await expect(page.getByTestId('topbar')).toBeVisible();
    const centre = page.getByRole('dialog', { name: 'Notifiche' });
    await expect(badge(page)).toBeHidden();
    await expect(bell(page)).toHaveAccessibleName('Notifiche, 0 non lette');

    // Live: a CRITICAL notification also toasts; a real level-up produces a PROGRESSION one.
    await qa(page, 'notify', 'FACILITIES', 'CRITICAL');
    await expect(page.getByTestId('toast').filter({ hasText: 'Avviso di prova: sedi' })).toBeVisible();
    await expect(badge(page)).toHaveText('1');
    await qa(page, 'setLevel', 2);
    await qa(page, 'notify', 'FLEET', 'INFO');
    await expect(badge(page)).toHaveText('3');
    await expect(bell(page)).toHaveAccessibleName('Notifiche, 3 non lette');

    await bell(page).click();
    await expect(centre).toBeVisible();
    const items = centre.getByTestId('notification-item');
    await expect(centre.locator('[data-testid="notification-item"][data-unread="true"]')).toHaveCount(3);
    // Priority and category are icon + label (never colour alone); an identical body is not repeated.
    const critical = items.filter({ hasText: 'Avviso di prova: sedi' });
    await expect(critical.getByText('Critica')).toBeVisible();
    await expect(critical.getByText('Sedi', { exact: true })).toBeVisible();
    await expect(critical.getByText('Richiede un intervento immediato.')).toBeVisible();
    await expect(critical.getByText('Apri la sede')).toBeVisible();

    // Filter by category, then unread-only.
    await centre.getByTestId('notifications-filter-FLEET').click();
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Avviso di prova: flotta');
    await centre.getByTestId('notifications-filter-PROGRESSION').click();
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Livello 2 raggiunto!');

    // Direct action: opens the career screen, marks that notification as read, closes the centre.
    await items.first().click();
    await expect(page).toHaveURL(/\/game\/progression$/, { timeout: NAV });
    await expect(centre).toBeHidden();
    await expect(badge(page)).toHaveText('2');
    await expect.poll(() => unreadInMock(page)).toBe(2);

    // Unread-only hides what was just read; read-all clears the badge.
    await bell(page).click();
    await centre.getByTestId('notifications-unread-only').click();
    await expect(items).toHaveCount(2);
    await centre.getByTestId('notifications-read-all').click();
    await expect(badge(page)).toBeHidden();
    await expect(centre.getByText('Niente con questi filtri')).toBeVisible();
    await expect.poll(() => unreadInMock(page)).toBe(0);

    // Persisted server-side: still clear after a reload, and the items are there, read.
    await page.reload();
    await expect(page.getByTestId('topbar')).toBeVisible();
    await expect(badge(page)).toBeHidden();
    await expect(bell(page)).toHaveAccessibleName('Notifiche, 0 non lette');
    await bell(page).click();
    await expect(items.filter({ hasText: 'Avviso di prova: sedi' })).toHaveAttribute('data-unread', 'false');
    await expect(centre.locator('[data-testid="notification-item"][data-unread="true"]')).toHaveCount(0);
  });

  test('an OPERATIONS notification selects the incident on the map', async ({ page }, testInfo) => {
    await bootCareer(page, testInfo.project.name);
    const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 4);
    await qa(page, 'notify', 'OPERATIONS', 'IMPORTANT');
    await goTo(page, 'Flotta');
    await expect(page).toHaveURL(/\/game\/fleet$/, { timeout: NAV });
    await bell(page).click();
    await page
      .getByRole('dialog', { name: 'Notifiche' })
      .getByTestId('notification-item')
      .filter({ hasText: 'Avviso di prova: operazioni' })
      .click();
    await expect(page).toHaveURL(/\/game$/, { timeout: NAV });
    await expect(page.getByTestId('inspector-title')).toBeVisible();
    expect(incidentId).toMatch(/^inc_/);
  });
});

test.describe('product analytics', () => {
  const isAnalytics = (r: Request) => r.method() === 'POST' && r.url().endsWith('/api/v1/analytics/events');

  test('nothing is sent without consent; after opting in a batched, PII-free POST is observed', async ({
    page,
  }, testInfo) => {
    const sent: Request[] = [];
    page.on('request', (r) => {
      if (isAnalytics(r)) sent.push(r);
    });
    const directorName = await bootCareer(page, testInfo.project.name);
    const hideTab = () =>
      page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      });

    // Consent is OFF by default: play a little, force a lifecycle flush → no request at all.
    await qa(page, 'spawn', 'MED_FALL', 3);
    await goTo(page, 'Impostazioni', true);
    await expect(page.getByRole('heading', { name: 'Impostazioni', level: 1 })).toBeVisible({ timeout: NAV });
    await hideTab();
    await page.waitForTimeout(1500);
    expect(sent).toHaveLength(0);
    expect(await qa<unknown[]>(page, 'analyticsEvents')).toHaveLength(0);

    // Opt in from Settings.
    const consent = page.getByTestId('analytics-consent-toggle');
    await expect(consent).toHaveAttribute('aria-checked', 'false');
    await consent.click();
    await expect(consent).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('reduced-motion-toggle').click();
    const [request] = await Promise.all([page.waitForRequest(isAnalytics, { timeout: 20_000 }), hideTab()]);

    const body = request.postDataJSON() as {
      events: { name: string; at: string; props?: Record<string, unknown> }[];
    };
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    expect(body.events.length).toBeLessThanOrEqual(50);
    expect(body.events.map((e) => e.name)).toEqual(expect.arrayContaining(['settings_changed']));
    expect(body.events[0]).toMatchObject({
      name: 'settings_changed',
      props: { setting: 'analyticsConsent', value: true },
    });
    for (const e of body.events) {
      expect(e.name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(Number.isNaN(Date.parse(e.at))).toBe(false);
      expect(e.props?.sid).toBeTruthy();
    }
    // No PII: no email, no director name, no free text.
    const raw = request.postData() ?? '';
    expect(raw).not.toContain('@');
    expect(raw).not.toContain(directorName);
    expect(raw).not.toMatch(/example\.com/);
    expect(request.headers().authorization).toMatch(/^Bearer /);
    expect((await request.response())?.status()).toBe(204);
    // The mock validated the batch with the contract schema and stored it, attributed to the user id only.
    await expect
      .poll(async () => (await qa<{ name: string; userId: string | null }[]>(page, 'analyticsEvents')).length)
      .toBeGreaterThanOrEqual(2);
    const stored = await qa<{ name: string; userId: string | null }[]>(page, 'analyticsEvents');
    expect(stored[0]!.userId).toMatch(/^usr_/);

    // Opting out again stops everything.
    await consent.click();
    const before = sent.length;
    await page.getByTestId('reduced-motion-toggle').click();
    await hideTab();
    await page.waitForTimeout(1500);
    expect(sent.length).toBe(before);
  });
});

test.describe('PWA', () => {
  test('manifest is served with the required fields and existing icons', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('application/manifest+json');
    const manifest = (await res.json()) as {
      name: string;
      short_name: string;
      description: string;
      id: string;
      start_url: string;
      scope: string;
      display: string;
      orientation: string;
      theme_color: string;
      background_color: string;
      categories: string[];
      icons: { src: string; sizes: string; purpose?: string }[];
      shortcuts: { name: string; url: string }[];
    };
    expect(manifest).toMatchObject({
      name: 'Rescue Control',
      short_name: 'Rescue Control',
      id: '/game',
      start_url: '/game',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#0A1220',
      background_color: '#0A1220',
    });
    expect(manifest.description.length).toBeGreaterThan(20);
    expect(manifest.categories).toContain('games');
    expect(manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === 'any' && i.sizes === '192x192')).toBe(true);
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['/game', '/game/incidents', '/game/fleet']);
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  });

  test('offline shell page renders and the worker script is served', async ({ page, request }) => {
    await page.goto('/offline');
    await expect(page.getByTestId('offline-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sei offline', level: 1 })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Rescue Control' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Riprova' })).toBeVisible();

    const sw = await request.get('/sw.js');
    expect(sw.ok()).toBe(true);
    expect(sw.headers()['content-type']).toContain('javascript');
    expect(await sw.text()).toContain("const OFFLINE_URL = '/offline'");

    // Mock mode: MSW owns the root scope — the app worker must NOT be registered here.
    const scripts = await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map(
        (r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL ?? '',
      ),
    );
    expect(scripts.some((s) => s.endsWith('/sw.js'))).toBe(false);
  });

  test('Settings offers the install entry and the sound controls', async ({ page }, testInfo) => {
    await bootCareer(page, testInfo.project.name);
    await goTo(page, 'Impostazioni', true);
    const install = page.getByTestId('install-app-setting');
    await expect(install.getByText('Installa l’app')).toBeVisible({ timeout: NAV });
    await expect(install.getByRole('button', { name: 'Installa' })).toBeVisible();

    const master = page.getByTestId('sound-toggle');
    // Off by default on touch devices, on by default on desktop.
    await expect(master).toHaveAttribute('aria-checked', isMobile(page) ? 'false' : 'true');
    if (isMobile(page)) await master.click();
    await expect(page.getByTestId('sound-alerts-toggle')).toBeEnabled();
    await page.getByTestId('sound-feedback-toggle').click();
    await expect(page.getByTestId('sound-feedback-toggle')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('sound-volume').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('65%')).toBeVisible();
    await page.getByTestId('sound-test').click();
    await master.click();
    await expect(page.getByTestId('sound-volume')).toBeDisabled();
    // Persisted per device.
    await page.reload();
    await expect(page.getByTestId('sound-toggle')).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('accessibility', () => {
  test('keyboard journey: skip link → navigation → notifications → Escape restores focus', async ({
    page,
  }, testInfo) => {
    await bootCareer(page, testInfo.project.name);
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // First Tab stop of the page = skip link; activating it moves FOCUS into <main>.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Vai al contenuto' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();

    // Main navigation: landmarks are named, links are operable with Enter, the current page is exposed.
    const nav = page.getByRole('navigation', { name: 'Navigazione principale' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    const fleet = nav.getByRole('link', { name: 'Flotta' });
    await fleet.focus();
    const outline = await fleet.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none'); // visible focus
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/game\/fleet$/, { timeout: NAV });
    await expect(nav.getByRole('link', { name: 'Flotta' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Flotta' })).toBeVisible({ timeout: NAV });

    // Notifications: open with the keyboard, focus is trapped inside, Escape closes and restores focus.
    const button = bell(page);
    await button.focus();
    await page.keyboard.press('Enter');
    const centre = page.getByRole('dialog', { name: 'Notifiche' });
    await expect(centre).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await centre.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(centre).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('touch targets of the shared shell are at least 44px on phones', async ({ page }, testInfo) => {
    test.skip(!isMobile(page), 'phone layout only');
    await bootCareer(page, testInfo.project.name);
    const targets = [
      bell(page),
      page.getByTestId('level-meter'),
      page.getByTestId('credits'),
      ...(await page.getByTestId('bottom-nav').getByRole('link').all()),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box, 'target is rendered').not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('reduced motion: the in-app setting neutralises animations', async ({ page }, testInfo) => {
    await bootCareer(page, testInfo.project.name);
    await goTo(page, 'Impostazioni', true);
    await page.getByTestId('reduced-motion-toggle').click({ timeout: NAV });
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    await bell(page).click();
    const duration = await page
      .getByRole('dialog', { name: 'Notifiche' })
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(duration).toBeLessThan(0.01);
  });
});
