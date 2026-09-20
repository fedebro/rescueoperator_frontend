import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/tiles\.openfreemap\.org/, (route) => route.abort());
});

test('anonymous visitors are sent to /auth from every protected area', async ({ page }) => {
  for (const path of ['/game', '/game/shop', '/onboarding', '/admin']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth$/);
  }
});

test('404 page', async ({ page }) => {
  const res = await page.goto('/questa-pagina-non-esiste');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible();
  await page.getByRole('link', { name: 'Torna alla centrale' }).click();
  await expect(page).toHaveURL(/\/auth$/);
});

test('design system page showcases every component group', async ({ page }) => {
  await page.goto('/design');
  for (const id of [
    'brand',
    'tokens',
    'typography',
    'buttons',
    'forms',
    'status',
    'capability',
    'overlays',
    'data',
    'icons',
  ])
    await expect(page.getByTestId(`design-${id}`)).toBeVisible();
  await page.getByRole('button', { name: 'Dialog' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'BottomSheet' }).click();
  const sheet = page.getByRole('region', { name: 'Pannello inferiore di esempio' });
  await expect(sheet).toHaveAttribute('data-snap', 'half');
  await page.getByTestId('sheet-handle').click();
  await expect(sheet).toHaveAttribute('data-snap', 'full');
});

test('keyboard: the auth form is fully operable and focus is visible', async ({ page }) => {
  await page.goto('/auth');
  await page.getByLabel('Email').focus();
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type('tastiera@example.com');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('otp-0')).toBeFocused();
  const outline = await page.getByTestId('otp-0').evaluate((el) => getComputedStyle(el).borderColor);
  expect(outline).not.toBe('');
});

test('admin: a staff account signs in through the normal flow and reaches the role-gated shell', async ({
  page,
}) => {
  await page.goto('/auth');
  await page.getByLabel('Email').fill('admin@rescue-control.test');
  await page.getByLabel('Email').press('Enter');
  await page.getByTestId('otp-0').click();
  await page.keyboard.type('123456');
  // First run creates the admin account; later runs (reused server, same browser storage) sign straight in.
  const profile = page.getByLabel('Nome del Direttore');
  await Promise.race([profile.waitFor(), page.waitForURL(/\/(onboarding|game)$/)]);
  if (await profile.isVisible()) {
    await profile.fill(`Admin ${Date.now() % 100000}`);
    await page.locator('#acceptTerms').click();
    await page.locator('#confirmAge').click();
    await page.getByRole('button', { name: 'Crea il mio account' }).click();
  }
  await expect(page).toHaveURL(/\/(onboarding|game)$/);
  // The admin shell does not need a career (full coverage of the panel: e2e/admin.spec.ts).
  await page.goto('/admin');
  await expect(page.getByTestId('admin-env-banner')).toContainText('Ambiente: Simulato');
  await expect(page.getByRole('heading', { name: 'Panoramica' })).toBeVisible();
  await expect(page.getByText('Code di lavoro')).toBeVisible();
  const mobile = (page.viewportSize()?.width ?? 1440) < 1024;
  if (mobile) await page.getByRole('button', { name: 'Apri il menu' }).click();
  await page
    .getByRole('navigation', { name: 'Navigazione amministrazione' })
    .getByRole('link', { name: 'Utenti' })
    .click();
  await expect(page.getByRole('heading', { name: 'Utenti' })).toBeVisible();
  await expect(page.getByText('admin@rescue-control.test').first()).toBeVisible();
});
