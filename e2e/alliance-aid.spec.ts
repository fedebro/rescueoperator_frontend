import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Mutual aid, phase 2 (study 05, 09 §4.2): the requester asks from the incident inspector and sees the allied units
 * arrive; the helper gets the request card over the map, composes a column, sees the loan in the fleet, recalls it; a
 * column that comes back is settled with a toast; a request nobody can reach in time is shown as such. Simulated allies
 * act through the same mock rules (analisi/note-agenti/alleanze-backend.md).
 */
trackProblems();

type Ally = { careerId: string; directorName: string };
type Alliance = { id: string; tag: string; name: string };

/** A level-5 Director founds an alliance through the mock, Marta (on duty) joins. */
async function setupAlliance(
  page: Page,
  project: string,
  opts: { speed?: number } = {},
): Promise<{ alliance: Alliance; marta: Ally }> {
  await bootCareer(page, project, { level: 5, credits: 5000, speed: opts.speed });
  const suffix = `${Date.now()}`.slice(-2);
  const alliance = await qa<Alliance>(page, 'foundAlliance', {
    name: `Abruzzo Soccorso ${suffix}`,
    tag: `AB${suffix}`,
  });
  const marta = await qa<Ally>(page, 'simulateAlly', 'Marta', { level: 4, city: 'Chieti', onDuty: true });
  await qa(page, 'allyRequestJoin', marta.careerId, alliance.id);
  return { alliance, marta };
}

const openAidTab = async (page: Page) => {
  await goTo(page, 'Alleanza', true);
  await expect(page.getByRole('heading', { level: 1, name: 'Alleanza' })).toBeVisible();
  await page.getByTestId('alliance-tab-aid').click();
  await expect(page.getByTestId('alliance-aid')).toBeVisible();
};

const openIncident = async (page: Page, id: string) => {
  await page.locator(`[data-testid="incident-card"][data-incident-id="${id}"]`).click();
  const inspector = page.getByTestId('incident-inspector');
  await expect(inspector).toHaveAttribute('data-incident-id', id);
  return inspector;
};

test('requester: ask from the inspector, withdraw; ask again, Marta sends a column, the allied units arrive', async ({
  page,
}, info) => {
  const { alliance, marta } = await setupAlliance(page, info.project.name);
  await qa(page, 'allyAddVehicles', marta.careerId, 'FIRE_APS', 3);

  // A real gap (05 §2.1): the block names the alliance and asks; "Condivisa" appears; withdrawing puts it back.
  const first = await qa<string>(page, 'spawn', 'FIRE_DWELLING', 6);
  let inspector = await openIncident(page, first);
  const section = inspector.getByTestId('aid-incident-section');
  await expect(section).toBeVisible();
  await expect(section).toContainText(`[${alliance.tag}]`);
  await section.getByTestId('aid-request-button').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Richiesta inviata' })).toBeVisible();
  await expect(section.getByTestId('aid-withdraw')).toBeVisible();
  await expect(inspector.getByTestId('incident-shared')).toBeVisible();
  await section.getByTestId('aid-withdraw').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Richiesta ritirata' })).toBeVisible();
  await expect(section.getByTestId('aid-request-button')).toBeVisible();
  await expect(inspector.getByTestId('incident-shared')).toHaveCount(0);

  // A second call (the mock spaces requests by 60 game seconds: 5 real ones at the test speed).
  await page.waitForTimeout(6000);
  const second = await qa<string>(page, 'spawn', 'FIRE_DWELLING', 6);
  if (isMobile(page)) await page.getByTestId('inspector-close').click();
  inspector = await openIncident(page, second);
  await inspector.getByTestId('aid-request-button').click();
  await expect(inspector.getByTestId('aid-withdraw')).toBeVisible();
  const open = await qa<{ id: string; incident: { id: string } }[]>(page, 'aidRequests', 'OPEN');
  const request = open.find((r) => r.incident.id === second)!;
  expect(request).toBeTruthy();

  // Marta sends two engines: "Unità alleate" shows them coming, then on scene after the travel.
  await qa(page, 'allySendColumn', marta.careerId, request.id, 2);
  const units = inspector.getByTestId('allied-units');
  await expect(units).toContainText('Marta');
  const column = units.getByTestId('allied-column');
  await expect(column).toHaveAttribute('data-status', 'EN_ROUTE');
  // The travel (the shortest column takes 2 game minutes: 10 real seconds at the test speed; a bigger jump would also
  // bring the incident's own deadline due). The column lands and the engine counts it; Marta's column sits in Mutuo
  // soccorso as received.
  await qa(page, 'fastForward', 20);
  const all = await qa<{ id: string; status: string; columns: { status: string }[] }[]>(
    page,
    'aidRequests',
    'ALL',
  );
  const mineAfter = all.find((r) => r.id === request.id)!;
  expect(['ON_SCENE', 'RETURNING', 'RETURNED']).toContain(mineAfter.columns[0]!.status);
  await openAidTab(page);
  const received = page.locator('[data-testid="aid-column"][data-mine="false"]').first();
  await expect(received).toContainText('Marta');
});

