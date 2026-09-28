import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Usability polish (analisi/studio-2026-09-27/03 §2.2, §2.7, §3) on both layouts: one operations map for the whole session
 * (never rebuilt when the player goes to another page and back), a facility's way back to the map, the Fleet centring a
 * moving vehicle where it is now, the low map-layers panel on phones, clusters that say what is inside, and the
 * real-money shop told apart from the in-game purchases.
 */
trackProblems();

interface MapProbe {
  __rcMap: {
    getCenter: () => { lng: number; lat: number };
    getZoom: () => number;
    queryRenderedFeatures: (options?: { layers?: string[] }) => {
      properties: Record<string, unknown>;
      geometry: { coordinates: [number, number] };
    }[];
    getLayoutProperty: (layer: string, property: string) => unknown;
    getLayer: (layer: string) => unknown;
    isMoving: () => boolean;
    isEasing: () => boolean;
    __probe?: number;
  };
}
const mapReady = (page: Page) => expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
const toMap = async (page: Page) => {
  await goTo(page, /^(Centro operativo|Mappa)$/);
  await expect(page).toHaveURL(/\/game$/);
};
const metres = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  return Math.sqrt(dLat * dLat + dLng * dLng) * 6_371_000;
};

test('one map for the whole session: other pages and back, never rebuilt', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 3 });
  await qa(page, 'quiet');
  await mapReady(page);
  // Marks this MapLibre instance: a rebuilt map would be a new object without the mark.
  await page.evaluate(() => ((window as unknown as MapProbe).__rcMap.__probe = 42));
  await goTo(page, 'Flotta');
  await expect(page).toHaveURL(/\/game\/fleet$/);
  // Parked while another page shows: in the DOM, never visible, never in the way.
  await expect(page.getByTestId('map')).toBeHidden();
  await goTo(page, 'Sedi');
  await expect(page).toHaveURL(/\/game\/facilities$/);
  await toMap(page);
  await expect(page.getByTestId('map')).toBeVisible();
  await mapReady(page);
  expect(await page.evaluate(() => (window as unknown as MapProbe).__rcMap.__probe)).toBe(42);
  await expect(page.getByTestId('map-layers-button')).toBeVisible();
});

test('a facility page leads back to that facility on the map', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 3 });
  await qa(page, 'quiet');
  await goTo(page, 'Sedi');
  const detail = page.getByTestId('facility-detail');
  await expect(detail).toBeVisible();
  const name = (await detail.getByRole('heading', { level: 2 }).first().innerText()).trim();
  const button = detail.getByTestId('facility-show-on-map');
  if (isMobile(page)) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.click();
  await expect(page).toHaveURL(/\/game$/);
  const inspector = page.getByTestId('facility-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(name);
});

test('Fleet: a vehicle on the road is centred where it is now, not at its station', async ({
  page,
}, info) => {
  // Real-time mock clock: the drive lasts long enough to be looked at (about a minute and a half).
  test.setTimeout(180_000);
  await bootCareer(page, info.project.name, { level: 3, speed: 1 });
  await qa(page, 'quiet');
  const incidentId = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 1, 2500);
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await page.getByTestId('send-recommended').click();
  const assigned = page.getByTestId('assigned-vehicle').first();
  await expect(assigned).toHaveAttribute('data-vehicle-status', 'EN_ROUTE', { timeout: 60_000 });
  const vehicleId = (await assigned.getAttribute('data-vehicle-id'))!;
  const trip = () =>
    page.evaluate((id) => {
      const career = (
        window as unknown as {
          __rcMock: {
            qa: {
              career: () => {
                vehicles: {
                  id: string;
                  position: [number, number];
                  movement: { departAt: string; arriveAt: string } | null;
                }[];
              };
            };
          };
        }
      ).__rcMock.qa.career();
      const v = career.vehicles.find((x) => x.id === id)!;
      const m = v.movement!;
      const done = (Date.now() - Date.parse(m.departAt)) / (Date.parse(m.arriveAt) - Date.parse(m.departAt));
      return { station: v.position, done };
    }, vehicleId);
  // Well on its way (a fifth of the drive): far enough from its station to tell the two apart on the map.
  await expect.poll(async () => (await trip()).done, { timeout: 90_000 }).toBeGreaterThan(0.2);
  const { station } = await trip();

  await goTo(page, 'Flotta');
  if (isMobile(page)) await page.getByTestId('vehicle-card').first().click();
  else await page.locator(`[data-row-key="${vehicleId}"]`).click();
  await expect(page).toHaveURL(/\/game$/);
  await expect(page.getByTestId('vehicle-inspector')).toBeVisible();
  // Once the camera is still: its centre is the vehicle's marker on the road, not the station it left.
  const where = () =>
    page.evaluate((id) => {
      const map = (window as unknown as MapProbe).__rcMap;
      if (map.isMoving() || map.isEasing()) return null;
      const marker = map
        .queryRenderedFeatures({ layers: ['rc-vehicles-icon'] })
        .find((f) => f.properties.id === id);
      if (!marker) return null;
      const c = map.getCenter();
      return { center: [c.lng, c.lat] as [number, number], marker: marker.geometry.coordinates };
    }, vehicleId);
  await expect.poll(where, { timeout: 15_000 }).not.toBeNull();
  const seen = (await where())!;
  // The camera went to where the vehicle was when it was tapped — on the road, well away from the station — and the
  // vehicle, still driving on, is nearer to it than to the station it left.
  expect(metres(seen.center, station)).toBeGreaterThan(250);
  expect(metres(seen.center, seen.marker)).toBeLessThan(metres(station, seen.marker));
});

