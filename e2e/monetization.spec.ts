import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Monetization flows on both layouts: gate (tutorial + first organic purchase), credit shop with the simulated hosted
 * checkout, rewarded video with the simulated player, referral panel, speed-up of a vehicle delivery.
 */
trackProblems();

const creditsOf = async (page: Page): Promise<number> =>
  Number((await page.getByTestId('credits').innerText()).replace(/\D/g, ''));

/** The first organic purchase: a second fire engine from the vehicle shop. */
async function buySecondEngine(page: Page): Promise<void> {
  await goTo(page, 'Acquisti');
  await page
    .locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]')
    .getByTestId('buy-vehicle')
    .click();
  await expect(page.getByTestId('toast').filter({ hasText: 'APS 2 ordinato' })).toBeVisible();
}

async function expectNoMonetizationNav(page: Page): Promise<void> {
  if (isMobile(page)) await page.getByTestId('bottom-nav').getByRole('link', { name: 'Altro' }).click();
  await expect(page.getByRole('link', { name: 'Impostazioni' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ricarica Crediti' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'La tua rete' })).toHaveCount(0);
}

test('gate → shop checkout → rewarded video → referral network', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    // Deterministic share fallback: no native share sheet in the test browser.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await bootCareer(page, testInfo.project.name, { credits: 3000 });

  await test.step('gate: nothing is offered before the first organic purchase', async () => {
    await expectNoMonetizationNav(page);
    await page.goto('/game/credits');
    await expect(page).toHaveURL(/\/game$/);
    await page.goto('/game/network');
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.getByTestId('topbar')).toBeVisible();
  });

  await test.step('after an organic purchase the entries appear', async () => {
    await buySecondEngine(page);
    await goTo(page, 'Ricarica Crediti', true);
    await expect(page).toHaveURL(/\/game\/credits$/);
    await expect(page.getByTestId('credit-package')).toHaveCount(5);
    // EUR price always visible on every package.
    for (const price of await page.getByTestId('package-price').allInnerTexts()) expect(price).toMatch(/€/);
  });

  await test.step('checkout: waiver required, simulated payment, success page, history', async () => {
    const before = await creditsOf(page);
    const pack = page.locator('[data-testid="credit-package"][data-package="PACK_M"]');
    await expect(pack).toContainText('Più scelto');
    await expect(pack.getByTestId('package-price')).toContainText('4,99');
    await pack.getByTestId('buy-package').click();
    await expect(page.getByTestId('waiver-error')).toBeVisible();
    await expect(page).toHaveURL(/\/game\/credits$/);

    await page.getByTestId('waiver').click();
    await pack.getByTestId('buy-package').click();
    await expect(page).toHaveURL(/\/game\/credits\/mock-checkout\?purchase=pur_/);
    await expect(page.getByTestId('mock-checkout')).toContainText('Simulazione');
    await page.getByTestId('mock-pay').click();

    await expect(page).toHaveURL(/\/game\/credits\/success\?purchase=pur_/);
    const result = page.getByTestId('checkout-result');
    await expect(result).toHaveAttribute('data-state', 'credited');
    await expect(result).toContainText(/2\.?800/);
    await expect.poll(() => creditsOf(page)).toBe(before + 2800);

    await result.getByRole('link', { name: 'Torna ai pacchetti' }).click();
    await expect(page).toHaveURL(/\/game\/credits$/);
    await expect(page.locator('[data-status="CREDITED"]').first()).toContainText('Accreditato');
  });

  await test.step('a cancelled checkout charges nothing', async () => {
    const before = await creditsOf(page);
    await page.getByTestId('waiver').click();
    await page
      .locator('[data-testid="credit-package"][data-package="PACK_S"]')
      .getByTestId('buy-package')
      .click();
    await page.getByTestId('mock-cancel').click();
    await expect(page).toHaveURL(/\/game\/credits\/cancel/);
    await expect(page.getByTestId('checkout-result')).toHaveAttribute('data-state', 'cancelled');
    expect(await creditsOf(page)).toBe(before);
    await page.getByRole('link', { name: 'Torna ai pacchetti' }).click();
    await expect(page.locator('[data-status="FAILED"]').first()).toBeVisible();
  });

  await test.step('rewarded video: watch the simulated player to the end', async () => {
    const before = await creditsOf(page);
    const card = page.getByTestId('rewarded-card');
    await expect(card.getByTestId('ads-watched')).toContainText('0/5');
    await card.getByTestId('watch-ad').click();
    const player = page.getByTestId('ad-player');
    await expect(player).toBeVisible();
    await expect(player).toContainText('Simulazione');
    await expect(player).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId('toast').filter({ hasText: '+80 Crediti' })).toBeVisible();
    await expect(card.getByTestId('ads-watched')).toContainText('1/5');
    await expect(card.getByTestId('ad-blocked')).toHaveAttribute('data-reason', 'COOLDOWN');
    await expect(card.getByTestId('watch-ad')).toBeDisabled();
    await expect.poll(() => creditsOf(page)).toBe(before + 80);
  });

  await test.step('referral panel: code, share fallbacks, 0/2 → 2/2 rewarded', async () => {
    await goTo(page, 'La tua rete', true);
    await expect(page).toHaveURL(/\/game\/network$/);
    await expect(page.getByRole('heading', { name: 'Costruisci la tua rete' })).toBeVisible();
    const code = (await page.getByTestId('referral-code').innerText()).trim();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    await expect(page.getByTestId('invite-url')).toContainText(`/invite/${code}`);

    await page.getByTestId('copy-invite').click();
    await expect(
      page.getByTestId('toast').filter({ hasText: /Link copiato|Copia non riuscita/ }),
    ).toBeVisible();
    await page.getByTestId('share-invite').click();
    const sheet = page.getByTestId('share-sheet');
    await expect(sheet.locator('a[data-channel="whatsapp"]')).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/\?text=/,
    );
    await expect(sheet.locator('a[data-channel="telegram"]')).toHaveAttribute('href', /t\.me\/share/);
    await expect(sheet.locator('a[data-channel="email"]')).toHaveAttribute('href', /^mailto:/);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    const before = await creditsOf(page);
    await expect(page.getByTestId('network-count')).toHaveText('0/2');
    await qa(page, 'simulateInvitee', 'REGISTERED');
    await expect(page.locator('[data-status="REGISTERED"]')).toHaveCount(1);
    await expect(page.getByTestId('network-count')).toHaveText('0/2');
    await qa(page, 'simulateInvitee', 'ACTIVATED');
    await expect(page.getByTestId('network-count')).toHaveText('1/2');
    await expect(page.locator('[data-status="ACTIVATED"]')).toHaveCount(1);
    await qa(page, 'simulateInvitee', 'ACTIVATED');
    await expect(page.getByTestId('network-count')).toHaveText('2/2');
    await expect(page.getByTestId('reward-claimed')).toBeVisible();
    await expect(page.locator('[data-status="REWARDED"]')).toHaveCount(2);
    await expect.poll(() => creditsOf(page)).toBe(before + 1500);
  });

  await test.step('public invite landing remembers the code', async () => {
    const code = (await page.getByTestId('referral-code').innerText()).trim();
    await page.goto(`/invite/${code}`);
    await expect(page.getByTestId('invite-landing')).toHaveAttribute('data-valid', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ti ha invitato su Rescue Control');
    expect(await page.evaluate(() => localStorage.getItem('rc-invite-code'))).toContain(code);
    await page.goto('/invite/ZZZZ9999');
    await expect(page.getByTestId('invite-landing')).toHaveAttribute('data-valid', 'false');
    await expect(page.getByTestId('invite-cta')).toHaveAttribute('href', '/auth');
  });
});

