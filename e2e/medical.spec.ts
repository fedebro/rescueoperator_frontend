import { expect, test, type Page } from '@playwright/test';
import { bootCareer, isMobile, qa, trackProblems } from './helpers';

/**
 * Medical area, both layouts: EMS station + ambulance (QA helper) → medical incident → patients list with triage →
 * hospital options with reasons → one-tap confirm → TRANSPORTING → AT_HOSPITAL → ADMITTED → the incident leaves.
 * Also: the hospitals layer turns on by itself while a patient needs transport, and the hospital inspector.
 */
trackProblems();

interface MedicalSnapshot {
  patients: { id: string; incidentId: string; status: string; assignedVehicleId: string | null }[];
  admitted: number;
}
const medicalState = (page: Page) => qa<MedicalSnapshot>(page, 'medicalState');
const vehicleStatus = (page: Page, vehicleId: string) =>
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          __rcMock: { qa: { career: () => { vehicles: { id: string; status: string }[] } } };
        }
      ).__rcMock.qa
        .career()
        .vehicles.find((v) => v.id === id)?.status,
    vehicleId,
  );

test('patients: triage → hospital choice → transport → admitted', async ({ page }, testInfo) => {
  await bootCareer(page, testInfo.project.name, { level: 6, credits: 5000 });
  // The outcome is paid when the on-scene work ends, while the patient is still being cared for: dismiss it when it shows.
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });

  const { vehicleId } = await qa<{ vehicleId: string }>(page, 'giveAmbulance');
  await qa(page, 'staffAll');
  // No automatic confirmation during the test: the player's own tap is what we verify.
  await qa(page, 'medicalConfig', {
    autoTransportSeconds: 600,
    externalSeconds: 600,
    alwaysTransport: true,
    // a wide AT_HOSPITAL window (game seconds): the shared dev server can be slow
    handoffSeconds: 300,
  });
  const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 4);

  await test.step('the patients list starts with "triage in corso"', async () => {
    await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
    const patients = page.getByTestId('incident-patients');
    await expect(patients).toBeVisible();
    await expect(patients.getByText('1 paziente')).toBeVisible();
    await expect(page.getByTestId('patients-unassessed')).toContainText('Triage in corso');
    await expect(page.getByTestId('patient-card')).toHaveAttribute('data-patient-status', 'UNASSESSED');
    await expect(page.getByTestId('map')).not.toHaveAttribute('data-hospitals-layer', 'on');
  });

  await test.step('dispatch the ambulance: the patient is assessed (triage colour with icon + label)', async () => {
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('toast').filter({ hasText: /Mezz[oi] inviat[oi]/ })).toBeVisible();
    const card = page.getByTestId('patient-card');
    await expect(card).not.toHaveAttribute('data-patient-status', 'UNASSESSED', { timeout: 60_000 });
    await expect(card.getByTestId('triage-chip')).toHaveText(/Rosso|Arancione|Azzurro|Verde|Bianco/);
    await expect(card.getByTestId('triage-chip').locator('svg')).toHaveCount(1);
    await expect(card.getByTestId('stability-gauge')).toBeVisible();
    await expect(card.getByRole('meter', { name: 'Stabilità' })).toBeVisible();
    await expect(card.getByText(/Soccorso sanitario di base: (non )?coperto/)).toBeVisible();
  });

  await test.step('hospital options: recommendation with reasons, manual choice, hospitals layer on', async () => {
    const [patient] = (await medicalState(page)).patients.filter((p) => p.incidentId === incidentId);
    await qa(page, 'stabilize', patient!.id);
    const panel = page.getByTestId('transport-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('Consigliato', { exact: true })).toBeVisible();
    await expect(panel.getByTestId('hospital-reasons').getByRole('listitem').first()).toBeVisible();
    await expect(panel.getByTestId('transport-carrier')).toHaveText(/MSB/);
    await expect(page.getByTestId('map')).toHaveAttribute('data-hospitals-layer', 'on');
    await expect(page.getByTestId('map')).toHaveAttribute('data-hospitals-count', /^[5-9]$/);

    await panel.getByTestId('choose-other-hospital').click();
    const options = page.getByTestId('hospital-option');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThanOrEqual(5);
    await expect(options.first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Chieti/ })).toBeVisible();
    if (isMobile(page)) await page.getByRole('button', { name: 'Annulla' }).click();
    else await panel.getByTestId('choose-other-hospital').click();
    await expect(options).toHaveCount(0);
  });

  await test.step('one tap on the recommended hospital: the ambulance leaves with the patient', async () => {
    await page.getByTestId('confirm-recommended-hospital').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'in viaggio verso' })).toBeVisible();
    // The trip to the closest hospital lasts a few seconds at ×12: accept the next state too.
    await expect(page.getByTestId('patient-card')).toHaveAttribute(
      'data-patient-status',
      /IN_TRANSPORT|HANDOFF/,
    );
    await expect(page.getByTestId('assigned-vehicle')).toHaveAttribute(
      'data-vehicle-status',
      /TRANSPORTING|AT_HOSPITAL/,
    );
    expect(await vehicleStatus(page, vehicleId)).toMatch(/TRANSPORTING|AT_HOSPITAL/);
  });

  await test.step('hospital inspector: capabilities, load, incoming patient', async () => {
    await page.getByRole('button', { name: /^Mostra Ospedale .* sulla mappa$/ }).click();
    const inspector = page.getByTestId('hospital-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId('inspector-title')).toContainText('Ospedale');
    await expect(inspector.getByTestId('hospital-load')).toHaveAttribute(
      'data-load',
      /NORMAL|BUSY|SATURATED/,
    );
    await expect(inspector.getByTestId('hospital-capabilities')).toContainText('Pronto soccorso generale');
    await expect(inspector.getByTestId('hospital-incoming').getByRole('button')).toHaveCount(1);
  });

  await test.step('AT_HOSPITAL → patient admitted → the incident leaves the queue', async () => {
    await expect.poll(() => vehicleStatus(page, vehicleId), { timeout: 60_000 }).toBe('AT_HOSPITAL');
    await expect.poll(async () => (await medicalState(page)).admitted, { timeout: 60_000 }).toBe(1);
    await expect(page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`)).toHaveCount(
      0,
      { timeout: 30_000 },
    );
    await expect
      .poll(() => vehicleStatus(page, vehicleId), { timeout: 30_000 })
      .toMatch(/RETURNING|AVAILABLE/);
  });
});

test('below the HOSPITAL_CHOICE level only the recommended hospital can be confirmed', async ({
  page,
}, testInfo) => {
  await bootCareer(page, testInfo.project.name, { level: 4, credits: 5000 });
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  await qa(page, 'giveAmbulance');
  await qa(page, 'staffAll');
  await qa(page, 'medicalConfig', { autoTransportSeconds: 600, externalSeconds: 600, alwaysTransport: true });
  const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 2);
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await page.getByTestId('send-recommended').click();
  await expect(page.getByTestId('patient-card')).not.toHaveAttribute('data-patient-status', 'UNASSESSED', {
    timeout: 60_000,
  });
  const [patient] = (await medicalState(page)).patients.filter((p) => p.incidentId === incidentId);
  await qa(page, 'stabilize', patient!.id);

  const panel = page.getByTestId('transport-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId('hospital-choice-locked')).toContainText('livello 5');
  await expect(panel.getByTestId('choose-other-hospital')).toHaveCount(0);
  await expect(panel.getByTestId('hospital-reasons')).toBeVisible();
  await panel.getByTestId('confirm-recommended-hospital').click();
  await expect(page.getByTestId('patient-card')).toHaveAttribute(
    'data-patient-status',
    /IN_TRANSPORT|HANDOFF/,
  );
});
