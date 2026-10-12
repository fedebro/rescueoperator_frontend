import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootCareer, isMobile, qa, trackProblems } from './helpers';

/**
 * Sending a vehicle that is not free (owner, 2026-10-12), both layouts — the phone at 360 px:
 *  1. a busy vehicle in the options list shows its WHOLE name and the mission it is on (no "…", no greyed-out text);
 *  2. the queue asks for a confirmation with the mission and the estimate, then the vehicle leaves by itself when it is free;
 *  3. a vehicle called back by mistake can be sent back to the same emergency (from the emergency and from the vehicle sheet);
 *  4. a vehicle that just finished a call is redirected at once to another one, even with low supplies;
 *  5. a purely medical call closes when its patient is in hospital although nobody is left on the scene.
 * Time runs at ×1 and is stepped with `qa.fastForward`: every state is reached deterministically, never raced.
 */
trackProblems();

interface MockVehicle {
  id: string;
  callSign: string;
  status: string;
  incidentId: string | null;
}
interface MockCareer {
  vehicles: MockVehicle[];
  incidents: { id: string; title: { params?: { fallback?: string } }; address: string; status: string }[];
  stats: { resolved: number; failed: number };
}
const career = (page: Page) => qa<MockCareer>(page, 'career');
const vehicleOf = async (page: Page, id: string) => (await career(page)).vehicles.find((v) => v.id === id)!;

/** Runs a snippet against the live mock engine in the page (`engine`, `career`, `args`). */
const inEngine = <T = unknown>(page: Page, code: string, ...args: unknown[]) =>
  page.evaluate(
    ({ code, args }) => {
      const engine = (window as unknown as { __rcMock: { qa: { career: () => unknown } } }).__rcMock;
      return new Function('engine', 'career', 'args', code)(engine, engine.qa.career(), args) as T;
    },
    { code, args },
  );

/** Steps the simulation (real seconds pulled forward) until `done` holds. */
async function stepUntil(page: Page, done: (c: MockCareer) => boolean, seconds = 5, timeout = 90_000) {
  await expect
    .poll(
      async () => {
        await qa(page, 'fastForward', seconds);
        return done(await career(page));
      },
      { timeout, intervals: [100] },
    )
    .toBe(true);
}

async function openIncident(page: Page, incidentId: string) {
  await page.goto('/game');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
}
const optionOf = (page: Page, vehicleId: string): Locator =>
  page.locator(`[data-testid="dispatch-option"][data-vehicle-id="${vehicleId}"]`);

/**
 * Nothing sticks out sideways: the page, and — when a row is given — nothing inside the row goes past its right edge
 * (the inspector's own scroll body may carry a pixel or two of unrelated rounding on WebKit).
 */
async function expectNoHorizontalOverflow(page: Page, row?: Locator) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (!row) return;
  const outside = await row.evaluate((el) => {
    const limit = el.getBoundingClientRect().right + 0.5;
    return [...el.querySelectorAll('*')]
      .filter(
        (child) => child.getBoundingClientRect().width > 0 && child.getBoundingClientRect().right > limit,
      )
      .map(
        (child) =>
          `${child.tagName} ${child.getAttribute('data-testid') ?? ''} ${(child.textContent ?? '').slice(0, 30)}`,
      );
  });
  expect(outside, 'nothing of the row past its right edge').toEqual([]);
}

/** A two-vehicle fire world: the starter engine plus one more, a far call A and a near call B, the world quiet. */
async function fireWorld(page: Page, projectName: string, opts: { farMeters?: number; speed?: number } = {}) {
  // The phone is checked at 360 px, the narrowest screen the game promises to fit.
  if (isMobile(page)) await page.setViewportSize({ width: 360, height: 740 });
  await bootCareer(page, projectName, { level: 3, credits: 5000, speed: opts.speed ?? 1 });
  await qa(page, 'quiet');
  await qa(page, 'addVehicles', 'FIRE_APS', 1);
  await qa(page, 'staffAll');
  // A far call: the trips are long enough to be observed step by step.
  const a = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 1, opts.farMeters ?? 2500);
  const b = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 1);
  return { a, b };
}

