import { expect, test, type Page } from '@playwright/test';
import { bootCareer, hideDevToolsBadge, qa, trackProblems } from './helpers';

/**
 * Water patients (analisi/note-agenti/water-patients.md), both layouts: the people of a water incident start IN the water.
 *  - an ambulance waiting at the meeting point can do nothing for them: "In acqua — in attesa del recupero", no transport;
 *    sending it alone, the dispatch panel warns "Nessun mezzo in acqua: i pazienti restano in mare" (2026-10-18);
 *  - a boat (sent from the patients section once the incident is RESOLVING) brings them ashore: "BOAT 1 lo sta portando a
 *    riva", the phase strip (a bordo → verso riva, arrivo hh:mm); a gommone is not a medical boat, so no care on the way;
 *    the hospital transport still waits for the landing;
 *  - ashore at the meeting point ("portato da BOAT 1") the ambulance takes over and the transport leaves from there;
 *  - without a boat the Coast Guard brings them ashore at its time.
 * The mock (src/mocks/domains/medical.ts) follows the backend rule; QA knobs make the phases long enough to be looked at.
 */
trackProblems();

interface MockPatient {
  id: string;
  incidentId: string;
  status: string;
  location?: 'WATER' | 'ASHORE';
  recovery?: {
    by: string | null;
    vehicleId: string | null;
    etaAt: string | null;
    recoveredAt: string | null;
  } | null;
}
interface MockCareer {
  incidents: { id: string; status: string; position: [number, number] }[];
  vehicles: {
    id: string;
    status: string;
    typeCode: string;
    callSign: string;
    movement: { path: [number, number][] } | null;
  }[];
}
const career = (page: Page) => qa<MockCareer>(page, 'career');
const patientsOf = async (page: Page, incidentId: string) =>
  (await qa<{ patients: MockPatient[] }>(page, 'medicalState')).patients.filter(
    (p) => p.incidentId === incidentId,
  );
const vehicleStatus = async (page: Page, vehicleId: string) =>
  (await career(page)).vehicles.find((v) => v.id === vehicleId)?.status;

async function openIncident(page: Page, incidentId: string) {
  await page.goto('/game');
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
}

/** Dispatches through the mock engine itself (the same command the REST handler runs). */
async function dispatchNow(page: Page, incidentId: string, vehicleIds: string[]) {
  await page.evaluate(
    ({ incidentId, vehicleIds }) => {
      const engine = (
        window as unknown as {
          __rcMock: {
            qa: { career: () => unknown };
            dispatch: (career: unknown, incidentId: string, vehicleIds: string[]) => unknown;
          };
        }
      ).__rcMock;
      engine.dispatch(engine.qa.career(), incidentId, vehicleIds);
    },
    { incidentId, vehicleIds },
  );
}

test.beforeEach(async ({ page }) => {
  await hideDevToolsBadge(page);
  // The reward is paid when the on-scene work ends, while the patients are still being cared for.
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  // Level 9 opens the EMS and Police services: their celebrations are not what these tests are about.
  await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
    await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
  });
});

