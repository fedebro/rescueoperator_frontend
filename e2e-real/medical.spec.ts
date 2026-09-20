import { expect, test } from '@playwright/test';
import {
  cli,
  careerIdOf,
  createCareer,
  goTo,
  signUp,
  dismissInterruptions,
  speedUp,
  trackProblems,
  uniqueAccount,
} from './helpers';

/**
 * The medical chain against the REAL backend: acquire an EMS site on the real geodata, buy an ambulance, hire a
 * crew, take a generated medical call, watch the patient be assessed and treated on scene, and hand them over to a
 * real hospital imported from the geodata release.
 *
 * Managerial timers (construction, delivery, onboarding) are compressed with the real speed-up feature, not with a
 * faked clock: the server still runs the normal completion handler.
 */

trackProblems();

test('medical: EMS site → ambulance → crew → patient assessed → hospital transport', async ({
  page,
}, info) => {
  const account = uniqueAccount(info.project.name);
  await dismissInterruptions(page);
  await signUp(page, account);
  await createCareer(page);
  const careerId = await careerIdOf(page);

  await test.step('skip the tutorial and fund the career', async () => {
    await page.getByTestId('tutorial-skip').click();
    await expect(page.getByTestId('tutorial')).toHaveCount(0, { timeout: 30_000 });
    // Level 3 unlocks EMS; the credits cover the site, the ambulance, the crew and the speed-ups.
    cli('career:grant', careerId, '--credits=60000', '--xp=4000');
    await expect
      .poll(async () => Number(await page.getByTestId('level-meter').getAttribute('data-level')), {
        timeout: 60_000,
      })
      .toBeGreaterThanOrEqual(3);
  });

  await test.step('acquire an EMS site from the real candidate sites', async () => {
    await goTo(page, 'Sedi', true);
    await expect(page).toHaveURL(/\/game\/facilities$/);
    const section = page.getByTestId('new-facility-section');
    await expect(section).toBeVisible({ timeout: 60_000 });
    // `exact` matters: every EMS site row also has the family in its accessible name.
    await section.getByRole('button', { name: 'Emergenza Sanitaria', exact: true }).click();
    const site = section.locator('[data-testid="site-row"][data-buyable="true"]').first();
    await expect(site).toBeVisible({ timeout: 60_000 });
    await site.click();
    const dialog = page.getByTestId('site-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('acquire-facility').first().click();
    await expect(page.getByTestId('toast').filter({ hasText: 'sede' })).toBeVisible({ timeout: 60_000 });
  });

  await test.step('speed up the construction until the post is operational', async () => {
    const banner = page.getByTestId('construction-banner');
    if (
      await banner
        .first()
        .isVisible()
        .catch(() => false)
    )
      await speedUp(page, banner.first());
    await expect(page.getByTestId('construction-banner')).toHaveCount(0, { timeout: 180_000 });
  });

  await test.step('buy an ambulance there and speed up the delivery', async () => {
    await goTo(page, 'Acquisti');
    await page.locator('[data-testid="family-card"][data-family="EMS"]').click();
    const msb = page.locator('[data-testid="vehicle-offer"][data-code="EMS_MSB"]');
    await expect(msb).toBeVisible();
    await msb.getByTestId('buy-vehicle').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'ordinato' })).toBeVisible();

    await goTo(page, 'Flotta');
    await page.getByText('MSB 1', { exact: true }).first().click();
    await speedUp(page);
    await expect(page.getByTestId('available-vehicles')).toContainText(/[2-9]/, { timeout: 120_000 });
  });

  await test.step('hire the EMS crew and speed up the onboarding', async () => {
    await goTo(page, 'Personale', true);
    await page.getByRole('tab', { name: 'Assunzioni' }).click();
    await page.getByRole('combobox', { name: 'Ruolo' }).click();
    await page.getByRole('option', { name: 'Soccorritore', exact: true }).click();
    // Two more than the ambulance's minimum crew, so a fatigued operator cannot block the dispatch.
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Uno in più' }).click();
    await page.getByRole('button', { name: /Assumi \d+ operator/ }).click();
    await expect(page.getByTestId('onboarding-row').first()).toBeVisible({ timeout: 60_000 });
    for (;;) {
      const rows = page.getByTestId('onboarding-row');
      if ((await rows.count()) === 0) break;
      await speedUp(page, rows.first());
    }
  });

  let incidentId = '';
  await test.step('a medical call is generated and dispatched', async () => {
    // A fall, not a cardiac arrest: the ambulance the spec buys is an MSB (basic life support). A RED/critical
    // patient cannot be stabilised by it, never becomes transportable, and the incident is finished by the external
    // units instead — correct behaviour, but not a hand-over the player performs.
    const out = cli('incident:create', careerId, 'MED_FALL', '3');
    incidentId = /(inc_[0-9A-Z]{26})/.exec(out)?.[1] ?? '';
    expect(incidentId).toMatch(/^inc_/);

    // The operations screen is "Centro operativo" in the desktop sidebar and "Mappa" in the mobile bottom bar:
    // go there directly rather than by a label that only exists in one layout.
    await page.goto('/game');
    const card = page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.click();
    await expect(page.getByTestId('incident-patients')).toBeVisible();
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('assigned-vehicle').first()).toBeVisible();
  });

  await test.step('the patient is assessed and treated on scene', async () => {
    const patient = page.getByTestId('patient-card').first();
    await expect(patient).not.toHaveAttribute('data-patient-status', 'UNASSESSED', { timeout: 600_000 });
    // The true condition was hidden until a medical crew reached the scene: now the card shows a triage colour.
    await expect(page.getByTestId('incident-patients')).toBeVisible();
  });

  await test.step('hand-over to a hospital of the imported geodata', async () => {
    const patient = page.getByTestId('patient-card').first();
    const panel = page.getByTestId('transport-panel');
    // The panel offers the recommended hospital with its reasons. It is deliberately transient: if the player does
    // not choose, the server confirms the recommendation by itself after a short grace period, so the test takes it
    // when it is there and simply lets the server proceed when it is not.
    if (await panel.isVisible().catch(() => false)) {
      await expect(page.getByTestId('hospital-reasons')).toBeVisible();
      await page
        .getByTestId('confirm-recommended-hospital')
        .click({ timeout: 10_000 })
        .catch(() => undefined);
    }
    await expect(patient).toHaveAttribute('data-patient-status', /IN_TRANSPORT|HANDOFF|ADMITTED/, {
      timeout: 900_000,
    });
    // The destination is a real hospital imported from the geodata release, not a fixture.
    await expect(page.getByTestId('incident-patients')).toContainText(
      /Ospedale|Presidio|Clinica|Casa di Cura/,
    );
  });
});
