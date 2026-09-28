import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, hideDevToolsBadge, qa, trackProblems } from './helpers';

/**
 * Major incidents ("maxi-emergenze", D-24 [U] / D-69 [C]) on both layouts: the full-screen alert over any page, the
 * coordination view (phases, needs by service, sectors), the event area on the map, the pinned queue block and the strip,
 * the reinforcements (blocked → quote → request → column), one dispatch of more than 12 vehicles (24 on a major, 12
 * elsewhere), the end with its bonus, the ledger line and the medal. The mock (src/mocks/domains/major.ts) follows the
 * backend rules; `startMajor` starts one deterministically (the organic generator never fires within a test).
 */
trackProblems();

interface Started {
  majorId: string;
  mainIncidentId: string;
  incidentIds: string[];
}
interface MockCareer {
  vehicles: { id: string; status: string; incidentId: string | null }[];
}
interface MapFeature {
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

const career = (page: Page) => qa<MockCareer>(page, 'career');

/** The features of a map source (the map is WebGL: its data is read from the source itself). */
const sourceFeatures = (page: Page, source: string) =>
  page.evaluate(
    (id) =>
      ((
        window as unknown as {
          __rcMap: {
            getSource: (s: string) => { serialize: () => { data: { features: unknown[] } } } | undefined;
          };
        }
      ).__rcMap
        .getSource(id)
        ?.serialize().data.features ?? []) as MapFeature[],
    source,
  );

/** Ticks the first `count` enabled vehicles of the dispatch list (read once; each tap scrolls its row into view). */
async function tickVehicles(page: Page, count: number) {
  const boxes = page.getByTestId('dispatch-option').getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();
  const enabled = await boxes.evaluateAll((list) =>
    list.flatMap((box, index) => ((box as HTMLButtonElement).disabled ? [] : [index])),
  );
  expect(enabled.length).toBeGreaterThanOrEqual(count);
  for (const index of enabled.slice(0, count)) await boxes.nth(index).click();
}

test.beforeEach(async ({ page }) => {
  await hideDevToolsBadge(page);
  // The end of a major closes several incidents at once: their reports come one after the other in the same dialog.
  // The handler acknowledges one (a plain DOM click: no waiting for the sliding dialog to settle) and does not wait for
  // the dialog to go — it simply runs again for the next report.
  await page.addLocatorHandler(
    page.getByTestId('outcome-modal'),
    async () => {
      await page
        .getByTestId('outcome-continue')
        .dispatchEvent('click')
        .catch(() => undefined);
    },
    { noWaitAfter: true },
  );
  // Level 9 opens the EMS and Police services: their celebrations are not what these tests are about.
  await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
    await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
  });
});

/** Majors open at level 5; a silent world, so the major is the only thing happening. */
async function boot(page: Page, project: string) {
  await bootCareer(page, project, { level: 9, credits: 20_000 });
  await qa(page, 'quiet');
}