test('a patient in the water: the ambulance waits at the meeting point, a boat brings them ashore, then the hospital', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await bootCareer(page, info.project.name, { level: 9, credits: 60_000 });
  await qa(page, 'quiet');
  const baseId = await qa<string>(page, 'buildNauticalBase');
  const boatId = await qa<string>(page, 'addBoat', 'FIRE_BOAT', baseId);
  const { vehicleId: ambulanceId } = await qa<{ vehicleId: string }>(page, 'giveAmbulance');
  await qa(page, 'staffAll');
  await qa(page, 'medicalConfig', {
    // no automatic hospital nor external ambulance: the player's own taps are what we verify
    autoTransportSeconds: 3600,
    externalSeconds: 3600,
    alwaysTransport: true,
    handoffSeconds: 300,
    // the pickup of the boat's trip (game seconds, ×12 → 50 s): time to look at the people aboard, even on a busy machine
    waterPickupSeconds: 600,
  });
  // The career owns a boat able to do the water part: no Coast Guard.
  const incidentId = await qa<string>(page, 'spawnWater', 'MED_SWIMMER_DISTRESS', { severity: 3 });
  // A hypothermia: the gommone could give that first aid, but it is not a medical boat — since 2026-10-18 it only carries the
  // patient ashore (only a medical boat treats on the way); the ambulance at the meeting point takes over at the landing.
  await qa(page, 'setProfiles', incidentId, ['PP_HYPOTHERMIA']);
  const patients = page.getByTestId('incident-patients');
  const card = page.getByTestId('patient-card').first();

  await test.step('in the water, nobody on the way: the section opens by itself and asks for a boat', async () => {
    await openIncident(page, incidentId);
    await expect(patients).toHaveAttribute('data-expanded', 'true');
    await expect(patients.getByTestId('patients-in-water')).toContainText('in acqua');
    await expect(card).toHaveAttribute('data-patient-location', 'WATER');
    await expect(card.getByTestId('patient-water')).toContainText('In acqua — in attesa del recupero');
    await expect(patients.getByTestId('patients-unassessed')).toContainText(
      'Nessun mezzo acquatico sul posto o in arrivo: invia una barca.',
    );
  });

  await test.step('the ambulance alone at the meeting point: no assessment, no care, no transport', async () => {
    // The boat is part of the recommendation (the only one bringing WATER_RESCUE): the ambulance alone is a manual pick —
    // and the panel says what that means (2026-10-18): nobody on the water, the patients stay in the sea.
    await page.getByTestId('dispatch-option').filter({ hasText: /MSB/ }).getByRole('checkbox').check();
    await expect(page.getByTestId('dispatch-no-water-unit')).toContainText(
      'Nessun mezzo in acqua: i pazienti restano in mare',
    );
    await page.getByTestId('send-selected').click();
    await expect.poll(() => vehicleStatus(page, ambulanceId), { timeout: 60_000 }).toBe('ON_SCENE');
    // It arrived (the scene was re-evaluated then): the patients are still untouched in the water.
    for (const p of await patientsOf(page, incidentId))
      expect(p).toMatchObject({ status: 'UNASSESSED', location: 'WATER', recovery: { by: null } });
    await expect(card).toHaveAttribute('data-patient-status', 'UNASSESSED');
    await expect(card.getByTestId('patient-water')).toHaveAttribute('data-recovery', 'WAITING');
    await expect(page.getByTestId('transport-panel')).toHaveCount(0);
    await expect(page.getByTestId('confirm-recommended-hospital')).toHaveCount(0);
  });

  await test.step('the work ends with the patients still in the water: a boat, one tap away', async () => {
    // The ambulance alone does the land part slowly: skip to the end of the on-scene work.
    await qa(page, 'fastForward', 60);
    await expect
      .poll(async () => (await career(page)).incidents.find((i) => i.id === incidentId)?.status, {
        timeout: 30_000,
      })
      .toBe('RESOLVING');
    // Retained: the patients are not done.
    expect(await vehicleStatus(page, ambulanceId)).toBe('ON_SCENE');
    const send = patients.getByTestId('send-water-unit');
    await expect(send).toContainText('Invia BOAT 1');
    await send.click();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'va a recuperare chi è in acqua' }),
    ).toBeVisible();
  });

  await test.step('the boat on the scene: aboard, "BOAT 1 lo sta portando a riva", the phase strip', async () => {
    await expect.poll(() => vehicleStatus(page, boatId), { timeout: 60_000 }).toBe('ON_SCENE');
    const banner = card.getByTestId('patient-water');
    await expect(banner).toHaveAttribute('data-recovery', 'ABOARD');
    await expect(banner).toContainText('In acqua — BOAT 1 lo sta portando a riva');
    await expect(banner.getByTestId('patient-water-eta')).toContainText('A riva tra');
    await expect(patients.getByTestId('patients-in-water')).toBeVisible();
    // The boat's crew assessed them: what it can do in the water.
    await expect(card).not.toHaveAttribute('data-patient-status', 'UNASSESSED');
    await expect(card.getByTestId('patient-needs')).toContainText('Primo soccorso in acqua');
    // Not a medical boat: no treatment on the way ashore, and no transport from the water.
    await expect(card).toHaveAttribute('data-patient-status', 'ASSESSED');
    await expect(card).toHaveAttribute('data-patient-location', 'WATER');
    await expect(page.getByTestId('transport-panel')).toHaveCount(0);
    // The phase strip: aboard BOAT 1 (the pickup), then heading ashore with the landing time.
    const strip = patients.getByTestId('rescue-phases');
    await expect(
      strip.locator('[data-phase="ABOARD"], [data-phase="HEADING_ASHORE"]').filter({ hasText: 'BOAT 1' }),
    ).toHaveCount(1);
    // The trip ashore is short (a few hundred metres at mock speed ×12): count and text are read in the same instant.
    const heading = strip.locator('[data-phase="HEADING_ASHORE"]');
    await expect
      .poll(
        async () => ((await heading.getAttribute('data-count')) === '1' ? await heading.textContent() : null),
        { timeout: 90_000, intervals: [50] },
      )
      .toContain('arrivo');
    // The ambulance waits at the meeting point: no landing warning.
    await expect(patients.getByTestId('rescue-landing-warning')).toHaveCount(0);
  });

  await test.step('ashore at the meeting point: the ambulance takes over, the transport leaves from there', async () => {
    // the natural landing, at the end of the trip
    await expect(card).toHaveAttribute('data-patient-location', 'ASHORE', { timeout: 90_000 });
    await expect(card.getByTestId('patient-ashore')).toContainText('A riva al punto di raccolta');
    await expect(card.getByTestId('patient-ashore')).toContainText('portato da BOAT 1');
    await expect(patients.getByTestId('patients-in-water')).toHaveCount(0);
    const panel = card.getByTestId('transport-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('transport-carrier')).toHaveText(/MSB/);
    const patientId = await card.getAttribute('data-patient-id');
    await panel.getByTestId('confirm-recommended-hospital').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'in viaggio verso' })).toBeVisible();
    // (the section folds by itself once nobody waits for a decision: read the patient from the mock)
    await expect
      .poll(async () => (await patientsOf(page, incidentId)).find((p) => p.id === patientId)?.status)
      .toMatch(/IN_TRANSPORT|HANDOFF|ADMITTED/);
    const state = await career(page);
    const meetingPoint = state.incidents.find((i) => i.id === incidentId)!.position;
    const ambulance = state.vehicles.find((v) => v.id === ambulanceId)!;
    expect(ambulance.status).toMatch(/TRANSPORTING|AT_HOSPITAL/);
    if (ambulance.movement) expect(ambulance.movement.path[0]).toEqual(meetingPoint);
  });

  await test.step('the timeline: aboard, heading for the meeting point, landed', async () => {
    await page.getByTestId('incident-inspector').getByRole('tab', { name: 'Cronologia' }).click();
    const inspector = page.getByTestId('incident-inspector');
    await expect(inspector).toContainText('Paziente 1 a bordo di BOAT 1');
    await expect(inspector).toContainText(/BOAT 1 verso il punto di raccolta, arrivo \d{2}:\d{2}/);
    await expect(inspector).toContainText(/sbarcat[oi] al punto di raccolta: serve un mezzo di terra/);
  });
});

