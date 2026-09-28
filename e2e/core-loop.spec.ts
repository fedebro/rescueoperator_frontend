import { expect, test, type Page } from '@playwright/test';
import { describePageError, dismissPushPrompt, isBenignBrowserNoise } from './helpers';

/**
 * The whole core loop against the in-browser mock backend, in both layouts (projects: desktop, mobile):
 * sign up with OTP → pick Pescara → pick a site → tutorial incident → dispatch → arrival → outcome →
 * buy a second vehicle → reload with state intact → language switch → sign out and back in.
 */

const problems = new WeakMap<Page, string[]>();

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
  // The test must not depend on the public tile server: game layers render without basemap tiles.
  await page.route(/tiles\.openfreemap\.org/, (route) => route.abort());
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page) ?? [], 'no runtime errors, missing translations or contract mismatches').toEqual(
    [],
  );
});

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

async function goTo(page: Page, name: RegExp | string, moreFirst = false) {
  if (isMobile(page) && moreFirst)
    await page.getByTestId('bottom-nav').getByRole('link', { name: 'Altro' }).click();
  await page.getByRole('link', { name }).first().click();
}

test('core loop: from sign-up to a second vehicle, surviving a reload', async ({ page }, testInfo) => {
  const unique = `${testInfo.project.name}${Date.now()}`;
  const email = `direttore.${unique}@example.com`;
  const directorName = `Dir ${unique.slice(-9)}`;

  await test.step('sign up with e-mail + OTP', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth$/);
    // The push-permission sheet after the tutorial is push.spec's business: this journey starts with it seen.
    await dismissPushPrompt(page);
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Inviami il codice' }).click();
    await expect(page.getByText('Inserisci un indirizzo email valido.')).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Email').press('Enter');

    await expect(page.getByRole('heading', { name: 'Controlla la posta' })).toBeVisible();
    await page.getByTestId('otp-0').click();
    await page.keyboard.type('654321');
    await expect(page.getByRole('alert').filter({ hasText: 'Codice non corretto' })).toBeVisible();
    await page.getByTestId('otp-0').click();
    await page.keyboard.type('123456');

    await expect(page.getByRole('heading', { name: 'Benvenuto, Direttore' })).toBeVisible();
    await page.getByRole('button', { name: 'Crea il mio account' }).click();
    await expect(page.getByText('Per continuare devi accettare')).toBeVisible();
    await page.getByLabel('Nome del Direttore').fill(directorName);
    await page.locator('#acceptTerms').click();
    await page.locator('#confirmAge').click();
    await page.getByRole('button', { name: 'Crea il mio account' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  await test.step('onboarding: Pescara → compare three sites → create the career', async () => {
    await page.getByTestId('location-search').fill('pes');
    const pescara = page.getByTestId('location-result').filter({ hasText: 'Pescara' });
    await expect(pescara).toHaveAttribute('data-playable', 'true');
    await pescara.click();
    await expect(page.getByTestId('site-card')).toHaveCount(3);
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('[data-profile="BALANCED"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-profile="CENTRAL"]').click();
    await expect(page.locator('[data-profile="CENTRAL"]')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('start-career').click();
    await expect(page).toHaveURL(/\/game$/);
  });

  await test.step('game shell + tutorial incident', async () => {
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'WELCOME');
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('credits')).toContainText('400');
    // The incident count lives in the queue (the sheet's summary row on phones), not in the top bar any more.
    await expect(page.getByTestId('incident-card')).toHaveCount(1);
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
    if (isMobile(page)) await expect(page.getByTestId('bottom-nav').getByRole('link')).toHaveCount(5);
    await page.getByTestId('tutorial-start').click();
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'SELECT_INCIDENT');
    await page.getByTestId('incident-card').first().click();
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    await expect(page.getByTestId('inspector-title')).toHaveText('Incendio cassonetto');
  });

  await test.step('dispatch the recommended set with one tap', async () => {
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'DISPATCH');
    await expect(page.getByTestId('dispatch-option')).toHaveCount(1);
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Mezzo inviato' })).toBeVisible();
    await expect(page.getByTestId('assigned-vehicle')).toHaveCount(1);
  });

  await test.step('watch the arrival and the work on scene', async () => {
    await expect(page.getByTestId('assigned-vehicle')).toHaveAttribute('data-vehicle-status', 'EN_ROUTE', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-status', 'ON_SCENE', {
      timeout: 40_000,
    });
    await expect(page.getByTestId('assigned-vehicle')).toHaveAttribute('data-vehicle-status', 'ON_SCENE');
  });

  await test.step('mission outcome: stars, gross / costs / net, XP', async () => {
    const modal = page.getByTestId('outcome-modal');
    await expect(modal).toBeVisible({ timeout: 40_000 });
    await expect(modal.getByTestId('outcome-stars')).toHaveAttribute('data-stars', /[1-3]/);
    await expect(modal.getByText('Ricompensa lorda')).toBeVisible();
    await expect(modal.getByText('Netto accreditato')).toBeVisible();
    await expect(modal.getByTestId('outcome-net')).toContainText('+');
    await page.getByTestId('outcome-continue').click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'BUY_VEHICLE');
  });

  let creditsAfterPurchase = '';
  await test.step('shop: locked states, insufficient credits flow, buy a second vehicle', async () => {
    await goTo(page, 'Acquisti');
    await expect(page).toHaveURL(/\/game\/shop$/);
    const ladder = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_AS"]');
    await expect(ladder).toHaveAttribute('data-unlocked', 'false');
    await expect(ladder.getByTestId('locked-reason')).toContainText('livello 5');

    // ~900 credits after the tutorial: a second fire engine (800) is affordable…
    const engine = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]');
    await engine.getByTestId('buy-vehicle').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'APS 2 ordinato' })).toBeVisible();
    await expect(page.getByTestId('tutorial')).toBeHidden();
    creditsAfterPurchase = (await page.getByTestId('credits').innerText()).trim();
    expect(Number(creditsAfterPurchase.replace(/\D/g, ''))).toBeLessThan(400);

    // …a third one is not → the three-option dialog, in the mandated order.
    await engine.getByTestId('buy-vehicle').click();
    const dialog = page.getByTestId('insufficient-credits');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveText([
      /Continua a giocare/,
      /Guarda un video/,
      /Acquista Crediti/,
    ]);
    await dialog.getByRole('button', { name: 'Chiudi' }).last().click();
  });

  await test.step('fleet shows both vehicles; delivery completes', async () => {
    await goTo(page, 'Flotta');
    await expect(page.getByText('APS 2', { exact: true })).toBeVisible();
    await expect(page.getByText('APS 1', { exact: true })).toBeVisible();
    await expect(page.getByText('2 mezzi · 2 disponibili')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('reload: session restored from the refresh cookie, state intact', async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/game\/fleet$/);
    await expect(page.getByText('APS 2', { exact: true })).toBeVisible();
    await expect(page.getByTestId('credits')).toHaveText(creditsAfterPurchase);
    await expect(page.getByTestId('tutorial')).toHaveCount(0);
  });

  await test.step('other screens render in this layout', async () => {
    await goTo(page, 'Sedi');
    await expect(page.getByTestId('facility-detail')).toBeVisible();
    await expect(page.getByTestId('upgrade-offer').first()).toBeVisible();
    await goTo(page, 'Bilancio', true);
    await expect(page.getByText('Ricompensa di missione').first()).toBeVisible();
    await expect(page.getByText('Fondo iniziale').first()).toBeVisible();
    await goTo(page, 'Carriera', true);
    await expect(page.getByTestId('unlock-level').first()).toHaveAttribute('data-reached', 'true');
  });

  await test.step('language switch', async () => {
    await goTo(page, 'Impostazioni', true);
    await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Lingua' }).click();
    await page.getByRole('option', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Language' }).click();
    await page.getByRole('option', { name: 'Deutsch' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Italiano' }).click();
    await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  });

  await test.step('sign out, then sign back in as a returning user (no profile step)', async () => {
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/auth$/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Email').press('Enter');
    await page.getByTestId('otp-0').click();
    await page.keyboard.type('123456');
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.getByTestId('credits')).toHaveText(creditsAfterPurchase);
  });
});