test('a major: the alert over any page, the coordination view, the event area, the pinned queue, the strip', async ({
  page,
}, info) => {
  await boot(page, info.project.name);
  await goTo(page, 'Flotta');
  await expect(page).toHaveURL(/\/game\/fleet$/);
  const started = await qa<Started>(page, 'startMajor', 'MAJ_HIGHWAY_PILEUP', { targetVehicles: 14 });
  expect(started.incidentIds.length).toBeGreaterThanOrEqual(2);
  // At ×12 the event moves on within seconds (next phase, more linked incidents): the checks below hold in any phase.
  const [linked] = started.incidentIds.filter((id) => id !== started.mainIncidentId);
  const PHASE = /^(ALARM|CONTAINMENT|RESCUE|SECURING)$/;

  await test.step('the full-screen alert, over the fleet page', async () => {
    const alert = page.getByTestId('major-alert');
    await expect(alert).toBeVisible();
    await expect(page.getByTestId('major-alert-title')).toContainText(
      'MAXI-EMERGENZA — Tamponamento a catena',
    );
    await expect(alert).toContainText('Dimensionata sulla tua flotta: circa 14 mezzi');
    const open = page.getByTestId('major-alert-open');
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByTestId('major-alert-close').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open.click();
    await expect(alert).toHaveCount(0);
  });

  await test.step('the coordination view: phase, needs by service, sectors, bonus', async () => {
    await expect(page).toHaveURL(/\/game$/);
    const view = page.getByTestId('major-inspector');
    await expect(view).toHaveAttribute('data-major-id', started.majorId);
    await expect(view).toHaveAttribute('data-phase', PHASE);
    // The stepper highlights exactly one phase: the current one.
    await expect(view.locator('[data-testid="major-phases"] [aria-current="step"]')).toHaveCount(1);
    await expect(view.locator('[data-testid="major-phases"] [aria-current="step"]')).toHaveAttribute(
      'data-phase',
      PHASE,
    );
    // Grouped by service: one row per family, never one row per capability.
    const families = await view
      .getByTestId('major-group')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-family')));
    expect(families.length).toBeGreaterThanOrEqual(2);
    expect(new Set(families).size).toBe(families.length);
    // A sector per member: the main scene and the linked incident reported with the alarm (more may follow).
    await expect(view.locator('[data-testid="major-sector"][data-role="MAIN"]')).toHaveAttribute(
      'data-incident-id',
      started.mainIncidentId,
    );
    await expect(view.locator(`[data-testid="major-sector"][data-incident-id="${linked}"]`)).toHaveAttribute(
      'data-role',
      'SUB',
    );
    await expect(view.getByTestId('major-reward-estimate')).toBeVisible();
    await expect(view.getByTestId('major-reinforcements')).toBeVisible();
  });

  await test.step('the map: the event area, a line to each linked incident, the main scene marked', async () => {
    await expect
      .poll(async () => (await sourceFeatures(page, 'rc-major')).filter((f) => f.geometry.type === 'Polygon'))
      .toHaveLength(1);
    const links = (await sourceFeatures(page, 'rc-major')).filter((f) => f.geometry.type === 'LineString');
    expect(links.map((f) => f.properties.incidentId)).toContain(linked);
    expect(links.map((f) => f.properties.incidentId)).not.toContain(started.mainIncidentId);
    const centres = await sourceFeatures(page, 'rc-major-centre');
    expect(centres).toHaveLength(1);
    expect(centres[0]!.properties).toMatchObject({ kind: 'major', id: started.majorId });
    const pins = await sourceFeatures(page, 'rc-incidents');
    expect(String(pins.find((f) => f.properties.id === started.mainIncidentId)?.properties.image)).toMatch(
      /:M$/,
    );
    expect(String(pins.find((f) => f.properties.id === linked)?.properties.image)).toMatch(/:L$/);
  });

  await test.step('the queue: the major pinned on top, the main scene first', async () => {
    await page.getByTestId('inspector-close').click();
    const block = page.getByTestId('major-queue-block');
    await expect(block).toBeVisible();
    await expect(block.getByTestId('major-queue-header')).toHaveAttribute('data-phase', PHASE);
    await expect(block.locator(`[data-testid="incident-card"][data-incident-id="${linked}"]`)).toBeVisible();
    await expect(block.getByTestId('incident-card').first()).toHaveAttribute(
      'data-incident-id',
      started.mainIncidentId,
    );
    await expect(block.getByTestId('major-member-badge').first()).toHaveAttribute('data-role', 'MAIN');
    await block.getByTestId('major-queue-header').click();
    await expect(page.getByTestId('major-inspector')).toHaveAttribute('data-major-id', started.majorId);
  });

  await test.step('acknowledged: no alert after a reload; the strip on any other page opens the view', async () => {
    await page.goto('/game/fleet');
    const strip = page.getByTestId('major-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('data-major-id', started.majorId);
    await expect(page.getByTestId('major-alert')).toHaveCount(0);
    await strip.click();
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.getByTestId('major-inspector')).toHaveAttribute('data-major-id', started.majorId);
  });
});

test('reinforcements: blocked until a vehicle of yours is on it, then the quote, the request, the column', async ({
  page,
}, info) => {
  await boot(page, info.project.name);
  const started = await qa<Started>(page, 'startMajor', 'MAJ_HIGHWAY_PILEUP', { targetVehicles: 16 });
  await page.getByTestId('major-alert-open').click();
  const view = page.getByTestId('major-inspector');
  const section = view.getByTestId('major-reinforcements');

  await test.step('nothing of yours on the event yet: blocked, and why', async () => {
    await expect(section).toHaveAttribute('data-blocked', 'NO_OWN_UNIT');
    await expect(section.getByTestId('major-reinforcements-blocked')).toContainText(
      'Invia almeno un tuo mezzo',
    );
    await expect(section.getByTestId('major-request-reinforcements')).toBeDisabled();
  });

  await test.step('vehicles to the main scene from its sector, then back to the coordination view', async () => {
    await view
      .locator('[data-testid="major-sector"][data-role="MAIN"]')
      .getByRole('button', { name: /^Apri / })
      .click();
    const inspector = page.getByTestId('incident-inspector');
    await expect(inspector).toHaveAttribute('data-incident-id', started.mainIncidentId);
    await page.getByTestId('send-recommended').click();
    await expect(inspector.getByTestId('assigned-vehicle').first()).toBeVisible();
    await inspector.getByTestId('major-member-banner').click();
    await expect(page.getByTestId('major-inspector')).toHaveAttribute('data-major-id', started.majorId);
  });

  await test.step('the quote: what a column covers, what it costs on the bonus; the request', async () => {
    await expect(section).toHaveAttribute('data-available', 'true');
    await expect(section.getByTestId('major-quote')).toBeVisible();
    // Its price, said before asking: the share of the bonus it takes once on scene.
    await expect(section.getByTestId('major-quote-cost')).toHaveText(/^−\d+%$/);
    await section.getByTestId('major-request-reinforcements').click();
    // The "Rinforzi richiesti" confirmation toast is asserted by the unit test (major-ui.test.tsx). Here it is transient:
    // on a live major a burst of realtime toasts (linked calls, arrivals) can push it out of the four-card stack before
    // it is looked at, so the e2e checks the durable state the request leaves instead: the column on its way.
    const column = section.getByTestId('major-column');
    await expect(column).toHaveAttribute('data-status', 'EN_ROUTE');
    await expect(column).toContainText('Rinforzi in arrivo');
    await expect(column).toContainText(/\d+% delle necessità/);
    // One column at a time.
    await expect(section).toHaveAttribute('data-blocked', 'ALREADY_EN_ROUTE');
    await expect(section.getByTestId('major-request-reinforcements')).toBeDisabled();
  });
});

