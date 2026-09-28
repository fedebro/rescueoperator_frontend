import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';
import { flick, hasCdp, touchDrag, type Point } from './gestures';

/**
 * Mobile UX of the operations screen (analisi/studio-2026-09-27/02 + 03): the bottom sheet's gestures, the list ↔
 * sheet hand-off, Back, the map keeping the selection above the sheet, quick dispatch with undo, the phone toasts,
 * the navigation and the top bar. Gestures are real touch input on Chromium (Pixel 7) and synthetic touch pointer
 * events on WebKit (iPhone), see gestures.ts.
 */
trackProblems();

const sheet = (page: Page) => page.getByTestId('bottom-sheet');
const scroller = (page: Page) => page.locator('[data-testid="bottom-sheet"] [data-sheet-scroll]').first();
const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element is not rendered');
  return b;
};
/** A point on the summary row, left of the duty switch: part of the sheet's drag strip. */
const summaryPoint = async (page: Page): Promise<Point> => {
  const b = await box(page.getByTestId('queue-summary'));
  return { x: b.x + 40, y: b.y + b.height / 2 };
};
const spawnMany = async (page: Page, count: number) => {
  const templates = ['FIRE_TRASH_BIN', 'MED_FALL', 'FIRE_VEHICLE', 'TECH_FALLEN_TREE', 'ROAD_ACCIDENT_MINOR'];
  const ids: string[] = [];
  for (let i = 0; i < count; i++)
    ids.push(await qa<string>(page, 'spawn', templates[i % templates.length], 2 + (i % 4)));
  return ids;
};
/** Screen position of an incident's marker on the map. */
const markerPoint = (page: Page, incidentId: string) =>
  page.evaluate((id) => {
    const w = window as unknown as {
      __rcMap: {
        project: (p: [number, number]) => { x: number; y: number };
        getContainer: () => HTMLElement;
      };
      __rcMock: { qa: { career: () => { incidents: { id: string; position: [number, number] }[] } } };
    };
    const incident = w.__rcMock.qa.career().incidents.find((i) => i.id === id)!;
    const p = w.__rcMap.project(incident.position);
    const rect = w.__rcMap.getContainer().getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, incidentId);
const vehicleStatuses = (page: Page) =>
  qa<{ vehicles: { status: string }[] }>(page, 'career').then((c) => c.vehicles.map((v) => v.status));
/** A career in a silent world (off duty, no random incidents): the counts below are exact. */
const boot = async (page: Page, project: string, opts: Parameters<typeof bootCareer>[2] = {}) => {
  await bootCareer(page, project, { level: 3, ...opts });
  await qa(page, 'quiet');
};

test.describe('bottom sheet (phones)', () => {
  test.beforeEach(({ page }) => {
    test.skip(!isMobile(page), 'the bottom sheet is the phone layout');
  });

  test('peek shows the summary and the most urgent card; header drag, flicks and taps', async ({
    page,
  }, info) => {
    await boot(page, info.project.name, { speed: 1 });
    await spawnMany(page, 4);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'peek');
    await expect(page.getByTestId('queue-summary')).toContainText('4 emergenze');
    await expect(page.getByTestId('queue-summary')).toContainText('4 in attesa');
    await expect(page.getByTestId('duty-toggle')).toBeVisible();
    // The peek is the actionable summary: the whole first card (and its "Invia"), not half of it.
    await expect(page.getByTestId('incident-card').first()).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('quick-dispatch').first()).toBeInViewport({ ratio: 1 });

    // A slow drag from the summary row, let go around the middle of the screen → half.
    const viewport = page.viewportSize()!;
    const start = await summaryPoint(page);
    await touchDrag(page, start, { x: start.x, y: viewport.height * 0.42 }, { durationMs: 900, steps: 18 });
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');

    // A flick moves exactly one snap: half → full, then full → half (never straight to peek).
    await flick(page, await summaryPoint(page), -70);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    await expect(page.getByTestId('sheet-collapse')).toBeVisible();
    await flick(page, await summaryPoint(page), 70);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');
    await flick(page, await summaryPoint(page), 70);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'peek');

    // Taps: peek → half → full → half; the "Riduci" button of full also goes to half.
    const handle = page.getByTestId('sheet-handle');
    await handle.tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');
    await handle.tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    await handle.tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');
    await handle.tap();
    await page.getByTestId('sheet-collapse').tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');
  });

  test('list ↔ sheet hand-off; a tap on a card still opens it', async ({ page }, info) => {
    await boot(page, info.project.name, { speed: 1 });
    await spawnMany(page, 12);
    await page.getByTestId('sheet-handle').tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');

    // From half, dragging UP on the list first raises the sheet to full, then scrolls the list.
    const card = await box(page.getByTestId('incident-card').nth(1));
    const from = { x: card.x + 60, y: card.y + card.height / 2 };
    await touchDrag(page, from, { x: from.x, y: from.y - 520 }, { durationMs: 700, steps: 20 });
    await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(40);

    if (hasCdp(page)) {
      // In full with the list scrolled, a downward drag scrolls the list back (native scrolling), the sheet stays.
      const mid = await box(scroller(page));
      const p = { x: mid.x + 60, y: mid.y + 200 };
      await touchDrag(page, p, { x: p.x, y: p.y + 160 }, { durationMs: 500, steps: 12 });
      await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    }

    // With the list at its top, a downward drag on the list lowers the sheet.
    await scroller(page).evaluate((el) => (el.scrollTop = 0));
    const top = await box(page.getByTestId('incident-card').nth(1));
    const p = { x: top.x + 60, y: top.y + top.height / 2 };
    await touchDrag(page, p, { x: p.x, y: p.y + 300 }, { durationMs: 900, steps: 18 });
    await expect(sheet(page)).not.toHaveAttribute('data-snap', 'full');

    // A tap (no movement) on a card is still a tap: it opens the incident.
    await page.getByTestId('incident-card').first().tap();
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');
  });

  test('Back closes the inspector, then lowers the sheet; closing returns to the list as it was', async ({
    page,
  }, info) => {
    await boot(page, info.project.name, { speed: 1 });
    // Enough incidents for the list to scroll even at full height.
    await spawnMany(page, 14);
    await page.getByTestId('sheet-handle').tap();
    await page.getByTestId('sheet-handle').tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    await scroller(page).evaluate((el) => (el.scrollTop = 200));
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBe(200);

    await page.getByTestId('incident-card').nth(3).tap();
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'half');

    await page.evaluate(() => history.back());
    await expect(page.getByTestId('incident-inspector')).toHaveCount(0);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    // …and the list is where it was.
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBe(200);

    await page.evaluate(() => history.back());
    await expect(sheet(page)).toHaveAttribute('data-snap', 'peek');
    await expect(page).toHaveURL(/\/game$/);

    // Closing with the X pops its history step: the next Back does not land on a dead step.
    await page.getByTestId('incident-card').first().tap();
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    const close = page.getByTestId('inspector-close');
    const closeBox = await box(close);
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    await close.tap();
    await expect(page.getByTestId('incident-inspector')).toHaveCount(0);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'peek');
  });

  test('the selected marker is centred above the sheet, and re-centred when the sheet moves', async ({
    page,
  }, info) => {
    await boot(page, info.project.name);
    const ids = await spawnMany(page, 5);
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    const card = page.locator(`[data-testid="incident-card"][data-incident-id="${ids[4]}"]`);
    await page.getByTestId('sheet-handle').tap();
    await card.tap();
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', ids[4]!);
    const aboveTheSheet = async () => {
      const marker = await markerPoint(page, ids[4]!);
      const sheetTop = (await box(sheet(page))).y;
      const topbar = await box(page.getByTestId('topbar'));
      return marker.y > topbar.y + topbar.height && marker.y < sheetTop - 8;
    };
    await expect.poll(aboveTheSheet, { timeout: 10_000 }).toBe(true);

    // A tap on the empty map only lowers the sheet: the inspector stays open, the marker is re-centred.
    // (Picked and tapped once the camera is still, so the spot is really empty when the finger lands.)
    const mapIdle = () =>
      page.waitForFunction(() => {
        const map = (window as unknown as { __rcMap: { isMoving: () => boolean; isEasing: () => boolean } })
          .__rcMap;
        return !map.isMoving() && !map.isEasing();
      });
    await mapIdle();
    const empty = await page.evaluate(() => {
      const map = (
        window as unknown as {
          __rcMap: {
            getContainer: () => HTMLElement;
            queryRenderedFeatures: (p: [number, number]) => { layer: { id: string } }[];
          };
        }
      ).__rcMap;
      const rect = map.getContainer().getBoundingClientRect();
      for (let y = 140; y < rect.height * 0.4; y += 24)
        for (let x = 30; x < rect.width - 30; x += 24)
          if (!map.queryRenderedFeatures([x, y]).some((f) => f.layer.id.startsWith('rc-')))
            return { x: rect.left + x, y: rect.top + y };
      return null;
    });
    expect(empty).not.toBeNull();
    await mapIdle();
    await page.touchscreen.tap(empty!.x, empty!.y);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'peek');
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    await expect.poll(aboveTheSheet, { timeout: 10_000 }).toBe(true);
  });

  test('the incident closes while open: a short notice, then back to the list', async ({ page }, info) => {
    await boot(page, info.project.name);
    const [id] = await spawnMany(page, 1);
    await page.locator(`[data-testid="incident-card"][data-incident-id="${id}"]`).tap();
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    await qa(page, 'fastForward', 3600); // nobody was sent: it expires
    const notice = page.getByTestId('incident-closed');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-result', 'expired');
    await expect(notice).toContainText('Emergenza scaduta');
    await expect(notice).toBeHidden({ timeout: 6000 });
    await expect(page.getByTestId('queue-summary')).toBeVisible();
  });

  test('toasts: one compact card at a time over the top bar, swiped away', async ({ page }) => {
    await page.goto('/design');
    await page.getByRole('button', { name: 'Toast · info' }).click();
    await page.getByRole('button', { name: 'Toast · success' }).click();
    const toasts = page.getByTestId('toast');
    await expect(toasts).toHaveCount(2);
    const front = page.locator('[data-testid="toast"][data-depth="0"]');
    await expect(front).toHaveAttribute('data-tone', 'success');
    const b = await box(front);
    expect(b.y).toBeLessThan(40); // over the top bar, far from the bottom sheet
    await touchDrag(
      page,
      { x: b.x + 40, y: b.y + b.height / 2 },
      { x: b.x + 260, y: b.y + b.height / 2 },
      {
        durationMs: 200,
        steps: 8,
      },
    );
    await expect(toasts).toHaveCount(1);
    await expect(front).toHaveAttribute('data-tone', 'info');
  });

  test('the app shell never scrolls: whatever overflows it, the top bar and the navigation stay in place', async ({
    page,
  }, info) => {
    await boot(page, info.project.name, { speed: 1 });
    await spawnMany(page, 6);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'peek');
    // A sheet mid-gesture overflows the frame (its content is full height while it moves): a focus or a scrollIntoView on
    // a card below the fold then scrolled the overflow-hidden shell itself — top bar gone, a blank band under the
    // navigation, and no way back. Forced here with a tall block and a scroll request.
    const scrolled = await page.evaluate(() => {
      const main = document.getElementById('main')!;
      const shell = document.querySelector<HTMLElement>('[data-testid="game-shell"]')!;
      const tall = document.createElement('div');
      tall.style.height = '3000px';
      main.appendChild(tall);
      shell.scrollTop = 200;
      main.scrollTop = 200;
      tall.scrollIntoView();
      const out = [shell.scrollTop, main.scrollTop, document.scrollingElement!.scrollTop];
      tall.remove();
      return out;
    });
    expect(scrolled).toEqual([0, 0, 0]);
    await page.getByTestId('incident-card').last().focus();
    await expect(page.getByTestId('topbar')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('bottom-nav')).toBeInViewport({ ratio: 1 });
  });

  test('phone held in landscape: two heights only', async ({ page }, info) => {
    await boot(page, info.project.name);
    await spawnMany(page, 2);
    await page.setViewportSize({ width: 740, height: 360 });
    await expect(page.locator('[data-ops-layout="phone"]')).toBeVisible();
    const handle = page.getByTestId('sheet-handle');
    await handle.tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    await handle.tap();
    await expect(sheet(page)).toHaveAttribute('data-snap', 'peek');
  });
});

