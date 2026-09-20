import { expect, test } from '@playwright/test';
import {
  cli,
  careerIdOf,
  createCareer,
  creditsOf,
  dismissInterruptions,
  isMobile,
  signUp,
  trackProblems,
  uniqueAccount,
} from './helpers';

/**
 * Privileged operations against the REAL backend: a staff account signs in to `/admin`, inspects the live career and
 * posts a credit adjustment with a reason — and the PLAYER, whose tab stayed open the whole time, sees the new
 * balance arrive over the socket. This is the one path where the two halves of the product meet.
 */

trackProblems();

test('an admin credit adjustment reaches the open player tab over the socket', async ({
  browser,
  page,
}, info) => {
  const player = uniqueAccount(`${info.project.name}-player`);
  const staff = uniqueAccount(`${info.project.name}-staff`);

  await test.step('a player is in the game', async () => {
    await dismissInterruptions(page);
    await signUp(page, player);
    await createCareer(page);
  });
  const careerId = await careerIdOf(page);
  const before = await creditsOf(page);

  // A real staff account: the role is granted the way an operator would, through the CLI.
  const staffContext = await browser.newContext();
  const admin = await staffContext.newPage();
  try {
    await test.step('the staff account signs in to /admin', async () => {
      await signUp(admin, staff);
      // Sign-up lands on /onboarding; the role is granted to the freshly created user.
      cli('grant-role', staff.email, 'SUPER_ADMIN');
      // The role travels in the access token, which is re-issued by the boot refresh of the next page load — one
      // navigation after the grant is enough. (Polling with repeated `goto`s does NOT work: each one restarts the
      // page before it can hydrate and fetch, so the dashboard is never up at the sampling instant.)
      await admin.goto('/admin');
      await expect(admin.getByTestId('admin-kpis')).toBeVisible({ timeout: 90_000 });
    });

    await test.step('the dashboard reports the real system', async () => {
      await expect(admin.getByTestId('kpi-users')).toBeVisible();
      await expect(admin.getByTestId('kpi-careers')).toBeVisible();
      // The provider table is a virtualised DataTable; at phone width its rows are not laid out, so the health of
      // the real providers is asserted in the layout where it is actually readable.
      if (!isMobile(admin)) {
        await expect(admin.getByText('Percorsi (OSRM)').first()).toBeVisible();
        await expect(admin.getByText('Posta').first()).toBeVisible();
      }
    });

    await test.step('the career inspector finds the player', async () => {
      await admin.goto(`/admin/careers/${careerId}`);
      await expect(admin.getByText(player.email).first()).toBeVisible({ timeout: 60_000 });
      await expect(admin.getByText(careerId).first()).toBeVisible();
      await expect(admin.getByText(player.directorName).first()).toBeVisible();
    });

    await test.step('a credit adjustment is posted with a reason', async () => {
      await admin.getByRole('button', { name: 'Rettifica Crediti' }).click();
      await admin.getByLabel('Importo').fill('777');
      await admin.getByLabel('Motivo').fill('E2E integration check');
      await admin.getByRole('button', { name: 'Rivedi la rettifica' }).click();
      await admin.getByRole('button', { name: 'Registra la rettifica' }).click();
      await expect(admin.getByRole('button', { name: 'Rettifica Crediti' })).toBeVisible();
    });

    await test.step('the audit log records it', async () => {
      await admin.goto('/admin/audit');
      await expect(admin.getByText('E2E integration check').first()).toBeVisible({ timeout: 60_000 });
      await expect(admin.getByText('career.credit_adjustment').first()).toBeVisible();
    });
  } finally {
    await staffContext.close();
  }

  await test.step('the player sees the credits without reloading', async () => {
    await expect.poll(() => creditsOf(page), { timeout: 60_000 }).toBe(before + 777);
    // …and the movement is in the player's own ledger, described in their language. Which description depends on the
    // reason code the form defaults to (`ledger.COMPENSATION` / `ledger.ADMIN_ADJUSTMENT` / `ledger.PROMOTION`).
    await page.goto('/game/economy');
    await expect(page.getByText(/Compensazione|Rettifica del supporto|Promozione/).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