/** Sends the recommended vehicle to `incidentId` (one tap) and returns it. */
async function sendRecommended(page: Page, incidentId: string): Promise<MockVehicle> {
  await openIncident(page, incidentId);
  await page.getByTestId('send-recommended').click();
  await expect(page.getByTestId('assigned-vehicle').first()).toBeVisible();
  const sent = (await career(page)).vehicles.find((v) => v.incidentId === incidentId);
  expect(sent, 'the recommended vehicle left').toBeTruthy();
  return sent!;
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

test('a busy vehicle keeps its whole name and says which mission it is on', async ({ page }, info) => {
  const { a, b } = await fireWorld(page, info.project.name);
  const sent = await sendRecommended(page, a);
  const missionOf = (await career(page)).incidents.find((i) => i.id === a)!;

  await test.step('the second call lists it as busy: name, mission, state — not a greyed-out line', async () => {
    await openIncident(page, b);
    const row = optionOf(page, sent.id);
    await expect(row).toHaveAttribute('data-busy', 'true');
    await expect(row.getByTestId('dispatch-option-name')).toHaveText(sent.callSign);
    await expect(row.getByTestId('dispatch-option-busy')).toHaveText('Impegnato');
    const mission = row.getByTestId('chain-mission');
    await expect(mission).toContainText('Impegnato su:');
    await expect(mission).toContainText('Incendio cassonetto');
    await expect(mission).toContainText(missionOf.address);
    await expect(mission).toContainText(/In partenza|In viaggio/);
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(row.getByTestId('chain-reason')).toHaveAttribute('data-reason', 'VEHICLE_NOT_RETURNING');
    // Readable: the name is not dimmed (no opacity on the row) and the actions are full-width buttons of at least 44 px.
    expect(await row.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const queue = row.getByTestId('chain-queue');
    expect((await queue.boundingBox())!.height).toBeGreaterThanOrEqual(isMobile(page) ? 43.5 : 31.5);
    await expectNoHorizontalOverflow(page, row);
  });

  await test.step('a long name wraps instead of being cut to "…"', async () => {
    const longName = 'Autopompa serbatoio Centrale Nord 12';
    await inEngine(
      page,
      `const v = engine.patchVehicle(career, args[0], { callSign: args[1] });
       engine.emit(career, 'vehicle.updated', { vehicle: v }); engine.save();`,
      sent.id,
      longName,
    );
    await openIncident(page, b);
    const name = optionOf(page, sent.id).getByTestId('dispatch-option-name');
    await expect(name).toHaveText(longName);
    const box = await name.evaluate((el) => ({
      overflowing: el.scrollWidth > el.clientWidth + 1,
      ellipsis: getComputedStyle(el).textOverflow === 'ellipsis',
    }));
    expect(box).toEqual({ overflowing: false, ellipsis: false });
    await expectNoHorizontalOverflow(page, optionOf(page, sent.id));
  });
});

test('the queue is confirmed with the mission and the estimate, then the vehicle leaves by itself', async ({
  page,
}, info) => {
  const { a, b } = await fireWorld(page, info.project.name);
  const sent = await sendRecommended(page, a);

  await test.step('tapping "Metti in coda" asks first: vehicle, mission, when it is free and would arrive', async () => {
    await openIncident(page, b);
    await optionOf(page, sent.id).getByTestId('chain-queue').click();
    const dialog = page.getByTestId('chain-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('chain-confirm-vehicle')).toContainText(sent.callSign);
    await expect(dialog.getByTestId('chain-confirm-mission')).toContainText('Incendio cassonetto');
    await expect(dialog.getByTestId('chain-confirm-free-at')).toContainText(/Libero verso le \d\d:\d\d/);
    await expect(dialog.getByTestId('chain-confirm-arrive-at')).toContainText(
      /Arriverebbe qui verso le \d\d:\d\d/,
    );
    await expect(dialog.getByTestId('chain-confirm-countdown')).toContainText(/tra \d+:\d\d/);
    // The vehicle is still travelling to the first call: a projection, said as such, and what it rests on.
    await expect(dialog.getByTestId('chain-confirm-approximate')).toBeVisible();
    await expect(dialog.getByTestId('chain-confirm-basis')).toHaveAttribute('data-basis', 'WORK_END');
    await expect(dialog.getByTestId('chain-confirm-expiry')).toHaveCount(0);
    // Nothing is queued until the player confirms.
    expect((await qa<{ queue: Record<string, unknown> }>(page, 'chainState')).queue).toEqual({});
    await expectNoHorizontalOverflow(page, dialog);
    await dialog.getByTestId('chain-confirm-cancel').click();
    await expect(dialog).toBeHidden();
    expect((await qa<{ queue: Record<string, unknown> }>(page, 'chainState')).queue).toEqual({});
  });

  await test.step('a call that would expire before it arrives is flagged loudly', async () => {
    await inEngine(
      page,
      `engine.patchIncident(career, args[0], { expiresAt: new Date(engine.now() + 1500).toISOString() }); engine.save();`,
      b,
    );
    await openIncident(page, b);
    await optionOf(page, sent.id).getByTestId('chain-queue').click();
    const warning = page.getByTestId('chain-confirm-expiry');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Arriverebbe dopo la scadenza della chiamata');
    await expect(warning).toContainText('la coda verrebbe annullata');
    await page.getByTestId('chain-confirm-cancel').click();
    // the call is kept alive for the rest of the test
    await inEngine(
      page,
      `engine.patchIncident(career, args[0], { expiresAt: new Date(engine.now() + 3_600_000).toISOString() });
       engine.cancelActions(career, (x) => x.type === 'INCIDENT_EXPIRE' && x.ref === args[0]); engine.save();`,
      b,
    );
  });

  await test.step('confirmed: the toast repeats the time, the row shows the queue and can take it back', async () => {
    await openIncident(page, b);
    await optionOf(page, sent.id).getByTestId('chain-queue').click();
    await page.getByTestId('chain-confirm-submit').click();
    await expect(
      page.getByTestId('toast').filter({ hasText: /in coda: arriverebbe verso le \d\d:\d\d/ }),
    ).toBeVisible();
    const row = optionOf(page, sent.id);
    await expect(row.getByTestId('chain-queued')).toContainText('In coda per questa emergenza');
    await expect(row.getByTestId('chain-arrival')).toContainText(/Arriverebbe verso le \d\d:\d\d/);
    await row.getByTestId('chain-cancel').click();
    await expect(row.getByTestId('chain-queue')).toBeVisible();
    expect((await qa<{ queue: Record<string, unknown> }>(page, 'chainState')).queue).toEqual({});
    // and queue it again for good
    await row.getByTestId('chain-queue').click();
    await page.getByTestId('chain-confirm-submit').click();
    await expect(row.getByTestId('chain-queued')).toBeVisible();
  });

  await test.step('free again, the vehicle leaves for the queued call without being asked', async () => {
    await stepUntil(page, (c) => c.vehicles.find((v) => v.id === sent.id)!.incidentId === b, 10, 120_000);
    expect(['PREPARING', 'EN_ROUTE', 'ON_SCENE']).toContain((await vehicleOf(page, sent.id)).status);
    expect((await qa<{ queue: Record<string, unknown> }>(page, 'chainState')).queue).toEqual({});
  });
});

test('a vehicle called back by mistake can be sent back to the same emergency', async ({ page }, info) => {
  // Very far and slow (a quarter of real time): the way back lasts minutes, whatever the machine does, the steps never race the clock.
  const { a } = await fireWorld(page, info.project.name, { farMeters: 6000, speed: 0.25 });
  const sent = await sendRecommended(page, a);
  await stepUntil(page, (c) => c.vehicles.find((v) => v.id === sent.id)!.status === 'EN_ROUTE', 2);
  // well on its way: the way back then lasts long enough to be worked with
  await qa(page, 'fastForward', 240);

  await test.step('recalled from its vehicle sheet…', async () => {
    await page.goto('/game/fleet');
    await expect(page.getByRole('heading', { name: 'Flotta', level: 1 })).toBeVisible({ timeout: 60_000 });
    if (isMobile(page))
      await page.getByTestId('vehicle-card').filter({ hasText: sent.callSign }).first().click();
    else await page.getByRole('row').filter({ hasText: sent.callSign }).first().click();
    await expect(page.getByTestId('vehicle-inspector')).toBeVisible();
    await page.getByTestId('recall-vehicle').click();
    await expect(page.getByTestId('vehicle-inspector')).toHaveAttribute('data-vehicle-status', 'RETURNING');
  });

  await test.step('…the same sheet offers to send it back, as long as the call is open', async () => {
    const resend = page.getByTestId('resend-here');
    await expect(resend).toBeVisible();
    await expect(resend).toContainText('Richiamato da: Incendio cassonetto');
    await expect(resend.getByTestId('resend-vehicle')).toHaveText('Rimanda alla stessa emergenza');
    await expect(resend.getByTestId('resend-eta')).toContainText(/Arriva in \d+:\d\d/);
    await resend.getByTestId('resend-vehicle').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'rimandato qui' })).toBeVisible();
    await expect(page.getByTestId('vehicle-inspector')).toHaveAttribute('data-vehicle-status', 'EN_ROUTE');
    expect(await vehicleOf(page, sent.id)).toMatchObject({ status: 'EN_ROUTE', incidentId: a });
  });

  await test.step('recalled once more: the emergency itself lists it as "Richiamato" with "Rimanda qui"', async () => {
    await qa(page, 'fastForward', 160);
    await inEngine(page, `engine.recall(career, args[0]);`, sent.id);
    await openIncident(page, a);
    const row = optionOf(page, sent.id);
    await expect(row.getByTestId('chain-mission')).toHaveAttribute('data-here', 'true');
    await expect(row.getByTestId('chain-recalled-here')).toHaveText('Richiamato da questa emergenza');
    await expect(row.getByTestId('chain-resend')).toHaveText('Rimanda qui');
    await expect(row.getByTestId('chain-redirect')).toHaveCount(0);
    await expect(row.getByTestId('chain-eta')).toContainText(/Arriva in \d+:\d\d/);
    await expectNoHorizontalOverflow(page, row);
    await row.getByTestId('chain-resend').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'rimandato qui' })).toBeVisible();
    expect(await vehicleOf(page, sent.id)).toMatchObject({ status: 'EN_ROUTE', incidentId: a });
    await expect(page.getByTestId('assigned-vehicle').filter({ hasText: sent.callSign })).toBeVisible();
  });
});

