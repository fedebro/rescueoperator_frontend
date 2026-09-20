import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * World & coverage: top-bar widget (weather · local time · traffic), map layers control (coverage cells, closures),
 * coverage stipend (card → payout → toast, ledger, history) and the milestones / reputation cards.
 * Runs on both layouts; QA helpers (`payStipend`, `setWeather`, `addClosure`) make slow or random states immediate.
 */
trackProblems();

interface MapProbe {
  source: boolean;
  features: number;
  visibility: string | null;
}
const probeLayer = (page: Page, source: string, layer: string): Promise<MapProbe> =>
  page.evaluate(
    ({ source, layer }) => {
      const map = (
        window as unknown as {
          __rcMap: {
            getSource: (id: string) => { serialize?: () => { data?: { features?: unknown[] } } } | undefined;
            getLayer: (id: string) => unknown;
            getLayoutProperty: (id: string, name: string) => string | undefined;
          };
        }
      ).__rcMap;
      const src = map.getSource(source);
      return {
        source: !!src,
        features: src?.serialize?.().data?.features?.length ?? 0,
        visibility: map.getLayer(layer) ? (map.getLayoutProperty(layer, 'visibility') ?? 'visible') : null,
      };
    },
    { source, layer },
  );

test('world widget: weather, local time and traffic with details on both layouts', async ({ page }, info) => {
  await bootCareer(page, info.project.name);
  const widget = page.getByTestId('world-widget');
  await expect(widget).toBeVisible();
  await expect(widget).toHaveAttribute('data-weather', /^[A-Z_]+$/);
  await expect(widget).toHaveAttribute('data-traffic', /^[A-Z_]+$/);
  await expect(widget).toHaveAttribute('aria-label', /traffico/);
  if (!isMobile(page)) {
    await expect(page.getByTestId('world-weather')).toContainText('°C');
    await expect(page.getByTestId('world-time')).toContainText(/\d{2}:\d{2}/);
    await expect(page.getByTestId('world-traffic')).not.toBeEmpty();
  }

  // A forced storm with degraded data reaches the widget through `world.updated` (no reload, no polling).
  await qa(page, 'setWeather', 'STORM', true);
  await expect(widget).toHaveAttribute('data-weather', 'STORM');
  await widget.click();
  const details = page.getByTestId('world-details');
  await expect(details).toBeVisible();
  await expect(details).toContainText('Temporale');
  await expect(details).toContainText('Ora locale');
  await expect(details.getByTestId('weather-degraded')).toContainText('Dati meteo stimati');
  await expect(details.getByTestId('world-travel-effect')).toContainText(/più lenti del \d+%/);
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
});

