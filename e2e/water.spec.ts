import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, hideDevToolsBadge, qa, trackProblems } from './helpers';

/**
 * Water operations (D-23 [U] "solo Base nautica", D-68 [C]) on both layouts:
 *  - a water incident's marker stands on the water, its meeting point on the shore road, linked by a dashed line;
 *  - without a boat the Coast Guard covers the water part (reduced reward) and the panel links to a Base nautica;
 *  - a Base nautica is bought on a nautical site (highlighted on the map), then a boat into it;
 *  - a boat leaves from its berth on a dashed water route, a trailer leg shows its launch point;
 *  - a refused purchase says why and links where the fix is; a boat left at a fire station moves for free.
 * The mock (src/mocks/domains/water.ts) follows the backend rules; QA helpers set up the slow parts.
 */
trackProblems();

interface MockIncident {
  id: string;
  position: [number, number];
  scenePosition: [number, number];
  meetingPoint: [number, number] | null;
}
interface MockCareer {
  incidents: MockIncident[];
  vehicles: {
    id: string;
    status: string;
    facilityId: string;
    typeCode: string;
    position: [number, number];
  }[];
  facilities: {
    id: string;
    typeCode: string;
    capacities: { domain: string; total: number; used: number }[];
  }[];
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
        ?.serialize().data.features ?? []) as {
        geometry: { type: string; coordinates: unknown };
        properties: Record<string, unknown>;
      }[],
    source,
  );

async function openIncident(page: Page, incidentId: string) {
  await page.goto('/game');
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
}

test.beforeEach(async ({ page }) => {
  await hideDevToolsBadge(page);
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  // Level 9 opens the EMS and Police services: their celebrations are not what these tests are about.
  await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
    await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
  });
});

test('a water incident: marker at sea, meeting point on the road, the Coast Guard when there is no boat', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 9, credits: 60_000 });
  await qa(page, 'quiet');
  const incidentId = await qa<string>(page, 'spawnWater', 'MED_SWIMMER_DISTRESS', { severity: 3 });
  const incident = (await career(page)).incidents.find((i) => i.id === incidentId)!;
  expect(incident.meetingPoint).toEqual(incident.position);
  expect(incident.scenePosition).not.toEqual(incident.position);

  await test.step('the map: the marker on the water with the anchor, the meeting point linked by a dashed line', async () => {
    await openIncident(page, incidentId);
    await expect
      .poll(async () =>
        (await sourceFeatures(page, 'rc-incidents')).find((f) => f.properties.id === incidentId),
      )
      .toBeTruthy();
    const marker = (await sourceFeatures(page, 'rc-incidents')).find((f) => f.properties.id === incidentId)!;
    expect(marker.geometry.coordinates).toEqual(incident.scenePosition);
    expect(String(marker.properties.image)).toMatch(/:W$/);
    const water = await sourceFeatures(page, 'rc-water');
    const link = water.find(
      (f) => f.geometry.type === 'LineString' && f.properties.incidentId === incidentId,
    )!;
    expect(link.geometry.coordinates).toEqual([incident.scenePosition, incident.position]);
    const meeting = water.find((f) => f.geometry.type === 'Point' && f.properties.id === incidentId)!;
    expect(meeting.geometry.coordinates).toEqual(incident.position);
    // the meeting point is part of the incident: tapping it selects the incident too
    expect(meeting.properties.kind).toBe('incident');
  });

  await test.step('the panel: "al largo di", the water badge, requirements in the water and on the shore', async () => {
    const inspector = page.getByTestId('incident-inspector');
    // the inspector's own header (the requirement groups have headers too)
    await expect(inspector.locator('header').first()).toContainText('Al largo di');
    await expect(inspector.getByTestId('water-badge').first()).toHaveAttribute('data-water-body', 'SEA');
    await expect(inspector.getByTestId('water-badge').first()).toContainText('In mare');
    await inspector.getByRole('tab', { name: 'Dettagli' }).click();
    // (the dispatch tab stays mounted: look inside the details panel only)
    const details = inspector.getByRole('tabpanel', { name: 'Dettagli' });
    await expect(details.getByTestId('requirement-side')).toHaveCount(2);
    await expect(details.locator('[data-testid="requirement-side"][data-side="WATER"]')).toContainText(
      'In acqua',
    );
    await expect(details.locator('[data-testid="requirement-side"][data-side="SHORE"]')).toContainText(
      'A terra',
    );
    await expect(
      details.locator('[data-testid="requirement-coast-guard"][data-capability="WATER_RESCUE"]'),
    ).toContainText('Guardia Costiera');
    await inspector.getByRole('tab', { name: 'Mezzi' }).click();
  });

  await test.step('no boat: the Coast Guard covers the water part, reduced reward, a direct link to a Base nautica', async () => {
    const notice = page.getByTestId('water-notice');
    await expect(notice).toHaveAttribute('data-state', 'COAST_GUARD');
    await expect(notice.getByTestId('coast-guard-notice')).toContainText(
      'Serve un mezzo acquatico — interviene la Guardia Costiera',
    );
    await expect(notice.getByTestId('coast-guard-reward')).toContainText('60%');
    // land units go to the meeting point: the fire engine brings some basic care there
    const option = page.getByTestId('dispatch-option').first();
    await expect(option.getByTestId('dispatch-water-route')).toHaveAttribute(
      'data-destination',
      'MEETING_POINT',
    );
    await expect(option.getByTestId('dispatch-water-route')).toContainText('Al punto di raccolta');
    await notice.getByTestId('water-buy-base').click();
    await expect(page).toHaveURL(/\/game\/facilities\?new=NAUTICAL/);
    await expect(page.locator('[data-testid="site-filter"][data-filter="NAUTICAL"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-testid="site-row"][data-nautical="true"]')).toHaveCount(3);
  });
});