test('phones: the map layers panel is low and leaves the map in view, undimmed', async ({ page }, info) => {
  test.skip(!isMobile(page), 'the layers sheet is the phone layout');
  await bootCareer(page, info.project.name, { level: 3 });
  await qa(page, 'quiet');
  await mapReady(page);
  await page.getByTestId('map-layers-button').click();
  const panel = page.getByTestId('map-layers-sheet');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  // At most about half the screen: the map stays in view above it…
  expect(box.y).toBeGreaterThan(viewport.height * 0.45);
  // …and it is not dimmed nor blurred behind the panel.
  const overlay = await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('[data-state="open"]')].find(
      (e) => getComputedStyle(e).position === 'fixed' && !e.getAttribute('role'),
    );
    if (!el) return null;
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, blur: style.backdropFilter };
  });
  expect(overlay).not.toBeNull();
  expect(overlay!.background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(overlay!.blur === 'none' || overlay!.blur === '').toBe(true);
  // Turning a layer on shows at once on the map above the panel.
  await panel.getByTestId('layer-toggle-hospitals').click();
  await expect(page.getByTestId('map-layers')).toHaveAttribute('data-hospitals', 'true');
});

test('a cluster says what is inside: the most severe pictogram, its colour, the count', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3 });
  await qa(page, 'quiet');
  await mapReady(page);
  for (const [template, severity] of [
    ['FIRE_TRASH_BIN', 1],
    ['MED_FALL', 2],
    ['FIRE_VEHICLE', 4],
  ] as const)
    await qa(page, 'spawn', template, severity);
  // Zoomed out, the three calls gather into one cluster (clusters stop at zoom 11).
  await page.evaluate(() =>
    (window as unknown as { __rcMap: { jumpTo: (o: unknown) => void } }).__rcMap.jumpTo({ zoom: 8 }),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as MapProbe).__rcMap
          .queryRenderedFeatures({ layers: ['rc-incidents-cluster'] })
          .map((f) => ({ count: f.properties.point_count, rank: f.properties.topRank })),
      ),
    )
    .toEqual([{ count: 3, rank: expect.any(Number) }]);
  const [cluster] = await page.evaluate(() =>
    (window as unknown as MapProbe).__rcMap
      .queryRenderedFeatures({ layers: ['rc-incidents-cluster'] })
      .map((f) => ({ rank: Number(f.properties.topRank), maxSeverity: f.properties.maxSeverity })),
  );
  // Its badge is the most severe call's: severity 4 (the car fire), and its pictogram index.
  expect(Math.floor(cluster!.rank / 1000)).toBe(4);
  expect(cluster!.maxSeverity).toBe(4);
});

test('the real-money shop has its own name and sign, apart from the in-game purchases', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 3000 });
  await qa(page, 'quiet');
  // The credit shop shows up after the first organic purchase (monetization gate).
  await goTo(page, 'Acquisti');
  await page
    .locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]')
    .getByTestId('buy-vehicle')
    .click();
  await expect(page.getByTestId('toast').filter({ hasText: 'ordinato' })).toBeVisible();
  if (isMobile(page)) await page.getByTestId('bottom-nav').getByRole('link', { name: 'Altro' }).click();
  const shop = page.getByRole('link', { name: 'Ricarica Crediti' }).first();
  await expect(shop).toBeVisible();
  await expect(page.getByRole('link', { name: 'Acquisti' }).first()).toBeVisible();
  // Its own icon (a euro badge), never the cart of the in-game purchases.
  expect(await shop.locator('svg').first().getAttribute('class')).toContain('lucide-badge-euro');
  await shop.click();
  await expect(page).toHaveURL(/\/game\/credits$/);
  await expect(page.getByRole('heading', { name: 'Ricarica Crediti', level: 1 })).toBeVisible();
});