test('speed-up finishes a vehicle delivery immediately and spends credits', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  // Slowed-down mock (×0.05) so the 3-minute catalog delivery is still running when we get to it.
  await bootCareer(page, testInfo.project.name, { credits: 3000, speed: 0.05 });
  await buySecondEngine(page);
  const before = await creditsOf(page);

  await goTo(page, 'Flotta');
  await page.getByText('APS 2', { exact: true }).first().click();
  const inspector = page.getByTestId('vehicle-inspector');
  await expect(inspector).toContainText('In consegna');
  await inspector.getByTestId('speedup-button').click();

  const dialog = page.getByTestId('speedup-dialog');
  await expect(dialog).toContainText('Consegna mezzo');
  const cost = Number((await dialog.getByTestId('speedup-cost').innerText()).replace(/\D/g, ''));
  expect(cost).toBeGreaterThan(0);
  await dialog.getByTestId('speedup-confirm').click();

  await expect(page.getByTestId('toast').filter({ hasText: 'Processo completato' })).toBeVisible();
  await expect(inspector).toContainText('Disponibile');
  await expect(inspector.getByTestId('speedup-button')).toHaveCount(0);
  // The quote gets cheaper every second the timer runs: the charge is the price at confirmation time.
  await expect.poll(() => creditsOf(page)).toBeLessThan(before);
  const spent = before - (await creditsOf(page));
  expect(spent).toBeGreaterThan(0);
  expect(spent).toBeLessThanOrEqual(cost);
});