test('buy a Base nautica on a nautical site, a boat into it; a refused purchase links to the fix', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await bootCareer(page, info.project.name, { level: 9, credits: 60_000 });
  await qa(page, 'quiet');

  await test.step('shop, water tab: where boats live, and "a Base nautica is needed" with its link', async () => {
    await goTo(page, 'Acquisti');
    await page.getByTestId('domain-filter-WATER').click();
    const home = page.getByTestId('boat-home');
    await expect(home).toHaveAttribute('data-bases', '0');
    await expect(home).toContainText('Le barche si tengono solo in una Base nautica');
    const boat = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_BOAT"]');
    await expect(boat.getByTestId('blocked-reason')).toHaveAttribute('data-reason', 'NO_FACILITY');
    await expect(boat.getByTestId('blocked-reason')).toContainText('Serve una Base nautica');
    await boat.getByTestId('blocked-fix').click();
    await expect(page).toHaveURL(/\/game\/facilities\?new=NAUTICAL/);
  });

  let baseName = '';
  await test.step('the nautical sites: conditions, then the map with the nautical sites highlighted', async () => {
    const row = page
      .locator('[data-testid="site-row"][data-nautical="true"]')
      .filter({ hasText: 'Marina di Pescara' });
    await row.click();
    const dialog = page.getByTestId('site-dialog');
    const conditions = dialog.getByTestId('nautical-conditions');
    await expect(conditions).toContainText('7000');
    await expect(conditions).toContainText('Dal livello 6');
    await expect(conditions).toContainText('2 posti barca');
    await expect(dialog.getByTestId('nautical-site-badge')).toContainText('Mare Adriatico');
    await dialog.getByRole('button', { name: 'Mostra sulla mappa' }).click();
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('new-facility-banner')).toContainText('Siti nautici');
    await expect
      .poll(async () => (await sourceFeatures(page, 'rc-sites')).map((f) => String(f.properties.image)))
      .toContain('site:1:N');
    const inspector = page.getByTestId('site-inspector');
    baseName = (await inspector.getByTestId('inspector-title').textContent()) ?? '';
    expect(baseName).toContain('Base nautica');
    const option = inspector.locator('[data-testid="site-option"][data-type="NAUTICAL_BASE"]');
    await expect(option).toHaveAttribute('data-available', 'true');
    await option.getByTestId('acquire-facility').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'sede acquisita' })).toBeVisible();
    await expect(page.getByTestId('facility-inspector')).toHaveAttribute(
      'data-facility-status',
      'UNDER_CONSTRUCTION',
    );
    await qa(page, 'fastForward', 600);
    await expect(page.getByTestId('facility-inspector')).toHaveAttribute(
      'data-facility-status',
      'OPERATIONAL',
    );
    await expect(page.getByTestId('facility-inspector').getByTestId('nautical-facility')).toContainText(
      'Mare Adriatico',
    );
  });

  await test.step('a boat into the Base nautica', async () => {
    await page.goto('/game/shop?domain=WATER');
    const home = page.getByTestId('boat-home');
    await expect(home).toHaveAttribute('data-bases', '1');
    await expect(home.getByTestId('boat-home-base')).toHaveAttribute('data-free', '2');
    const boat = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_BOAT"]');
    await expect(boat.getByTestId('delivery-target')).toContainText(baseName);
    await boat.getByTestId('buy-vehicle').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'BOAT 1 ordinato' })).toBeVisible();
    await expect(home.getByTestId('boat-home-base')).toHaveAttribute('data-free', '1');
  });

  await test.step('another session took the last berth: the refusal says so and links to the pier', async () => {
    await qa(page, 'fillBerthsSilently');
    const boat = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_BOAT"]');
    await boat.getByTestId('buy-vehicle').click();
    const rejection = boat.getByTestId('buy-rejection');
    await expect(rejection).toHaveAttribute('data-code', 'CAPACITY_EXCEEDED');
    await expect(rejection).toHaveAttribute('data-reason', 'NO_ROOM');
    await expect(rejection).toContainText('Ormeggi pieni');
    await expect(page.getByTestId('toast').filter({ hasText: 'Ormeggi pieni' }).first()).toBeVisible();
    await rejection.getByTestId('buy-rejection-fix').click();
    await expect(page).toHaveURL(/\/game\/facilities\?id=fac_/);
    const pier = page.getByTestId('upgrade-offer').filter({ hasText: 'Pontile' });
    await expect(pier).toBeVisible();
    await expect(page.getByTestId('upgrade-offer').filter({ hasText: 'Autorimessa' })).toHaveCount(0);
    await pier.getByRole('button', { name: /Costruisci/ }).click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Lavori avviati' })).toBeVisible();
    await qa(page, 'fastForward', 900);
    await expect(
      page.getByTestId('facility-detail').locator('[data-testid="capacity-bar"][data-domain="WATER"]'),
    ).toHaveAttribute('data-total', '3');
  });
});

