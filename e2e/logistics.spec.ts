import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Logistics area on both layouts: workshop (service → done), breakdown with automatic recovery followed in the vehicle
 * inspector, and the low-stock → urgent order → delivery loop. Slow / random states are reached with the mock QA helpers.
 */
trackProblems();

const openLogistics = async (page: Page, tab: 'Magazzino' | 'Ordini' | 'Officina') => {
  await goTo(page, 'Logistica', true);
  // The first visit may wait for the route to compile on the shared dev server.
  await expect(page.getByRole('heading', { name: 'Logistica', level: 1 })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: tab }).click();
};

test('locked features show the level that opens them', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 1 });
  await openLogistics(page, 'Magazzino');
  await expect(page.getByTestId('feature-locked')).toContainText('Richiede il livello 2');
  await page.getByRole('tab', { name: 'Officina' }).click();
  await expect(page.getByTestId('feature-locked')).toContainText('Richiede il livello 3');
});

test('maintenance: worn vehicle → service → done; breakdown → recovery → repair → available', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 3000 });
  await qa(page, 'wear', null, 60);

  await test.step('the workshop shows the worn vehicle as due', async () => {
    await openLogistics(page, 'Officina');
    const tab = page.getByTestId('workshop-tab');
    await expect(tab.getByTestId('due-state').first()).toHaveAttribute('data-state', 'DUE');
    await expect(tab.getByTestId('health-band').first()).toHaveAttribute('data-state', 'WORN');
    await expect(tab.getByTestId('failure-risk').first()).toContainText('Rischio guasto');
  });

  await test.step('start a routine service with one tap', async () => {
    if (isMobile(page)) await page.getByTestId('workshop-vehicle').first().click();
    else await page.getByRole('row').filter({ hasText: 'APS 1' }).first().click();
    const dialog = page.getByTestId('workshop-dialog');
    await expect(dialog.getByTestId('health-value')).toHaveText('60%');
    const quote = dialog.getByTestId('maintenance-quote').filter({ hasText: 'Tagliando' });
    await expect(quote).toContainText('condizioni al 85%');
    await dialog.getByTestId('start-SERVICE').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'APS 1 è entrato in officina' })).toBeVisible();
    await expect(dialog).toBeHidden();
    const order = page.getByTestId('workshop-facility').getByTestId('work-order');
    await expect(order).toHaveAttribute('data-work-status', 'IN_PROGRESS');
    await expect(order.getByTestId('countdown')).toBeVisible();
    await expect(page.getByTestId('workshop-slots')).toContainText('1/1');
  });

  await test.step('the service completes and resets the schedule', async () => {
    await qa(page, 'fastForward', 600);
    const tab = page.getByTestId('workshop-tab');
    await expect(tab.getByTestId('work-order')).toHaveCount(0);
    await expect(tab.getByTestId('due-state').first()).toHaveAttribute('data-state', 'NOT_DUE');
    await expect(tab.getByTestId('health-band').first()).toHaveAttribute('data-state', 'GOOD');
  });

  await test.step('dispatch, then the vehicle breaks down on the road', async () => {
    await qa(page, 'spawn', 'FIRE_TRASH_BIN', 1);
    // Mobile: the map is the leftmost bottom-nav item, which the dev-server overlay badge can cover → direct navigation.
    if (isMobile(page)) await page.goto('/game');
    else await goTo(page, 'Centro operativo');
    await page.getByTestId('incident-card').first().click();
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('assigned-vehicle').first()).toHaveAttribute(
      'data-vehicle-status',
      'EN_ROUTE',
      { timeout: 30_000 },
    );
    await page.getByTestId('assigned-vehicle').first().click();
    const inspector = page.getByTestId('vehicle-inspector');
    await expect(inspector).toBeVisible();
    await qa(page, 'breakDown');
    await expect(inspector).toHaveAttribute('data-vehicle-status', 'BROKEN_DOWN');
    const steps = inspector.getByTestId('recovery-steps');
    await expect(steps).toBeVisible();
    await expect(steps).toContainText('Mezzo in avaria');
    await expect(steps).toContainText('Il recupero è automatico');
  });

  await test.step('automatic recovery → repair → available, all in the inspector', async () => {
    const inspector = page.getByTestId('vehicle-inspector');
    const steps = inspector.getByTestId('recovery-steps');
    await expect(inspector).toHaveAttribute('data-vehicle-status', 'BEING_RECOVERED', { timeout: 30_000 });
    await expect(steps).toHaveAttribute('data-step', 'BEING_RECOVERED');
    await expect(inspector).toHaveAttribute('data-vehicle-status', 'MAINTENANCE', { timeout: 60_000 });
    await expect(steps).toHaveAttribute('data-step', 'REPAIR');
    await expect(steps.getByTestId('countdown')).toBeVisible();
    await qa(page, 'fastForward', 600);
    await expect(inspector).toHaveAttribute('data-vehicle-status', 'AVAILABLE');
    await expect(steps).toBeHidden();
    await expect(inspector.getByTestId('health-value')).toHaveText('70%');
    const history = inspector.getByTestId('vehicle-history');
    await expect(history).toContainText('Riparazione completata');
    await expect(history).toContainText('Rientrato in sede al traino');
  });
});

