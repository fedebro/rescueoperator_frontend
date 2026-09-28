import { expect, test, type Page } from '@playwright/test';
import { bootCareer, isMobile, qa, trackProblems } from './helpers';

/**
 * Vehicle autonomy (D-22 [U] "Autonomia + carburante", D-67 [C]) on both layouts: gauges in the vehicle inspector after a
 * real mission, the vehicle ready at once when it still has autonomy (with its coaching line), the reserve and the
 * dispatch flags, the manual "Rientra a rifornire", the fuel-station premium in the ledger and the gradual unlock.
 * States that take many missions to reach are set with the mock QA helpers (`setAutonomy`, `spawnAway`).
 */
trackProblems();

interface MockCareer {
  vehicles: { id: string; status: string }[];
  stats: { resolved: number };
}
const firstVehicle = async (page: Page) => (await qa<MockCareer>(page, 'career')).vehicles[0]!;

/** Lets the simulation run (fast-forwarded) until `done` holds. */
async function runUntil(page: Page, done: (career: MockCareer) => boolean, timeout = 60_000) {
  await expect
    .poll(
      async () => {
        await qa(page, 'fastForward', 20);
        return done(await qa<MockCareer>(page, 'career'));
      },
      { timeout, intervals: [400] },
    )
    .toBe(true);
}

async function openIncident(page: Page, incidentId: string) {
  await page.goto('/game');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
}

/** Fleet page → the vehicle → its inspector on the operations screen (sheet on phones, right column on desktop). */
async function openVehicleInspector(page: Page) {
  await page.goto('/game/fleet');
  await expect(page.getByRole('heading', { name: 'Flotta', level: 1 })).toBeVisible({ timeout: 60_000 });
  if (isMobile(page)) await page.getByTestId('vehicle-card').first().click();
  else await page.getByRole('row').filter({ hasText: 'APS 1' }).first().click();
  const inspector = page.getByTestId('vehicle-inspector');
  await expect(inspector).toBeVisible();
  return inspector;
}

test.beforeEach(async ({ page }) => {
  // The mission outcome is paid when the on-scene work ends: dismiss it whenever it shows.
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  // Level 3 also opens the EMS service: its celebration is not what these tests are about.
  await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
    await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
  });
});

test('after a mission the vehicle is ready at once, with its fuel and onboard stock gauges', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 5000 });
  await qa(page, 'quiet');
  const incidentId = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 1);

  await test.step('dispatch and let the mission run', async () => {
    await openIncident(page, incidentId);
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('assigned-vehicle').first()).toBeVisible();
    await runUntil(page, (c) => c.stats.resolved >= 1 && c.vehicles[0]!.status === 'AVAILABLE');
  });

  await test.step('it still had autonomy: no stop, and the coaching line says so once', async () => {
    await expect(page.getByTestId('toast').filter({ hasText: 'Aveva ancora autonomia' })).toBeVisible();
    expect((await firstVehicle(page)).status).toBe('AVAILABLE');
  });

  await test.step('the inspector shows the missions left and the two gauges', async () => {
    const inspector = await openVehicleInspector(page);
    await expect(inspector).toHaveAttribute('data-vehicle-status', 'AVAILABLE');
    const section = inspector.getByTestId('vehicle-autonomy');
    await expect(section.getByTestId('missions-left')).toContainText('Autonomia: circa');
    const fuel = section.getByTestId('fuel-gauge');
    await expect(fuel).toBeVisible();
    // Fuel burnt on the way there (sirens), on scene (pump) and back: below a full tank, well above the reserve.
    const ratio = Number(await fuel.getAttribute('data-ratio'));
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeGreaterThan(0.5);
    await expect(fuel).toHaveAttribute('data-tone', 'ok');
    await section.getByTestId('stock-toggle').click();
    await expect(section.getByTestId('stock-item')).toHaveCount(3);
    await expect(section.locator('[data-testid="stock-item"][data-item="FOAM"]')).toBeVisible();
  });
});

test('reserve and dispatch flags: reload before leaving, last mission, out of range', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 5000 });
  await qa(page, 'quiet');

  await test.step('a vehicle in reserve: danger chip, "Da rifornire" filter, reserve tag', async () => {
    await qa(page, 'setAutonomy', null, { fuel: 0.1 });
    await page.goto('/game/fleet');
    await expect(page.getByRole('heading', { name: 'Flotta', level: 1 })).toBeVisible({ timeout: 60_000 });
    const filter = page.getByTestId('fleet-filter-resupply');
    await expect(filter).toHaveAttribute('data-count', '1');
    await filter.click();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('autonomy-chip').first()).toHaveAttribute('data-tone', 'danger');
    const inspector = await openVehicleInspector(page);
    await expect(inspector.getByTestId('fuel-gauge')).toContainText('Riserva');
  });

  await test.step('in reserve at base it reloads before leaving: a note, and still the recommended vehicle', async () => {
    const incidentId = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 1);
    await openIncident(page, incidentId);
    const option = page.getByTestId('dispatch-option').first();
    await expect(option.getByTestId('dispatch-reload-note')).toContainText('Rifornisce prima di partire');
    await expect(option).toContainText('Consigliato');
    await expect(page.getByTestId('send-recommended')).toBeEnabled();
    await page.getByTestId('inspector-close').click();
    await qa(page, 'quiet');
  });

  await test.step('enough stock for one more fire only: "Ultima missione prima del rifornimento"', async () => {
    await qa(page, 'setAutonomy', null, { fuel: 1, stock: { FOAM: 20 } });
    const incidentId = await qa<string>(page, 'spawn', 'FIRE_VEHICLE', 3);
    await openIncident(page, incidentId);
    const flag = page.getByTestId('dispatch-option').first().getByTestId('dispatch-autonomy-flag');
    await expect(flag).toHaveAttribute('data-flag', 'LAST_MISSION_BEFORE_RESUPPLY');
    await expect(flag).toContainText('Ultima missione prima del rifornimento');
    await page.getByTestId('inspector-close').click();
    await qa(page, 'quiet');
  });

  await test.step('too far even with a full tank: flagged, never recommended, still selectable', async () => {
    await qa(page, 'setAutonomy', null, { stock: { FOAM: 45 } });
    const incidentId = await qa<string>(page, 'spawnAway', 'FIRE_TRASH_BIN', 1, 70);
    await openIncident(page, incidentId);
    const option = page.getByTestId('dispatch-option').first();
    await expect(option.getByTestId('dispatch-autonomy-flag')).toHaveAttribute(
      'data-flag',
      'FUEL_RANGE_INSUFFICIENT',
    );
    await expect(option.getByTestId('dispatch-autonomy-flag')).toContainText('Autonomia insufficiente');
    await expect(option).not.toContainText('Consigliato');
    await expect(page.getByTestId('send-recommended')).toBeDisabled();
    await expect(option.getByRole('checkbox')).toBeEnabled();
  });
});