test('helper: the request card over the map → compose and send → the loan in the fleet → recall; a returned column is settled', async ({
  page,
}, info) => {
  const { alliance, marta } = await setupAlliance(page, info.project.name);
  await qa(page, 'addVehicles', 'FIRE_APS', 3);
  await qa(page, 'staffAll');
  const luca = await qa<Ally>(page, 'simulateAlly', 'Luca', { level: 4, city: 'Teramo', onDuty: true });
  await qa(page, 'allyRequestJoin', luca.careerId, alliance.id);

  // Marta's incident shared with the alliance: the card sits over my map with what is missing.
  await qa(page, 'allyRequestAid', marta.careerId, 'FIRE_DWELLING', 6);
  const card = page.getByTestId('aid-map-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Marta');
  await expect(card.getByTestId('aid-gaps')).toBeVisible();
  await card.getByTestId('aid-send').click();
  const composer = page.getByTestId('column-composer');
  await expect(composer).toBeVisible();
  const checks = composer.getByTestId('column-vehicle-check');
  await expect(checks.first()).toBeVisible();
  await checks.nth(0).click();
  await checks.nth(1).click();
  await expect(composer.getByTestId('column-summary')).toBeVisible();
  await page.getByTestId('column-send').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Colonna partita' })).toBeVisible();
  await expect(card).toHaveCount(0);

  // The fleet shows the loan: "a [TAG] Marta".
  await page.goto('/game/fleet');
  const loan = page.getByTestId('allied-support-line').first();
  await expect(loan).toBeVisible();
  await expect(loan).toContainText(`[${alliance.tag}]`);
  await expect(loan).toContainText('Marta');

  // Mutuo soccorso: my column in flight, Richiama.
  await openAidTab(page);
  const mine = page.locator('[data-testid="aid-column"][data-mine="true"]').first();
  await expect(mine).toHaveAttribute('data-status', 'EN_ROUTE');
  await expect(mine).toContainText('Marta');
  await mine.getByTestId('column-recall').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Colonna richiamata' })).toBeVisible();
  await expect(mine).toHaveAttribute('data-status', /RECALLED|RETURNING|RETURNED/);

  // Luca's request: a column that arrives, stays until the incident ends and comes back → the settlement toast.
  await qa(page, 'fastForward', 600);
  const lucas = await qa<{ id: string; incident: { id: string } }>(
    page,
    'allyRequestAid',
    luca.careerId,
    'FIRE_DWELLING',
    6,
  );
  const request = page.getByTestId('aid-request').filter({ hasText: 'Luca' });
  await expect(request).toBeVisible();
  await request.getByTestId('aid-send').click();
  await expect(composer).toBeVisible();
  await composer.getByTestId('column-vehicle-check').first().click();
  await page.getByTestId('column-send').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Colonna partita' })).toBeVisible();
  await qa(page, 'fastForward', 20);
  await expect(page.getByTestId('toast').filter({ hasText: 'sul posto da Luca' })).toBeVisible();
  await page.waitForTimeout(1500);
  await qa(page, 'allyCloseIncident', luca.careerId, lucas.incident.id);
  const settled = page.getByTestId('toast').filter({ hasText: 'Colonna rientrata' });
  for (let i = 0; i < 4 && !(await settled.isVisible().catch(() => false)); i += 1) {
    await qa(page, 'fastForward', 600);
    await page.waitForTimeout(300);
  }
  await expect(settled).toBeVisible();
  await expect(
    page.locator('[data-testid="aid-column"][data-mine="true"]').first().getByTestId('column-reward'),
  ).toHaveAttribute('data-reward', /PAID|NONE|CAPPED|UNDER_REVIEW/);
});

test('too late: a request nobody can reach before its deadline is shown as such and never over the map', async ({
  page,
}, info) => {
  // Real-time clock (speed 1): a 100-second deadline stays observable; the shortest column takes 2 minutes.
  const { marta } = await setupAlliance(page, info.project.name, { speed: 1 });
  await qa(page, 'addVehicles', 'FIRE_APS', 2);
  await qa(page, 'staffAll');
  await qa(page, 'allyRequestAid', marta.careerId, 'FIRE_DWELLING', 6, { expiresInSeconds: 100 });
  await openAidTab(page);
  const request = page.getByTestId('aid-request').first();
  await expect(request).toHaveAttribute('data-status', 'OPEN');
  await expect(request.getByTestId('aid-blocked')).toHaveAttribute('data-reason', 'TOO_LATE');
  await expect(request.getByTestId('aid-blocked')).toContainText('in tempo');
  await expect(request.getByTestId('aid-send')).toHaveCount(0);
  await page.goto('/game');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('aid-map-card')).toHaveCount(0);
});