test('right after a call it finished, a vehicle is redirected to another — also with low supplies', async ({
  page,
}, info) => {
  const { a, b } = await fireWorld(page, info.project.name, { farMeters: 4000, speed: 0.5 });
  const sent = await sendRecommended(page, a);

  await test.step('the first call is done: the vehicle is on its way home, never back at base', async () => {
    await stepUntil(
      page,
      (c) => c.stats.resolved >= 1 && c.vehicles.find((v) => v.id === sent.id)!.status === 'RETURNING',
      3,
      120_000,
    );
    // a reload at base would fix it, but a redirect never waits for it: it goes with what it has
    await qa(page, 'setAutonomy', sent.id, { stock: { ABSORBENT: 0 } });
  });

  await test.step('the second call offers a one-tap redirect with its arrival time and the low supplies', async () => {
    await openIncident(page, b);
    const row = optionOf(page, sent.id);
    await expect(row.getByTestId('chain-mission')).toContainText(/Rientra da|Impegnato su/);
    await expect(row.getByTestId('chain-redirect')).toBeEnabled();
    await expect(row.getByTestId('chain-eta')).toContainText(/Arriva in \d+:\d\d/);
    await expect(row.getByTestId('chain-stock-low')).toContainText('Scorte basse:');
    await expect(row.getByTestId('chain-queue-after-restock')).toHaveText(
      'Metti in coda (dopo il rifornimento)',
    );
    await expectNoHorizontalOverflow(page, row);
  });

  await test.step('one tap: it turns where it is, now EN_ROUTE to the second call', async () => {
    await optionOf(page, sent.id).getByTestId('chain-redirect').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'reindirizzato qui' })).toBeVisible();
    expect(await vehicleOf(page, sent.id)).toMatchObject({ status: 'EN_ROUTE', incidentId: b });
    await expect(page.getByTestId('assigned-vehicle').filter({ hasText: sent.callSign })).toBeVisible();
    expect(
      (await qa<{ returnFrom: Record<string, string> }>(page, 'chainState')).returnFrom[sent.id],
    ).toBeUndefined();
  });
});