test('no boat: the Coast Guard brings the people in the water ashore at its time', async ({ page }, info) => {
  test.setTimeout(180_000);
  await bootCareer(page, info.project.name, { level: 9, credits: 60_000 });
  await qa(page, 'quiet');
  const { vehicleId: ambulanceId } = await qa<{ vehicleId: string }>(page, 'giveAmbulance');
  await qa(page, 'staffAll');
  await qa(page, 'medicalConfig', {
    autoTransportSeconds: 3600,
    externalSeconds: 3600,
    // the Coast Guard lands 1200 game seconds after the call (100 s at ×12): time to look at it
    coastGuardSeconds: 1200,
  });
  const incidentId = await qa<string>(page, 'spawnWater', 'MED_SWIMMER_DISTRESS', { severity: 3 });
  const patients = page.getByTestId('incident-patients');
  const card = page.getByTestId('patient-card').first();

  await test.step('in the water, waiting for the Coast Guard: the card, the section and the water notice say when', async () => {
    await openIncident(page, incidentId);
    await expect(page.getByTestId('water-notice')).toHaveAttribute('data-state', 'COAST_GUARD');
    await expect(page.getByTestId('coast-guard-recovery')).toContainText(
      'Porta a riva le persone in acqua tra',
    );
    await expect(card.getByTestId('patient-water')).toHaveAttribute('data-recovery', 'COAST_GUARD');
    await expect(card.getByTestId('patient-water')).toContainText(
      'In acqua — la Guardia Costiera lo porta a riva',
    );
    await expect(card.getByTestId('patient-water-eta')).toContainText('A riva tra');
    await expect(patients.getByTestId('patients-water-coast-guard')).toContainText(
      'La Guardia Costiera li porta a riva tra',
    );
  });

  await test.step('the ambulance at the meeting point waits; once the Coast Guard lands them it takes over', async () => {
    // (the ambulance may well be the whole recommendation here: dispatched directly, the panel is not the subject)
    await dispatchNow(page, incidentId, [ambulanceId]);
    await expect.poll(() => vehicleStatus(page, ambulanceId), { timeout: 60_000 }).toBe('ON_SCENE');
    for (const p of await patientsOf(page, incidentId))
      expect(p).toMatchObject({ status: 'UNASSESSED', location: 'WATER', recovery: { by: 'COAST_GUARD' } });
    // The Coast Guard's landing, now (the same executor as at its time).
    await qa(page, 'recoverNow', incidentId);
    await expect(card).toHaveAttribute('data-patient-location', 'ASHORE');
    await expect(card.getByTestId('patient-ashore')).toContainText('portato dalla Guardia Costiera');
    await expect(card).not.toHaveAttribute('data-patient-status', 'UNASSESSED');
    await expect(page.getByTestId('coast-guard-recovery')).toHaveCount(0);
    for (const p of await patientsOf(page, incidentId))
      expect(p).toMatchObject({ location: 'ASHORE', recovery: { by: 'COAST_GUARD', vehicleId: null } });
  });
});