test('a boat leaves from its berth on a dashed water route; a trailer leg shows its launch point', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  // Real-time mock (×1): the legs last long enough to be looked at.
  await bootCareer(page, info.project.name, { level: 9, credits: 60_000, speed: 1 });
  await qa(page, 'quiet');
  const baseId = await qa<string>(page, 'buildNauticalBase');
  const boatId = await qa<string>(page, 'addBoat', 'FIRE_BOAT', baseId);
  await qa(page, 'staffAll');
  const incidentId = await qa<string>(page, 'spawnWater', 'MED_SWIMMER_DISTRESS', { severity: 3, far: true });

  await test.step('the dispatch panel: the boat goes on the water, straight from its berth', async () => {
    await openIncident(page, incidentId);
    const notice = page.getByTestId('water-notice');
    await expect(notice).toHaveAttribute('data-state', 'OWN_BOATS');
    const option = page.getByTestId('dispatch-option').filter({ hasText: 'BOAT 1' });
    const route = option.getByTestId('dispatch-water-route');
    await expect(route).toHaveAttribute('data-destination', 'SCENE');
    await expect(route).toHaveAttribute('data-boat-route', 'DIRECT');
    await expect(route).toContainText('parte dall’ormeggio');
    await option.getByRole('checkbox').check();
    await page.getByTestId('send-selected').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'inviat' }).first()).toBeVisible();
  });

  await test.step('on the way: a dashed water leg from the berth to the scene', async () => {
    await qa(page, 'fastForward', 30);
    await expect
      .poll(async () => (await career(page)).vehicles.find((v) => v.id === boatId)?.status)
      .toBe('EN_ROUTE');
    await expect
      .poll(async () =>
        (await sourceFeatures(page, 'rc-routes'))
          .filter((f) => f.properties.id === boatId)
          .map((f) => f.properties.mode),
      )
      .toContain('WATER');
    const dashed = await page.evaluate(() =>
      (
        window as unknown as { __rcMap: { getPaintProperty: (l: string, p: string) => unknown } }
      ).__rcMap.getPaintProperty('rc-routes-water', 'line-dasharray'),
    );
    expect(Array.isArray(dashed)).toBe(true);
    const incident = (await career(page)).incidents.find((i) => i.id === incidentId)!;
    const water = (await sourceFeatures(page, 'rc-routes')).find(
      (f) => f.properties.id === boatId && f.properties.mode === 'WATER',
    )!;
    const coords = water.geometry.coordinates as [number, number][];
    expect(coords.at(-1)).toEqual(incident.scenePosition);
  });

  await test.step('a boat still at a fire station goes by trailer: road, launch point, then water', async () => {
    const legacy = await qa<string>(page, 'grandfatherBoat', 'FIRE_BOAT');
    await qa(page, 'staffAll');
    const river = await qa<string>(page, 'spawnWater', 'MULTI_PERSON_IN_WATER', {
      body: 'RIVER',
      severity: 4,
    });
    await openIncident(page, river);
    const option = page.getByTestId('dispatch-option').filter({ hasText: 'BOAT 2' });
    await expect(option.getByTestId('dispatch-water-route')).toHaveAttribute('data-boat-route', 'BANK');
    await expect(option.getByTestId('dispatch-water-route')).toContainText('varo dalla riva');
    await option.getByRole('checkbox').check();
    await page.getByTestId('send-selected').click();
    // The dispatch goes through the mock API while `fastForward` acts on the engine directly: wait until the dispatch is
    // registered, or on a loaded machine the clock can jump before it and the preparation then runs in real time (×1).
    await expect
      .poll(async () => (await career(page)).vehicles.find((v) => v.id === legacy)?.status)
      .not.toBe('AVAILABLE');
    await qa(page, 'fastForward', 30);
    await expect
      .poll(async () => (await career(page)).vehicles.find((v) => v.id === legacy)?.status)
      .toBe('EN_ROUTE');
    await expect
      .poll(async () =>
        (await sourceFeatures(page, 'rc-routes'))
          .filter((f) => f.properties.id === legacy)
          .map((f) => `${f.geometry.type}:${f.properties.mode}`),
      )
      .toEqual(['LineString:ROAD', 'Point:LAUNCH', 'LineString:WATER']);
  });
});