test('a medical call closes when its patient is in hospital, with nobody left on the scene', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 6, credits: 5000, speed: 1 });
  await qa(page, 'quiet');
  const { vehicleId } = await qa<{ vehicleId: string }>(page, 'giveAmbulance');
  await qa(page, 'staffAll');
  await qa(page, 'medicalConfig', {
    autoTransportSeconds: 6000,
    externalSeconds: 6000,
    alwaysTransport: true,
    handoffSeconds: 60,
  });
  const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 3);
  // a long job on the scene: it is never the work that ends this call
  await inEngine(
    page,
    `const i = career.incidents.find((x) => x.id === args[0]);
     engine.patchIncident(career, i.id, { work: { ...i.work, total: 100000, remaining: 100000 } }); engine.save();`,
    incidentId,
  );

  await test.step('the ambulance goes, assesses the patient and takes it to hospital', async () => {
    await openIncident(page, incidentId);
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('assigned-vehicle').first()).toBeVisible();
    const patientId = async () =>
      (await qa<{ patients: { id: string; status: string }[] }>(page, 'medicalState')).patients[0]!;
    await expect
      .poll(
        async () => {
          await qa(page, 'fastForward', 3);
          return (await patientId()).status !== 'UNASSESSED';
        },
        { timeout: 90_000, intervals: [100] },
      )
      .toBe(true);
    await qa(page, 'stabilize', (await patientId()).id);
    await expect(page.getByTestId('transport-panel')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('confirm-recommended-hospital').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'in viaggio verso' })).toBeVisible();
  });

  await test.step('the scene is uncovered, the call is still there, waiting for its patient', async () => {
    const c = await career(page);
    expect(c.vehicles.find((v) => v.id === vehicleId)!.status).toBe('TRANSPORTING');
    expect(c.incidents.find((i) => i.id === incidentId)!.status).toBe('PENDING_RESPONSE');
  });

  await test.step('the patient is admitted: the call is over — a success, never an expiry', async () => {
    await stepUntil(page, (c) => !c.incidents.some((i) => i.id === incidentId), 4, 120_000);
    const done = await career(page);
    expect(done.stats).toMatchObject({ resolved: 1, failed: 0 });
    await expect(page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`)).toHaveCount(
      0,
    );
    // and it never expires afterwards: ten more minutes change nothing
    await qa(page, 'fastForward', 600);
    expect((await career(page)).stats.failed).toBe(0);
  });
});