test('tablets (768–1023 px): a side panel instead of the sheet, Back closes its inspector', async ({
  page,
}, info) => {
  test.skip(!isMobile(page), 'touch layouts only');
  await boot(page, info.project.name);
  await spawnMany(page, 2);
  await page.setViewportSize({ width: 820, height: 1180 });
  const panel = page.getByTestId('side-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('bottom-sheet')).toHaveCount(0);
  await panel.getByTestId('incident-card').first().tap();
  await expect(panel.getByTestId('incident-inspector')).toBeVisible();
  await expect(panel.getByTestId('send-recommended')).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(panel.getByTestId('incident-inspector')).toHaveCount(0);
  await expect(panel.getByTestId('queue-summary')).toBeVisible();
});

test('quick dispatch from the card, with a free undo for the first seconds', async ({ page }, info) => {
  // Real-time mock clock: the vehicle is still PREPARING when the undo arrives.
  await boot(page, info.project.name, { speed: 1 });
  const [id] = await spawnMany(page, 1);
  const deadline = async () =>
    (await qa<{ incidents: { id: string; expiresAt: string | null }[] }>(page, 'career')).incidents.find(
      (i) => i.id === id,
    )?.expiresAt;
  const before = await deadline();
  expect(before).toBeTruthy();
  const card = page.locator(`[data-testid="incident-card"][data-incident-id="${id}"]`);
  const quick = page.locator(`[data-testid="quick-dispatch"][data-incident-id="${id}"]`);
  await expect(card).toHaveAttribute('data-status', 'PENDING_RESPONSE');
  await quick.click();

  const sent = page.getByTestId('toast').filter({ hasText: 'mezzo inviato' });
  await expect(sent).toBeVisible();
  // Both limits of the undo run on the wall clock, and a slow run must not let either lapse while the dispatched state
  // is checked: the toast (≤ 5 s) stays while the pointer is on it, like for a player reaching for "Annulla"; the
  // server's free-cancel window (6 s of `Date.now()` in the in-page mock) is held by fixing the page's date — timers
  // keep running, so realtime delivery and the query cache still work.
  await sent.hover();
  await expect(sent).toHaveAttribute('data-held', 'true');
  await page.clock.setFixedTime(await page.evaluate(() => Date.now()));
  await expect(card).toHaveAttribute('data-status', 'RESPONDING');
  await expect.poll(() => vehicleStatuses(page)).toContain('PREPARING');
  // No "Invia" on a card that is already being handled.
  await expect(quick).toHaveCount(0);

  // "Annulla" = the free cancel of the dispatch (not a recall): nobody on the way back, the call keeps its deadline.
  await sent.getByRole('button', { name: 'Annulla' }).click();
  const undone = page.getByTestId('toast').filter({ hasText: 'Invio annullato' });
  await expect(undone).toBeVisible();
  await expect(undone).not.toContainText('richiamati');
  await expect(card).toHaveAttribute('data-status', 'PENDING_RESPONSE');
  await expect.poll(() => vehicleStatuses(page)).not.toContain('PREPARING');
  expect(await vehicleStatuses(page)).not.toContain('RETURNING');
  expect(await deadline()).toBe(before);
  await expect(quick).toBeVisible();
});

test('"Apri" on the new-incident toast works from any page', async ({ page }, info) => {
  await boot(page, info.project.name);
  await goTo(page, 'Flotta');
  await expect(page).toHaveURL(/\/game\/fleet$/);
  await qa(page, 'spawn', 'MED_FALL', 3);
  const toast = page.getByTestId('toast').filter({ hasText: 'Nuova emergenza' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Apri' }).click();
  await expect(page).toHaveURL(/\/game$/);
  await expect(page.getByTestId('incident-inspector')).toBeVisible();
  await expect(page.getByTestId('inspector-title')).toHaveText('Caduta');
});

test('navigation: Mappa · Flotta · Sedi · Acquisti · Altro, and the full incident list', async ({
  page,
}, info) => {
  await boot(page, info.project.name);
  await spawnMany(page, 2);
  if (isMobile(page)) {
    const nav = page.getByTestId('bottom-nav');
    await expect(nav.getByRole('link')).toHaveText([/Mappa/, 'Flotta', 'Sedi', 'Acquisti', 'Altro']);
    await expect(nav.getByTestId('nav-pending-badge')).toHaveText('2');
    // "Emergenze" and "Sedi" are no longer under "Altro"; the duty switch neither.
    await nav.getByRole('link', { name: 'Altro' }).click();
    await expect(page.getByRole('heading', { name: 'Altro', level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Sedi' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: 'Emergenze' })).toHaveCount(0);
    await expect(page.getByTestId('duty-toggle')).toHaveCount(0);
    // The old address opens the map with the whole list expanded.
    await page.goto('/game/incidents');
    await expect(page).toHaveURL(/\/game$/);
    await expect(sheet(page)).toHaveAttribute('data-snap', 'full');
    await expect(page.getByTestId('incident-card')).toHaveCount(2);
  } else {
    const sidebar = page.getByRole('navigation', { name: 'Navigazione principale' });
    await expect(sidebar.getByRole('link', { name: 'Emergenze' })).toHaveCount(0);
    await page.getByTestId('all-incidents').click();
    await expect(page).toHaveURL(/\/game\/incidents$/);
    await expect(page.getByRole('heading', { name: 'Emergenze', level: 1 })).toBeVisible();
  }
  // The new-facility entry lives on the Sedi page, not on the map.
  await page.goto('/game');
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('new-facility-mode')).toHaveCount(0);
  await goTo(page, 'Sedi');
  await expect(page.getByTestId('new-facility-jump')).toBeVisible();
  await page.getByTestId('sites-on-map').click();
  await expect(page).toHaveURL(/\/game$/);
  await expect(page.getByTestId('new-facility-banner')).toBeVisible();
});

test('top bar: level ring, credits, weather and bell fit on 375, 390 and 412 px phones', async ({
  page,
}, info) => {
  test.skip(!isMobile(page), 'phone layout only');
  await boot(page, info.project.name, { level: 5, credits: 13_650 });
  await expect(page.getByTestId('active-incidents')).toHaveCount(0);
  await expect(page.getByTestId('available-vehicles')).toHaveCount(0);
  for (const width of [375, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="topbar"]')!;
      const out: string[] = [];
      for (const el of bar.querySelectorAll<HTMLElement>('a, button')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5))
          out.push(el.outerHTML.slice(0, 60));
      }
      return { out, scroll: document.documentElement.scrollWidth };
    });
    expect(overflow.out, `nothing clipped at ${width}px`).toEqual([]);
    expect(overflow.scroll).toBeLessThanOrEqual(width);
    for (const id of ['level-meter', 'credits', 'world-widget', 'notifications-button'])
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
});