test('a boat left at a fire station moves to the Base nautica for free', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 9, credits: 60_000 });
  await qa(page, 'quiet');
  const boatId = await qa<string>(page, 'grandfatherBoat', 'FIRE_BOAT');

  await test.step('without a Base nautica: it keeps working, the way to move it is spelled out', async () => {
    await goTo(page, 'Flotta');
    const chip = page.getByTestId('legacy-boat').first();
    await expect(chip).toHaveAttribute('data-movable', 'false');
  });

  await test.step('the first Base nautica: a notification, a free move in one tap', async () => {
    const baseId = await qa<string>(page, 'buildNauticalBase');
    await page.goto('/game/fleet');
    await expect(page.getByTestId('legacy-boat').first()).toHaveAttribute('data-movable', 'true');
    // the notification of the base points at the boat
    await page.getByTestId('notifications-button').click();
    const item = page
      .getByRole('dialog', { name: 'Notifiche' })
      .getByTestId('notification-item')
      .filter({ hasText: 'Base nautica operativa' })
      .first();
    await expect(item).toContainText('si possono trasferire qui gratis');
    await item.click();
    const inspector = page.getByTestId('vehicle-inspector');
    await expect(inspector).toBeVisible();
    const transfer = inspector.getByTestId('free-boat-transfer');
    await expect(transfer).toHaveAttribute('data-state', 'READY');
    const credits = await page.getByTestId('credits').textContent();
    await transfer.getByTestId('free-boat-transfer-button').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Base nautica' }).first()).toBeVisible();
    await expect(page.getByTestId('credits')).toHaveText(credits ?? '');
    await qa(page, 'fastForward', 600);
    await expect
      .poll(async () => (await career(page)).vehicles.find((v) => v.id === boatId))
      .toMatchObject({ facilityId: baseId, status: 'AVAILABLE' });
    await expect(inspector.getByTestId('free-boat-transfer')).toHaveCount(0);
  });
});