test('inventory: low stock alert → urgent order → delivery restores the stock', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 2000 });
  await qa(page, 'drainStock', 'FOAM', 80);

  await test.step('low-stock alert with icon and label', async () => {
    await openLogistics(page, 'Magazzino');
    await expect(page.getByTestId('low-stock-alert')).toContainText('1 articolo è sotto la scorta minima');
    await expect(page.locator('[data-testid="stock-state"][data-state="LOW"]')).toHaveCount(1);
  });

  await test.step('order several packs, compare the two quotes, pick urgent', async () => {
    await page.getByTestId('low-stock-order').click();
    const dialog = page.getByTestId('order-dialog');
    await dialog.getByTestId('order-suggest').click();
    const foam = dialog.locator('[data-testid="order-line"][data-item="FOAM"]');
    await expect(foam.getByTestId('order-packs')).toHaveText('2');
    await dialog
      .locator('[data-testid="order-line"][data-item="ABSORBENT"]')
      .getByRole('button', { name: /in più/ })
      .click();
    await expect(dialog.getByTestId('quote-standard')).toContainText('240');
    await expect(dialog.getByTestId('quote-urgent')).toContainText('360');
    await dialog.getByTestId('quote-urgent').click();
    await expect(dialog.getByTestId('quote-urgent')).toHaveAttribute('aria-checked', 'true');
    await dialog.getByTestId('order-submit').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Ordine inviato' })).toBeVisible();
    await expect(page.getByTestId('credits')).toContainText(/1\.?640/);
  });

  await test.step('the order is in delivery with a countdown, then delivered', async () => {
    await page.getByRole('tab', { name: 'Ordini' }).click();
    const status = page.getByTestId('order-status').first();
    await expect(status).toHaveAttribute('data-state', 'IN_DELIVERY');
    await expect(page.getByTestId('countdown').first()).toBeVisible();
    await qa(page, 'fastForward', 600);
    await expect(status).toHaveAttribute('data-state', 'DELIVERED');
  });

  await test.step('stock restored, alert gone — also on the facility page', async () => {
    await page.getByRole('tab', { name: 'Magazzino' }).click();
    await expect(page.getByTestId('low-stock-alert')).toBeHidden();
    await expect(page.locator('[data-testid="stock-state"][data-state="LOW"]')).toHaveCount(0);
    await goTo(page, 'Sedi', true);
    const section = page.getByTestId('facility-stock');
    await expect(section.getByTestId('stock-line')).toHaveCount(3);
    await expect(
      section.locator('[data-testid="stock-line"][data-item="FOAM"]').getByTestId('stock-quantity'),
    ).toHaveText('120');
    await section.getByTestId('open-order').click();
    await expect(page.getByTestId('order-dialog')).toBeVisible();
  });
});
