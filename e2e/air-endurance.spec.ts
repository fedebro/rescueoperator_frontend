import { expect, test, type Page } from '@playwright/test';
import { bootCareer, bringToastToFront, hideDevToolsBadge, qa, trackProblems } from './helpers';

/**
 * Flight endurance (air-endurance, D-22 phase 3) on both layouts: an aircraft counts minutes of flight — the dispatch
 * option says what the trip needs against what is on board and how long it can stay over the scene; a call too far for
 * its endurance is not dispatchable, and says why; over the scene it turns back at "bingo" (a toast, then its inspector
 * says it will fly back once refuelled). `setAutonomy` / `spawnAway` set up the states that take long to reach.
 */
trackProblems();

interface MockCareer {
  vehicles: { id: string; status: string; incidentId: string | null }[];
}
const vehicleOf = async (page: Page, vehicleId: string) =>
  (await qa<MockCareer>(page, 'career')).vehicles.find((v) => v.id === vehicleId);

async function openIncident(page: Page, incidentId: string) {
  await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
  await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
}
const aircraftOption = (page: Page) =>
  page.getByTestId('dispatch-option').filter({ has: page.getByTestId('dispatch-flight-note') });

test.beforeEach(async ({ page }) => {
  await hideDevToolsBadge(page);
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), async () => {
    await page.getByTestId('outcome-continue').click();
  });
  await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
    await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
  });
});

test('an aircraft: minutes of flight, time over the scene, too far to go, bingo and the way back', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 9, credits: 5000 });
  await qa(page, 'quiet');
  const [heliId] = await qa<string[]>(page, 'addVehicles', 'FIRE_HELI', 1);
  await qa(page, 'staffAll');
  // Severe weather that asks for air support: the helicopter helps (technical and water rescue, air support) without
  // covering it alone, so the job outlasts the steps.
  const near = await qa<string>(page, 'spawn', 'MULTI_SEVERE_WEATHER', 8);

  await test.step('a call that does not ask for air support: the aircraft stays grounded, and says why', async () => {
    // A fallen tree asks for technical rescue, which the helicopter carries — but nobody flies to cut a tree.
    const tree = await qa<string>(page, 'spawn', 'TECH_FALLEN_TREE', 2);
    await openIncident(page, tree);
    const option = page.getByTestId('dispatch-option').filter({
      has: page.locator('[data-testid="dispatch-ineligible"][data-blocked="AIR_SUPPORT_NOT_NEEDED"]'),
    });
    await expect(option).toHaveCount(1);
    await expect(option).toContainText('questa emergenza non richiede supporto aereo');
    await expect(option.getByRole('checkbox')).toBeDisabled();
    await expect(option).not.toContainText('Consigliato');
    await page.getByTestId('inspector-close').click();
  });

  await test.step('a call nearby: the minutes it needs against those on board, and the time over the scene', async () => {
    await openIncident(page, near);
    const option = aircraftOption(page);
    await expect(option).toHaveCount(1);
    await expect(option.getByTestId('dispatch-flight-note')).toContainText(
      /Servono \d+ min di volo · a bordo 30/,
    );
    await expect(option.getByTestId('dispatch-on-scene-minutes')).toContainText(
      /Può restare sul posto circa \d+ minuti/,
    );
    await expect(option.getByRole('checkbox')).toBeEnabled();
    await page.getByTestId('inspector-close').click();
  });

  await test.step('a call beyond its endurance: not dispatchable, and why', async () => {
    // Flight legs are compressed like every trip (×0.25): only a call far beyond the map is out of its reach.
    const far = await qa<string>(page, 'spawnAway', 'MULTI_SEVERE_WEATHER', 8, 250);
    await openIncident(page, far);
    const option = aircraftOption(page);
    await expect(option.getByTestId('dispatch-ineligible')).toHaveAttribute(
      'data-blocked',
      'ENDURANCE_INSUFFICIENT',
    );
    await expect(option.getByTestId('dispatch-on-scene-minutes')).toHaveCount(0);
    await expect(option.getByRole('checkbox')).toBeDisabled();
    await expect(option).not.toContainText('Consigliato');
    await page.getByTestId('inspector-close').click();
  });

  await test.step('over the scene it turns back at bingo; its inspector says it will fly back', async () => {
    await openIncident(page, near);
    await aircraftOption(page).getByRole('checkbox').click();
    await page.getByTestId('send-selected').click();
    await expect
      .poll(
        async () => {
          await qa(page, 'fastForward', 5);
          return (await vehicleOf(page, heliId!))?.status;
        },
        { timeout: 60_000, intervals: [400] },
      )
      .toBe('ON_SCENE');
    // Just above the reserve: the way home + the reserve is all it has, it turns back at once.
    await qa(page, 'setAutonomy', heliId, { fuel: 0.16 });
    const toast = page.getByTestId('toast').filter({ hasText: 'autonomia di volo al limite' });
    await expect(toast).toBeVisible();
    // The trip home and the refuelling take seconds at ×12: freeze the clock to look at it.
    await qa(page, 'pause', true);
    await expect(toast).toContainText('tornerà da solo');
    expect((await vehicleOf(page, heliId!))?.status).toMatch(/RETURNING|RESTOCKING|AVAILABLE/);
    // A toast pushed right after it (the first-reserve coaching line) can be in front of it on phones.
    await bringToastToFront(page, toast);
    await toast.getByTestId('toast-action').click();
    const inspector = page.getByTestId('vehicle-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId('flight-resume')).toContainText('Dopo il pieno tornerà su');
    await qa(page, 'pause', false);
  });

  await test.step('refuelled, it flies back to the call on its own', async () => {
    await expect
      .poll(
        async () => {
          await qa(page, 'fastForward', 10);
          const heli = await vehicleOf(page, heliId!);
          return heli?.incidentId === near && heli.status !== 'RETURNING' ? 'BACK' : heli?.status;
        },
        { timeout: 90_000, intervals: [400] },
      )
      .toBe('BACK');
  });
});
