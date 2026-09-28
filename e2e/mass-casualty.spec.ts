import { expect, test, type Page } from '@playwright/test';
import { bootCareer, hideDevToolsBadge, qa, trackProblems } from './helpers';

/**
 * Mass-casualty care (major incidents §1) on both layouts: the maxi ambulance (EMS_MAXI, `MULTI_PATIENT`, 4 per trip)
 * boards several patients of the same incident to one hospital, with a boarding list the player can edit; the advanced
 * medical post (EMS_PMA, `NO_TRANSPORT`) treats on scene and says so. QA helpers skip the slow parts (the ambulance,
 * the crews, the patients' care); the rest is the real UI.
 */
trackProblems();

interface MedicalSnapshot {
  patients: { id: string; incidentId: string; status: string; assignedVehicleId: string | null }[];
}
const medicalState = (page: Page) => qa<MedicalSnapshot>(page, 'medicalState');
const vehicleStatus = async (page: Page, vehicleId: string) =>
  (await qa<{ vehicles: { id: string; status: string }[] }>(page, 'career')).vehicles.find(
    (v) => v.id === vehicleId,
  )?.status;

/** Lets the simulation run (fast-forwarded) until the vehicle is working on scene. */
async function untilOnScene(page: Page, vehicleId: string) {
  await expect
    .poll(
      async () => {
        await qa(page, 'fastForward', 5);
        return vehicleStatus(page, vehicleId);
      },
      { timeout: 60_000, intervals: [400] },
    )
    .toBe('ON_SCENE');
}

async function openIncident(page: Page, incidentId: string) {
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
}

test.beforeEach(async ({ page }) => {
  await hideDevToolsBadge(page);
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
    await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
  });
});

test('the maxi ambulance boards several patients of the incident to one hospital', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 9, credits: 5000 });
  await qa(page, 'quiet');
  const { vehicleId } = await qa<{ vehicleId: string }>(page, 'giveAmbulance', 'EMS_MAXI');
  await qa(page, 'staffAll');
  // No automatic hand-over during the test: the player's own choice is what we verify.
  await qa(page, 'medicalConfig', {
    autoTransportSeconds: 600,
    externalSeconds: 600,
    alwaysTransport: true,
    handoffSeconds: 300,
  });
  const incidentId = await qa<string>(page, 'spawn', 'MED_MULTI_PATIENT', 6);
  await openIncident(page, incidentId);

  await test.step('its dispatch option says it carries up to 4 patients per trip', async () => {
    const option = page
      .getByTestId('dispatch-option')
      .filter({ has: page.getByTestId('dispatch-multi-patient') });
    await expect(option).toHaveCount(1);
    await expect(option.getByTestId('dispatch-multi-patient')).toContainText(
      'Trasporta fino a 4 pazienti per viaggio',
    );
    await option.getByRole('checkbox').click();
    await page.getByTestId('send-selected').click();
    await untilOnScene(page, vehicleId);
  });

  await test.step('patients ready: the boarding list, the 3 most urgent others ticked by default', async () => {
    const patients = (await medicalState(page)).patients.filter((p) => p.incidentId === incidentId);
    expect(patients.length).toBeGreaterThanOrEqual(4);
    for (const p of patients) await qa(page, 'stabilize', p.id);
    const panel = page.getByTestId('transport-panel').first();
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const picker = panel.getByTestId('boarding-picker');
    await expect(picker).toHaveAttribute('data-selected', '3');
    const rows = picker.getByTestId('boarding-patient');
    await expect(rows).toHaveCount(patients.length - 1);
    // One thumb-sized row per patient.
    expect((await rows.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(panel.getByTestId('confirm-recommended-hospital')).toContainText('Trasporta 4 pazienti');
  });

  await test.step('one patient left for the next trip: three leave together', async () => {
    const panel = page.getByTestId('transport-panel').first();
    const picker = panel.getByTestId('boarding-picker');
    await picker.getByTestId('boarding-patient').first().click();
    await expect(picker).toHaveAttribute('data-selected', '2');
    await expect(picker).toContainText('3 pazienti a bordo su 4');
    await panel.getByTestId('confirm-recommended-hospital').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'con 3 pazienti' })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await medicalState(page)).patients.filter(
            (p) => p.assignedVehicleId === vehicleId && /IN_TRANSPORT|HANDOFF/.test(p.status),
          ).length,
      )
      .toBe(3);
  });
});

test('the advanced medical post treats on scene and never transports', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 9, credits: 5000 });
  await qa(page, 'quiet');
  const { vehicleId } = await qa<{ vehicleId: string }>(page, 'giveAmbulance', 'EMS_PMA');
  await qa(page, 'staffAll');
  // No external ambulance taking the patients away meanwhile: the post stays on scene while somebody still waits.
  await qa(page, 'medicalConfig', { autoTransportSeconds: 600, externalSeconds: 600, alwaysTransport: true });
  const incidentId = await qa<string>(page, 'spawn', 'MED_MULTI_PATIENT', 6);
  await openIncident(page, incidentId);

  const option = page.getByTestId('dispatch-option').filter({ has: page.getByTestId('dispatch-field-post') });
  await expect(option).toHaveCount(1);
  await expect(option.getByTestId('dispatch-field-post')).toContainText('non trasporta');
  await option.getByRole('checkbox').click();
  await page.getByTestId('send-selected').click();
  await untilOnScene(page, vehicleId);

  // The patients section opens by itself as soon as someone waits for transport: open it only if it is still closed
  // (a blind toggle could close what just opened).
  const patients = page.getByTestId('incident-patients');
  await expect(async () => {
    if ((await patients.getAttribute('data-expanded')) !== 'true')
      await patients.getByTestId('patients-toggle').click();
    await expect(patients).toHaveAttribute('data-expanded', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(patients.getByTestId('field-post-banner')).toContainText('Posto medico avanzato attivo');
});
