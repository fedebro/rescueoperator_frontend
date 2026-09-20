import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, hideDevToolsBadge, isMobile, qa, trackProblems } from './helpers';

/**
 * Second family unlock and a mixed incident, in both layouts: locked EMS in the shop → level 3 → unlock celebration →
 * EMS post acquired + ambulance bought → multi-service incident with a still-locked family (POLICE) → requirements
 * marked "external support" → dispatch of the player's own services only → RESOLVING external-support phase.
 */
trackProblems();
test.beforeEach(async ({ page }) => {
  await hideDevToolsBadge(page);
});

const incidentStatus = (page: Page, incidentId: string) =>
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          __rcMock: { qa: { career: () => { incidents: { id: string; status: string }[] } } };
        }
      ).__rcMock.qa
        .career()
        .incidents.find((i) => i.id === id)?.status ?? 'GONE',
    incidentId,
  );

test('family unlock, mixed incident and the external-support phase', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  // Slower mock clock: the RESOLVING phase must stay on screen long enough to be inspected; waits are fast-forwarded.
  await bootCareer(page, testInfo.project.name, { level: 2, credits: 30_000, speed: 4 });

  await test.step('shop: EMS is locked and says when it opens', async () => {
    await goTo(page, 'Acquisti');
    const overview = page.getByTestId('families-overview');
    await expect(overview.getByTestId('family-card')).toHaveCount(5);
    const ems = overview.locator('[data-family="EMS"]');
    await expect(ems).toHaveAttribute('data-unlocked', 'false');
    await expect(ems).toContainText('Si sblocca al livello 3');
    await expect(overview.locator('[data-family="WILDFIRE"]')).toContainText('in questo territorio');
    await ems.click();
    const ambulance = page.locator('[data-testid="vehicle-offer"][data-code="EMS_MSB"]');
    await expect(ambulance.getByTestId('locked-reason')).toContainText('livello 3');
    // domain filter: helicopters are AIR vehicles with their own movement note
    await page.getByTestId('domain-filter-AIR').click();
    await expect(page.getByTestId('vehicle-offer')).toHaveCount(1);
    await expect(page.getByTestId('air-note')).toContainText('linea retta a 240 km/h');
    await page.getByTestId('domain-filter-ALL').click();
  });

  await test.step('level 3: the unlock is celebrated', async () => {
    await qa(page, 'setLevel', 3);
    const dialog = page.getByTestId('family-unlock');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-family', 'EMS');
    await expect(dialog).toContainText('Nuovo servizio: Emergenza Sanitaria');
    await dialog.getByTestId('family-unlock-shop').click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/game\/shop\?family=EMS$/);
    await expect(page.getByTestId('families-overview').locator('[data-family="EMS"]')).toHaveAttribute(
      'data-unlocked',
      'true',
    );
    // unlocked, but there is no EMS facility yet
    const ambulance = page.locator('[data-testid="vehicle-offer"][data-code="EMS_MSB"]');
    await expect(ambulance.getByTestId('blocked-reason')).toHaveAttribute('data-reason', 'NO_FACILITY');
    await ambulance.getByRole('link', { name: 'Acquisisci una sede' }).click();
    await expect(page).toHaveURL(/\/game\/facilities\?new=EMS$/);
  });

  await test.step('acquire an EMS post, buy an ambulance', async () => {
    const section = page.getByTestId('new-facility-section');
    await expect(section.getByTestId('site-row').first()).toHaveAttribute('data-family', 'EMS');
    await section.locator('[data-testid="site-row"][data-buyable="true"]').first().click();
    const dialog = page.getByTestId('site-dialog');
    await dialog
      .locator('[data-testid="site-option"][data-type="EMS_POST"]')
      .getByTestId('acquire-facility')
      .click();
    await expect(page.getByTestId('construction-banner')).toBeVisible();
    await qa(page, 'fastForward', 600);
    await expect(page.getByTestId('construction-banner')).toBeHidden();
    await goTo(page, 'Acquisti');
    await page.getByTestId('families-overview').locator('[data-family="EMS"]').click();
    const ambulance = page.locator('[data-testid="vehicle-offer"][data-code="EMS_MSB"]');
    await expect(ambulance.getByTestId('delivery-target')).toBeVisible();
    await ambulance.getByTestId('buy-vehicle').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'ordinato' })).toBeVisible();
    await qa(page, 'fastForward', 600);
    await qa(page, 'staffAll');
  });

  let incidentId = '';
  await test.step('mixed incident: the locked family is covered by external support', async () => {
    const spawned = await qa<{ incidentId: string; externalFamilies: string[] }>(page, 'spawnMixed');
    incidentId = spawned.incidentId;
    expect(spawned.externalFamilies).toContain('POLICE');
    await goTo(page, /^(Centro operativo|Mappa)$/);
    const card = page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`);
    await expect(card.locator('[data-family="POLICE"]')).toHaveAttribute('data-external', 'true');
    await card.click();
    const inspector = page.getByTestId('incident-inspector');
    await expect(inspector.getByTestId('external-families-notice')).toContainText('Polizia');
    await inspector.getByRole('tab', { name: 'Dettagli' }).click();
    await expect(inspector.getByTestId('incident-report')).not.toBeEmpty();
    await expect(inspector.getByTestId('incident-radio')).toBeVisible();
    const police = inspector.locator('[data-testid="requirement-attribution"] [data-family="POLICE"]');
    await expect(police.getByTestId('external-badge')).toHaveText('Supporto esterno');
    await expect(
      inspector.locator('[data-testid="requirement-attribution"] [data-family="FIRE"]'),
    ).toContainText('Tuo servizio');
    await inspector.getByRole('tab', { name: 'Mezzi' }).click();
  });

  await test.step('dispatch own services → RESOLVING: system units finish, the reward is already paid', async () => {
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('assigned-vehicle').first()).toBeVisible();
    // Freeze the wall-clock driver FIRST, then step the simulation by hand: RESOLVING is a transient phase, and
    // observing it and then pausing leaves a window in which the engine can already have closed the incident.
    // `pause` only stops the background driver, so `fastForward` still advances one deterministic step at a time.
    await qa(page, 'pause');
    await expect
      .poll(
        async () => {
          const status = await incidentStatus(page, incidentId);
          if (status !== 'RESOLVING') await qa(page, 'fastForward', 3);
          return status;
        },
        { timeout: 90_000, intervals: [400] },
      )
      .toBe('RESOLVING');
    const outcome = page.getByTestId('outcome-modal');
    await expect(outcome).toBeVisible();
    await expect(outcome.getByTestId('outcome-still-resolving')).toBeVisible();
    await page.getByTestId('outcome-continue').click();
    const support = page.getByTestId('external-support');
    await expect(support).toHaveAttribute('data-phase', 'RESOLVING');
    await expect(support.getByTestId('reward-paid')).toContainText('Ricompensa già accreditata');
    await expect(support.getByTestId('external-unit').first()).toHaveAttribute(
      'data-unit-status',
      /REQUESTED|WORKING/,
    );
    await expect(support.getByTestId('road-closed').first()).toBeVisible();
    await expect(page.getByTestId('send-recommended')).toHaveCount(0);
    // The incident list page reports the phase in both layouts — as a table row on desktop and as a queue card on
    // mobile (`pages-lists.tsx` switches on `useIsDesktop`), so the assertion has to switch too.
    await goTo(page, 'Emergenze');
    if (isMobile(page))
      await expect(
        page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`),
      ).toHaveAttribute('data-status', 'RESOLVING');
    else
      await expect(page.getByRole('row').filter({ hasText: 'Incidente stradale' }).first()).toContainText(
        'In chiusura',
      );
    await qa(page, 'pause', false);
  });
});