test('map layers: coverage cells per family, legend, closures list', async ({ page }, info) => {
  // Level 3: the medical service is unlocked but has no ambulance yet.
  await bootCareer(page, info.project.name, { level: 3 });
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
  const control = page.getByTestId('map-layers');
  await expect(control).toHaveAttribute('data-coverage', 'false');
  await expect(control).toHaveAttribute('data-closures', 'true');
  await expect
    .poll(async () => (await probeLayer(page, 'rc-world-closures', 'rc-world-closures-fill')).visibility)
    .toBe('visible');
  await expect(page.getByTestId('map')).toHaveAttribute('data-day-phase', /DAY|TWILIGHT|NIGHT/);

  // Keyboard: the control is a real button, the panel is reachable without a pointer.
  await page.getByTestId('map-layers-button').focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('map-layers-panel');
  await expect(panel).toBeVisible();

  await panel.getByRole('switch', { name: /Copertura/ }).click();
  await expect(control).toHaveAttribute('data-coverage', 'true');
  await expect
    .poll(async () => Number(await control.getAttribute('data-coverage-cells')))
    .toBeGreaterThan(20);
  const coverage = await probeLayer(page, 'rc-world-coverage', 'rc-world-coverage-fill');
  expect(coverage).toMatchObject({ source: true, visibility: 'visible' });
  expect(coverage.features).toBeGreaterThan(20);

  const section = panel.getByTestId('coverage-section');
  await expect(section.getByTestId('coverage-pct')).toContainText('%');
  await expect(section.getByTestId('coverage-legend')).toContainText('fino a 5 min');
  await expect(section.getByTestId('coverage-legend')).toContainText('Non raggiungibile');
  await section.getByTestId('coverage-family-FIRE').click();
  await expect(section.getByTestId('coverage-family-FIRE')).toHaveAttribute('aria-pressed', 'true');
  await expect(section).toContainText('Soglia di servizio: 12 min');
  // No ambulance yet: the EMS view has no reachable cell and says why.
  await section.getByTestId('coverage-family-EMS').click();
  await expect(section.getByTestId('coverage-pct')).toHaveText('0%');
  await expect(section.getByTestId('coverage-family-EMS')).toContainText('nessun mezzo');

  // Closures: a new one appears live in the list with its reason, kind and countdown.
  await qa(page, 'addClosure', { street: 'Via Nicola Fabrizi', seconds: 3600 });
  const row = panel.getByTestId('closure-row').filter({ hasText: 'Via Nicola Fabrizi' });
  await expect(row).toContainText('Lavori in corso in Via Nicola Fabrizi');
  await expect(row).toContainText('Chiusa');
  await expect(row.getByTestId('countdown')).toBeVisible();
  await expect
    .poll(async () => (await probeLayer(page, 'rc-world-closures', 'rc-world-closures-fill')).features)
    .toBeGreaterThan(0);

  await panel.getByRole('switch', { name: /Strade chiuse/ }).click();
  await expect(control).toHaveAttribute('data-closures', 'false');
  await expect
    .poll(async () => (await probeLayer(page, 'rc-world-closures', 'rc-world-closures-fill')).visibility)
    .toBe('none');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('coverage stipend: card with countdown and breakdown → payout → toast, ledger row, last payout', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { credits: 1000 });
  await goTo(page, 'Bilancio', true);
  await expect(page).toHaveURL(/\/game\/economy$/);
  const card = page.getByTestId('stipend-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('countdown').first()).toHaveText(/\d+:\d{2}/);
  await expect(card.getByTestId('stipend-row-base')).toHaveText('150');
  await expect(card.getByTestId('stipend-row-coverage')).toContainText('×');
  await expect(card.getByTestId('stipend-row-reputation')).toContainText(/× [01],\d{2}/);
  await expect(card.getByTestId('stipend-accrual-stop')).toContainText('smette di maturare');
  await expect(card.getByTestId('stipend-last')).toContainText('ancora nessuno');
  await expect(card.locator('[data-testid="stipend-family"][data-family="FIRE"]')).toContainText(
    'entro 12 min',
  );
  const net = (await card.getByTestId('stipend-net').innerText()).replace(/\D/g, '');
  expect(Number(net)).toBeGreaterThan(0);

  await qa(page, 'payStipend');
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Contributo di copertura accreditato' }),
  ).toBeVisible();
  await expect
    .poll(async () => Number((await page.getByTestId('credits').innerText()).replace(/\D/g, '')))
    .toBe(1000 + Number(net));
  await expect(card.getByTestId('stipend-last')).toContainText(`+${net}`);
  await expect(card.getByTestId('stipend-history')).toContainText('Accreditato');
  // The ledger (table on desktop, cards on mobile) lists the movement.
  await expect(page.getByText('Contributo di copertura', { exact: true }).last()).toBeVisible();

  // From the card to the coverage layer on the map.
  await card.getByTestId('stipend-open-coverage').click();
  await expect(page).toHaveURL(/\/game$/);
  await expect(page.getByTestId('map-layers')).toHaveAttribute('data-coverage', 'true');
});

test('progression: reputation gauge and milestones grouped by phase', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { credits: 2000 });
  await goTo(page, 'Carriera', true);
  await expect(page).toHaveURL(/\/game\/progression$/);

  // The exact value drifts while incidents come and go: the card must stay consistent with itself.
  const reputation = page.getByTestId('reputation-card');
  const value = Number((await reputation.getByTestId('reputation-value').innerText()).split('/')[0]!.trim());
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(100);
  await expect(reputation.getByTestId('reputation-band')).toHaveText(
    /^(Compromessa|Bassa|Discreta|Buona|Eccellente)$/,
  );
  await expect(reputation.getByRole('meter')).toHaveAttribute('aria-valuenow', /^\d+$/);
  await expect(reputation.getByTestId('reputation-multiplier')).toHaveText(/^× [01],\d{2,3}$/);
  await expect(reputation.getByTestId('career-rank')).toContainText('Grado:');

  const milestones = page.getByTestId('milestones-card');
  await expect(milestones.getByTestId('milestone-phase')).toHaveCount(3);
  const tutorial = milestones.locator('[data-testid="milestone"][data-code="TUTORIAL_COMPLETED"]');
  await expect(tutorial).toHaveAttribute('data-achieved', 'true');
  const firstVehicle = milestones.locator('[data-testid="milestone"][data-code="FIRST_VEHICLE_PURCHASED"]');
  await expect(firstVehicle).toHaveAttribute('data-achieved', 'false');
  await expect(firstVehicle).toContainText('0 di 1');
  await expect(firstVehicle.getByRole('progressbar')).toBeVisible();

  // Buying the first vehicle reaches the milestone: paid once, shown as achieved.
  await goTo(page, 'Acquisti');
  const before = Number((await page.getByTestId('credits').innerText()).replace(/\D/g, ''));
  await page
    .locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]')
    .getByTestId('buy-vehicle')
    .click();
  await expect
    .poll(async () => Number((await page.getByTestId('credits').innerText()).replace(/\D/g, '')))
    .toBeLessThan(before);
  await goTo(page, 'Carriera', true);
  await expect(firstVehicle).toHaveAttribute('data-achieved', 'true');
  await expect(firstVehicle).toContainText('Raggiunto il');
});
