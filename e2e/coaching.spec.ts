import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Game-wide contextual coaching: first-visit section primers, one-off coach marks tied to real state transitions,
 * the on-demand help affordance, the "Suggerimenti attivi" settings toggle, and the idle "what should I do now"
 * suggestion. Every scenario here uses a FRESH career (via `bootCareer`) so "seen" state starts empty, and drives
 * the underlying condition through the mock QA helpers rather than faking it in the UI.
 */
trackProblems();

interface MockVehicle {
  id: string;
  callSign: string;
}
const careerVehicles = (page: Page) =>
  qa<{ vehicles: MockVehicle[] }>(page, 'career').then((c) => c.vehicles);

interface MedicalSnapshot {
  patients: { id: string; incidentId: string; status: string }[];
}
const medicalState = (page: Page) => qa<MedicalSnapshot>(page, 'medicalState');

test('section primer: shown on first visit, help reopens it on demand, gone for good after dismissal + reload', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 1 });
  await goTo(page, 'Personale', true);
  await expect(page.getByRole('heading', { name: 'Personale', level: 1 })).toBeVisible({ timeout: 60_000 });

  const primer = page.getByTestId('section-primer');
  await test.step('first visit shows the primer with a title, body and a concrete tip', async () => {
    await expect(primer).toBeVisible();
    await expect(primer).toHaveAttribute('data-section', 'personnel');
    await expect(primer).toContainText('Personale');
    await expect(primer.getByRole('listitem').first()).toBeVisible();
  });

  await test.step('dismissing it hides it and it never reappears from a fresh navigation', async () => {
    await primer.getByTestId('section-primer-dismiss').click();
    await expect(primer).toBeHidden();
    await goTo(page, 'Flotta', true);
    await goTo(page, 'Personale', true);
    await expect(page.getByTestId('section-primer')).toBeHidden();
  });

  await test.step('the "?" help affordance reopens the same content on demand, without un-dismissing the primer', async () => {
    await page.getByTestId('section-help-personnel').click();
    const dialog = page.getByRole('dialog', { name: 'Personale' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listitem').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('section-primer')).toBeHidden();
  });

  await test.step('a reload never replays a dismissed primer', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Personale', level: 1 })).toBeVisible();
    await expect(page.getByTestId('section-primer')).toBeHidden();
  });
});

test('shop primer fires per newly-unlocked family; a still-locked family shows a coach mark instead', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 1, credits: 50_000 });

  await test.step('unlocking EMS celebrates it and its shop primer appears the first time', async () => {
    await qa(page, 'unlockFamily', 'EMS');
    await page.goto('/game');
    await expect(page.getByTestId('family-unlock')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('family-unlock')).toHaveAttribute('data-family', 'EMS');
    await page.getByTestId('family-unlock-shop').click();
    await expect(page).toHaveURL(/\/game\/shop/);
    await expect(page.getByRole('heading', { name: 'Centro acquisti', level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    const primer = page.getByTestId('section-primer');
    await expect(primer).toBeVisible();
    await expect(primer).toHaveAttribute('data-section', 'shop:EMS');
    await primer.getByTestId('section-primer-dismiss').click();
    await expect(primer).toBeHidden();
  });

  await test.step('a family the player has not reached yet shows the "locked family" coach mark, once', async () => {
    await page.goto('/game/shop?family=POLICE');
    const mark = page.getByTestId('coach-mark');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('data-coach-id', 'lockedFamily');
    await expect(mark.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    await mark.getByTestId('coach-mark-dismiss').click();
    await expect(mark).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('coach-mark')).toBeHidden();
  });

  await test.step('the shop primer for EMS never reappears once dismissed', async () => {
    await page.goto('/game/shop?family=EMS');
    await expect(page.getByTestId('section-primer')).toBeHidden();
  });
});

test('medical inside an incident: patients primer and hospital-transport coach mark, both dismissible without blocking the real controls', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 6, credits: 5000 });
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  await qa(page, 'giveAmbulance');
  await qa(page, 'staffAll');
  await qa(page, 'medicalConfig', {
    autoTransportSeconds: 600,
    externalSeconds: 600,
    alwaysTransport: true,
    handoffSeconds: 300,
  });
  const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 4);

  await test.step('the medical section primer appears the first time patients show up in an incident', async () => {
    await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
    const patients = page.getByTestId('incident-patients');
    await expect(patients).toBeVisible();
    const primer = patients.getByTestId('section-primer');
    await expect(primer).toBeVisible();
    await expect(primer).toHaveAttribute('data-section', 'medical');
    await primer.getByTestId('section-primer-dismiss').click();
    await expect(primer).toBeHidden();
  });

  await test.step('assessing the patient still works right after dismissing the primer (nothing blocked it)', async () => {
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('patient-card')).not.toHaveAttribute('data-patient-status', 'UNASSESSED', {
      timeout: 60_000,
    });
  });

  await test.step('the hospital-transport coach mark appears once the transport panel does, and dismissing it leaves the panel fully usable', async () => {
    const [patient] = (await medicalState(page)).patients.filter((p) => p.incidentId === incidentId);
    await qa(page, 'stabilize', patient!.id);
    const panel = page.getByTestId('transport-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const mark = page.getByTestId('coach-mark');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('data-coach-id', 'hospitalTransport');
    // Escape dismisses it from the keyboard, same as the close button.
    await page.keyboard.press('Escape');
    await expect(mark).toBeHidden();
    // The confirm button underneath was never covered: it is still clickable right after.
    await panel.getByTestId('confirm-recommended-hospital').click();
    await expect(page.locator('[data-testid="toast"][data-tone="success"]')).toBeVisible();
  });
});

