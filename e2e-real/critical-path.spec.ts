import { expect, test } from '@playwright/test';
import {
  cli,
  careerIdOf,
  createCareer,
  creditsOf,
  dismissOutcomes,
  dismissUnlockCelebrations,
  goTo,
  signUp,
  speedUp,
  trackProblems,
  uniqueAccount,
  waitFor,
} from './helpers';

/**
 * The critical path against the REAL backend, in both layouts:
 * sign up with a one-time code read from Mailpit → pick Pescara and a real starter site → the scripted first
 * mission (dispatch, movement over an OSRM route, arrival, resolution, reward) → buy a second vehicle →
 * reload and let the socket reconnect with the state intact → unlock the second service family.
 *
 * Every wait polls state. The only "sleep" in the file is Playwright's own auto-retrying `expect`.
 */

trackProblems();

test('critical path: sign-up → career → first mission → reward → purchase → reload → second family', async ({
  page,
}, info) => {
  const account = uniqueAccount(info.project.name);
  // Only the unlock celebrations are auto-dismissed for now: this spec asserts its OWN mission outcome below, and a
  // handler would close that modal before the assertion could see it. `dismissOutcomes` is armed right after.
  await dismissUnlockCelebrations(page);

  await test.step('sign up with a real OTP e-mail', async () => {
    await signUp(page, account);
  });

  await test.step('onboarding on the real geodata: Pescara and three starter sites', async () => {
    await createCareer(page);
  });

  const careerId = await careerIdOf(page);

  await test.step('the server generated the scripted first mission', async () => {
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'WELCOME');
    // The incident count lives in the queue (the sheet's summary row on phones), not in the top bar any more.
    await expect(page.getByTestId('incident-card')).toHaveCount(1);
    // Catalog texts come from GET /public/i18n/catalog/:locale — a missing bundle would leave a humanised key here.
    await expect(page.getByTestId('incident-card').first()).not.toContainText(/incident\.[A-Z_]+/);
    await page.getByTestId('tutorial-start').click();
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'SELECT_INCIDENT');
  });

  await test.step('dispatch the recommended set', async () => {
    await page.getByTestId('incident-card').first().click();
    await expect(page.getByTestId('incident-inspector')).toBeVisible();
    await expect(page.getByTestId('dispatch-option')).toHaveCount(1);
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'DISPATCH');
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('assigned-vehicle')).toHaveCount(1);
  });

  await test.step('the vehicle really drives: PREPARING → EN_ROUTE → ON_SCENE over an OSRM route', async () => {
    await expect(page.getByTestId('assigned-vehicle')).toHaveAttribute('data-vehicle-status', 'EN_ROUTE', {
      timeout: 180_000,
    });
    // The route the server planned is drawn on the map (straight-line fallback would still be a line, but the
    // movement itself must be interpolated by the client from the server's plan).
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-status', 'ON_SCENE', {
      timeout: 300_000,
    });
    await expect(page.getByTestId('assigned-vehicle')).toHaveAttribute('data-vehicle-status', 'ON_SCENE');
  });

  let creditsAfterReward = 0;
  await test.step('outcome and reward arrive over the socket', async () => {
    const modal = page.getByTestId('outcome-modal');
    await expect(modal).toBeVisible({ timeout: 300_000 });
    await expect(modal.getByTestId('outcome-stars')).toHaveAttribute('data-stars', /[0-3]/);
    await expect(modal.getByTestId('outcome-net')).toContainText('+');
    await page.getByTestId('outcome-continue').click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'BUY_VEHICLE');
    creditsAfterReward = await creditsOf(page);
    expect(creditsAfterReward).toBeGreaterThan(400);
    // From here on background missions may finish at any time: let their modals be dismissed automatically.
    await dismissOutcomes(page);
  });

  await test.step('buy a second vehicle through the shop', async () => {
    // A support grant through the real ledger: the tutorial reward alone does not cover the 800-credit engine.
    cli('career:grant', careerId, '--credits=3000');
    await expect.poll(() => creditsOf(page), { timeout: 30_000 }).toBeGreaterThan(creditsAfterReward);

    await goTo(page, 'Acquisti');
    await expect(page).toHaveURL(/\/game\/shop$/);
    const engine = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]');
    await expect(engine).toHaveAttribute('data-unlocked', 'true');
    await engine.getByTestId('buy-vehicle').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'ordinato' })).toBeVisible();
    // The balance itself is NOT compared before/after: the world keeps paying rewards while the test clicks, so a
    // total can legitimately go up during a purchase. What the purchase produced is asserted where it is
    // unambiguous — the vehicle below, and the `Acquisto di un mezzo` row in the ledger at the end.
  });

  await test.step('the delivery is finished with a paid speed-up and the vehicle joins the fleet', async () => {
    await goTo(page, 'Flotta');
    await expect(page.getByText('APS 2', { exact: true })).toBeVisible();
    await page.getByText('APS 2', { exact: true }).first().click();
    // The real speed-up: the server charges the ledger and runs the normal delivery handler — the same code path a
    // natural finish takes, three real minutes sooner.
    const outcome = await speedUp(page);
    // The delivery is over — assert THAT, not the count of available vehicles: the world keeps generating incidents,
    // so the first engine may well be out on a call at this moment.
    await expect(page.getByTestId('vehicle-inspector')).not.toHaveAttribute(
      'data-vehicle-status',
      'IN_DELIVERY',
      { timeout: 180_000 },
    );
    // A speed-up under `economy.speedup.freeBelowSeconds` is free and writes no ledger row at all, and one that
    // arrived after a natural finish charges nothing either — so the charge is not asserted here. What matters is
    // that the delivery is over, which the assertion above proves.
    expect(['paid', 'already-done']).toContain(outcome);
  });

  await test.step('reload: session restored from the refresh cookie, socket reconnects, state intact', async () => {
    const credits = await creditsOf(page);
    // Opening a vehicle from the fleet list selects it on the operations map, so the current route is whatever the
    // previous step left: capture it instead of assuming, and assert the reload lands back on the same screen.
    const url = page.url();
    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId('topbar')).toBeVisible();
    // The balance survives the reload. It may also have GROWN in the meantime (the world keeps paying), so the
    // assertion is "at least what it was", never "exactly".
    await expect.poll(() => creditsOf(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(credits);
    await expect(page.getByTestId('tutorial')).toHaveCount(0);
    await goTo(page, 'Flotta');
    await expect(page.getByText('APS 2', { exact: true })).toBeVisible();
    // The realtime channel is live again (no reconnection / polling banner).
    await expect(page.getByTestId('connection-banner')).toHaveCount(0, { timeout: 60_000 });
  });

  await test.step('second family unlock: EMS becomes available at its level', async () => {
    cli('career:grant', careerId, '--xp=4000');
    await goTo(page, 'Acquisti');
    const ems = page.locator('[data-testid="family-card"][data-family="EMS"]');
    await expect(ems).toHaveAttribute('data-unlocked', 'true', { timeout: 120_000 });
    // …and its catalog is listed (the level gate is gone; a facility gate may still block the purchase itself).
    // The unlock celebration is modal and is dismissed by `dismissUnlockCelebrations`.
    await ems.click();
    await expect(page.locator('[data-testid="vehicle-offer"][data-code="EMS_MSB"]')).toBeVisible();
  });

  await test.step('the ledger recorded every movement of this run', async () => {
    await goTo(page, 'Bilancio', true);
    await expect(page.getByText('Fondo iniziale').first()).toBeVisible();
    await expect(page.getByText('Acquisto di un mezzo').first()).toBeVisible();
    await expect(page.getByText('Ricompensa di missione').first()).toBeVisible();
    await waitFor('a non-empty balance', async () => (await creditsOf(page)) > 0);
  });
});