test('one dispatch command: 12 vehicles at most, 24 on a major', async ({ page }, info) => {
  // 25 taps in a scrolling list: generous on a loaded machine.
  test.setTimeout(180_000);
  await boot(page, info.project.name);
  await qa(page, 'addVehicles', 'FIRE_APS', 14);
  await qa(page, 'staffAll');

  await test.step('an ordinary call: after 12, no other vehicle can be ticked', async () => {
    const id = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 1);
    await page.locator(`[data-testid="incident-card"][data-incident-id="${id}"]`).click();
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', id);
    await tickVehicles(page, 12);
    const cap = page.getByTestId('dispatch-cap');
    await expect(cap).toHaveAttribute('data-cap', '12');
    await expect(cap).toHaveAttribute('data-reached', 'true');
    await expect(
      page.getByTestId('dispatch-option').getByRole('checkbox', { checked: false }).first(),
    ).toBeDisabled();
    await page.getByTestId('inspector-close').click();
  });

  await test.step('the main scene of a major: 13 vehicles in one command', async () => {
    const started = await qa<Started>(page, 'startMajor', 'MAJ_RESIDENTIAL_FIRE', { targetVehicles: 18 });
    await page.getByTestId('major-alert-close').click();
    await page.locator(`[data-testid="incident-card"][data-incident-id="${started.mainIncidentId}"]`).click();
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute(
      'data-incident-id',
      started.mainIncidentId,
    );
    const cap = page.getByTestId('dispatch-cap');
    await expect(cap).toHaveAttribute('data-cap', '24');
    await tickVehicles(page, 13);
    await expect(cap).toHaveAttribute('data-reached', 'false');
    await expect(page.getByTestId('send-selected')).toContainText('13');
    await page.getByTestId('send-selected').click();
    await expect
      .poll(
        async () =>
          (await career(page)).vehicles.filter((v) => v.incidentId === started.mainIncidentId).length,
      )
      .toBe(13);
  });
});

test('the end: the bonus toast and the summary, the ledger line, the medal on the career page', async ({
  page,
}, info) => {
  await boot(page, info.project.name);
  await qa<Started>(page, 'startMajor', 'MAJ_RESIDENTIAL_FIRE', { targetVehicles: 12 });
  await page.getByTestId('major-alert-close').click();
  await qa(page, 'finishMajor');

  await test.step('the toast sums up the bonus; "Riepilogo" opens the summary', async () => {
    const toast = page.getByTestId('toast').filter({ hasText: 'Maxi-emergenza risolta' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Bonus di');
    await toast.getByTestId('toast-action').click();
    const view = page.getByTestId('major-inspector');
    await expect(view).toHaveAttribute('data-status', 'ENDED');
    await expect(view.getByTestId('major-outcome')).toHaveAttribute('data-outcome', 'SUCCESS');
    await expect(view.getByTestId('major-medal')).toBeVisible();
    await expect(view.getByTestId('major-reinforcements')).toHaveCount(0);
  });

  await test.step('the ledger: a MAJOR_INCIDENT line naming the major', async () => {
    await page.goto('/game/economy');
    await expect(page.getByRole('heading', { name: 'Bilancio', level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator('[data-testid="ledger-description"][data-entry-type="MAJOR_INCIDENT"]').first(),
    ).toContainText('Incendio in un complesso residenziale');
  });

  await test.step('the career page: the medal of the scenario and the last majors', async () => {
    await page.goto('/game/progression');
    const trophies = page.getByTestId('major-trophies');
    await expect(trophies).toBeVisible({ timeout: 60_000 });
    await expect(
      trophies.locator('[data-testid="major-trophy"][data-scenario="MAJ_RESIDENTIAL_FIRE"]'),
    ).toHaveAttribute('data-medal', /GOLD|SILVER/);
    await expect(trophies.getByTestId('major-history-row').first()).toHaveAttribute('data-status', 'ENDED');
  });
});