test('inventory low stock and vehicle breakdown coach marks: fire once, never block input, gone for good after reload', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 3000 });

  await test.step('low stock: coach mark appears with the alert, is keyboard-dismissible, and the order button still works', async () => {
    await qa(page, 'drainStock', 'FOAM', 80);
    await goTo(page, 'Logistica', true);
    await expect(page.getByRole('heading', { name: 'Logistica', level: 1 })).toBeVisible({ timeout: 60_000 });
    const alert = page.getByTestId('low-stock-alert');
    await expect(alert).toBeVisible();
    const mark = page.getByTestId('coach-mark');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('data-coach-id', 'lowStock');
    await expect(mark.locator('[role="status"][aria-live="polite"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(mark).toBeHidden();
    // The real control right next to it was never blocked by the coach mark's own card.
    await page.getByTestId('low-stock-order').click();
    await expect(page.getByTestId('order-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('tab', { name: 'Magazzino' }).click();
    await expect(page.getByTestId('coach-mark')).toBeHidden();
  });

  await test.step('vehicle breakdown: coach mark appears on the recovery steps and never blocks the inspector', async () => {
    const vehicleId = await qa<string>(page, 'breakDown');
    if (isMobile(page)) await page.goto('/game');
    await goTo(page, 'Flotta', true);
    if (isMobile(page)) await page.getByTestId('vehicle-card').first().click();
    else await page.locator(`[data-row-key="${vehicleId}"]`).click();
    const inspector = page.getByTestId('vehicle-inspector');
    await expect(inspector).toBeVisible();
    const mark = page.getByTestId('coach-mark');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('data-coach-id', 'vehicleBreakdown');
    await mark.getByTestId('coach-mark-dismiss').click();
    await expect(mark).toBeHidden();
    // The recovery narrative underneath is fully visible and interactive right after dismissing.
    await expect(inspector.getByTestId('recovery-steps')).toBeVisible();
  });
});

test('the "Suggerimenti attivi" toggle turns every primer off, and back on without replaying dismissed ones', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 1 });

  await test.step('a section already dismissed stays hidden regardless of the toggle', async () => {
    await goTo(page, 'Personale', true);
    await page.getByTestId('section-primer').getByTestId('section-primer-dismiss').click();
    await expect(page.getByTestId('section-primer')).toBeHidden();
  });

  await test.step('turning coaching off hides a primer that was never shown yet', async () => {
    await goTo(page, 'Impostazioni', true);
    const toggle = page.getByTestId('coaching-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await goTo(page, 'Sedi', true);
    await expect(page.getByTestId('section-primer')).toBeHidden();
  });

  await test.step('turning it back on shows that still-unseen primer again (still-dismissed ones do not replay)', async () => {
    await goTo(page, 'Impostazioni', true);
    await page.getByTestId('coaching-toggle').click();
    await expect(page.getByTestId('coaching-toggle')).toHaveAttribute('aria-checked', 'true');
    await goTo(page, 'Sedi', true);
    await expect(page.getByTestId('section-primer')).toBeVisible();
    await goTo(page, 'Personale', true);
    await expect(page.getByTestId('section-primer')).toBeHidden();
  });
});

test('idle Operations screen suggests a concrete next action from real career state', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 1000 });
  const vehicleId = await qa<string>(page, 'breakDown');
  const vehicle = (await careerVehicles(page)).find((v) => v.id === vehicleId)!;

  if (isMobile(page)) await goTo(page, 'Emergenze', true);
  // Desktop: the queue is already visible in the map sidebar from `bootCareer`'s landing on /game.

  const queue = page.getByTestId('incident-queue');
  await expect(queue).toBeVisible();
  await expect(queue).toContainText(vehicle.callSign);
  const action = queue.getByTestId('idle-suggestion-action');
  await expect(action).toBeVisible();
  await action.click();
  await expect(page).toHaveURL(/\/game\/logistics/);
});
