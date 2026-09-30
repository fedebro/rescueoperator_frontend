import { expect, test, type Page } from '@playwright/test';
import { bootCareer, qa, trackProblems } from './helpers';

/**
 * "Load and go" (D-101), every layout: a RED patient the basic ambulance cannot stabilise (the MSB has no MEDICAL_ADVANCED) is
 * assessed and then left untreated — like the server, where from D-100 such a patient can die on scene. The card says so and
 * offers "Trasporta subito in ospedale": one tap opens the hospital choice ("Trasporto immediato"), the confirm sends them as
 * they are. The mock (src/mocks/domains/medical.ts) follows the server's rule: no treatment without the required care.
 */
trackProblems();

interface MedicalSnapshot {
  patients: { id: string; incidentId: string; status: string }[];
}
const statusOf = async (page: Page, incidentId: string) =>
  (await qa<MedicalSnapshot>(page, 'medicalState')).patients.find((p) => p.incidentId === incidentId)?.status;

test('a RED patient nobody on scene can stabilise: "take to hospital now", as they are', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 6, credits: 5000 });
  // The outcome is paid when the on-scene work ends, while the patient is still at the scene: dismiss it when it shows.
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  await qa(page, 'quiet');
  await qa(page, 'giveAmbulance');
  await qa(page, 'staffAll');
  // Nothing moves by itself during the test (no external ambulance): the player's taps are what we verify.
  await qa(page, 'medicalConfig', { autoTransportSeconds: 600, externalSeconds: 600, handoffSeconds: 300 });
  const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 4);
  // A major trauma: it needs MEDICAL_ADVANCED 80 as well.
  await qa(page, 'setProfiles', incidentId, ['PP_MAJOR_TRAUMA']);
  const card = page.getByTestId('patient-card');

  await test.step('the ambulance assesses them but cannot treat them: the section opens and says what to do', async () => {
    await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
    await page.getByTestId('send-recommended').click();
    await expect(card).toHaveAttribute('data-patient-status', 'ASSESSED', { timeout: 60_000 });
    await expect(page.getByTestId('incident-patients')).toHaveAttribute('data-expanded', 'true');
    await expect(card.getByTestId('triage-chip')).toContainText('Rosso');
    await expect(card.getByTestId('patient-needs')).toContainText('trasportalo subito in ospedale');
    // Waiting for a suitable unit stays a choice: the hospital choice only opens on the tap.
    await expect(card.getByTestId('transport-panel')).toHaveCount(0);
    expect(await statusOf(page, incidentId)).toBe('ASSESSED');
  });

  await test.step('"take to hospital now": the hospital choice, then the ambulance leaves with them', async () => {
    await card.getByTestId('load-and-go').click();
    const panel = card.getByTestId('transport-panel');
    await expect(panel).toHaveAttribute('data-mode', 'load-and-go');
    await expect(panel).toContainText('Trasporto immediato');
    await expect(panel).toContainText('Qui non può essere stabilizzato');
    await expect(panel.getByTestId('transport-carrier')).toHaveText(/MSB/);
    await panel.getByTestId('confirm-recommended-hospital').click();
    await expect(
      page.locator('[data-testid="toast"][data-tone="success"]').filter({ hasText: 'in viaggio verso' }),
    ).toBeVisible();
    await expect.poll(() => statusOf(page, incidentId)).toMatch(/IN_TRANSPORT|HANDOFF|ADMITTED/);
  });
});