test('manual "Rientra a rifornire": the stop, its countdown, then a full vehicle', async ({ page }, info) => {
  // Real-time mock clock: at ×12 a stop of ~40 game seconds lasts ~3 s, less than a page load on a busy machine.
  await bootCareer(page, info.project.name, { level: 3, credits: 5000, speed: 1 });
  await qa(page, 'quiet');
  await qa(page, 'setAutonomy', null, { fuel: 0.6, stock: { FOAM: 30 } });
  const inspector = await openVehicleInspector(page);

  await test.step('the action starts the stop at once', async () => {
    await inspector.getByTestId('return-to-resupply').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'APS 1: rifornimento avviato' })).toBeVisible();
    await expect(inspector).toHaveAttribute('data-vehicle-status', 'RESTOCKING');
    await expect(inspector.getByTestId('restocking')).toContainText('Rifornimento in corso');
    await expect(inspector.getByTestId('restocking').getByTestId('countdown')).toBeVisible();
    await expect(inspector.getByTestId('return-to-resupply')).toHaveCount(0);
  });

  await test.step('the fleet shows the stop with its countdown', async () => {
    await page.goto('/game/fleet');
    await expect(page.getByRole('heading', { name: 'Flotta', level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-status="RESTOCKING"]').first()).toBeVisible();
  });

  await test.step('then it is full and ready again', async () => {
    await runUntil(page, (c) => c.vehicles[0]!.status === 'AVAILABLE');
    const after = await openVehicleInspector(page);
    await expect(after.getByTestId('fuel-gauge')).toHaveAttribute('data-ratio', '1');
    await expect(after.getByTestId('missions-left')).toContainText('Autonomia piena');
    await expect(after.getByTestId('return-to-resupply')).toHaveCount(0);
  });
});

test('a far mission in reserve refuels at a filling station on the way: the premium is in the ledger', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 5000 });
  await qa(page, 'quiet');
  await qa(page, 'setAutonomy', null, { fuel: 0.45 });
  const incidentId = await qa<string>(page, 'spawnAway', 'FIRE_TRASH_BIN', 1, 13);
  await openIncident(page, incidentId);
  await page.getByTestId('send-recommended').click();
  await expect(page.getByTestId('assigned-vehicle').first()).toBeVisible();
  await runUntil(page, (c) => c.stats.resolved >= 1 && c.vehicles[0]!.status === 'AVAILABLE', 90_000);

  await page.goto('/game/economy');
  await expect(page.getByRole('heading', { name: 'Bilancio', level: 1 })).toBeVisible({ timeout: 60_000 });
  const row = page.locator('[data-testid="ledger-description"][data-entry-type="FUEL"]').first();
  await expect(row).toContainText('Carburante al distributore');
  await expect(row).toContainText(/APS 1 · \d+ km riforniti/);
});

test('gradual unlock: nothing at level 1, onboard stock at level 2, fuel from level 3', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 1 });
  await qa(page, 'quiet');
  let inspector = await openVehicleInspector(page);
  await expect(inspector.getByTestId('vehicle-autonomy')).toHaveCount(0);
  await page.goto('/game/fleet');
  await expect(page.getByRole('heading', { name: 'Flotta', level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('fleet-filter-resupply')).toHaveCount(0);

  await qa(page, 'setLevel', 2);
  inspector = await openVehicleInspector(page);
  const section = inspector.getByTestId('vehicle-autonomy');
  await expect(section.getByTestId('stock-gauge')).toBeVisible();
  await expect(section.getByTestId('fuel-gauge')).toHaveCount(0);
  // The explanation card of the onboard stock, once.
  await expect(section.getByTestId('autonomy-explain')).toHaveAttribute('data-kind', 'stock');
  await section.getByTestId('autonomy-explain-dismiss').click();
  await expect(section.getByTestId('autonomy-explain')).toHaveCount(0);

  await qa(page, 'setLevel', 3);
  inspector = await openVehicleInspector(page);
  await expect(inspector.getByTestId('fuel-gauge')).toBeVisible();
  await expect(inspector.getByTestId('autonomy-explain')).toHaveAttribute('data-kind', 'fuel');
});
