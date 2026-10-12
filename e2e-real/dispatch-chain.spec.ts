import { expect, test, type Page } from '@playwright/test';
import {
  careerIdOf,
  cli,
  createCareer,
  dismissInterruptions,
  dismissOutcomes,
  goTo,
  isMobile,
  signUp,
  trackProblems,
  uniqueAccount,
} from './helpers';

/**
 * Sending a vehicle that is not free, against the REAL backend (owner, 2026-10-12): the busy vehicle shows the mission it is
 * on, the queue asks for a confirmation with the server's estimate (end of the mission included), and a vehicle recalled by
 * mistake is sent back to the same emergency without waiting for it to reach its base. The mock suite (`e2e/dispatch-chain`)
 * proves the screens; this proves the real contract — the fields the server sends are the ones the screens read.
 */

trackProblems();

const incidentIdOf = (output: string): string => {
  const match = /inc_[0-9A-Z]{26}/.exec(output);
  if (!match) throw new Error(`no incident id in: ${output}`);
  return match[0];
};

async function openIncident(page: Page, incidentId: string): Promise<void> {
  await page.goto('/game');
  await expect(page.getByTestId('topbar')).toBeVisible();
  const card = page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click();
  await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
}

test('real server: busy vehicle with its mission, queue with an estimate, a recalled vehicle sent back to the same call', async ({
  page,
}, info) => {
  const account = uniqueAccount(info.project.name);
  await dismissInterruptions(page);
  await signUp(page, account);
  await createCareer(page);
  const careerId = await careerIdOf(page);
  await page.getByTestId('tutorial-skip').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0, { timeout: 30_000 });
  await dismissOutcomes(page);

  // A very far call (the way there lasts minutes) and a near one: the only vehicle of the career is sent to the far one.
  const a = incidentIdOf(cli('incident:create', careerId, 'FIRE_TRASH_BIN', '1', '7000'));
  const b = incidentIdOf(cli('incident:create', careerId, 'FIRE_TRASH_BIN', '1', '800'));

  let callSign = '';
  await test.step('the vehicle is sent to the far call and drives', async () => {
    await openIncident(page, a);
    await page.getByTestId('send-recommended').click();
    const assigned = page.getByTestId('assigned-vehicle').first();
    await expect(assigned).toBeVisible({ timeout: 30_000 });
    // "APS 1" — the row also carries the state ("In partenza"), which is not part of the name.
    callSign = /^\S+ \d+/.exec(((await assigned.textContent()) ?? '').trim())?.[0] ?? '';
    expect(callSign).not.toBe('');
    await expect(page.getByTestId('assigned-vehicle').first()).toHaveAttribute(
      'data-vehicle-status',
      'EN_ROUTE',
      {
        timeout: 180_000,
      },
    );
  });

  await test.step('the other call lists it busy: whole name, the mission it is on, then the confirmed queue with an estimate', async () => {
    await openIncident(page, b);
    const row = page.locator('[data-testid="dispatch-option"][data-busy="true"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId('dispatch-option-name')).not.toHaveText('');
    await expect(row.getByTestId('chain-mission')).toContainText('Impegnato su:');
    await expect(row.getByTestId('chain-mission')).toContainText('Incendio cassonetto');
    await row.getByTestId('chain-queue').click();
    const dialog = page.getByTestId('chain-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('chain-confirm-mission')).toContainText('Incendio cassonetto');
    // What the server estimated: free, and arrival here, as clock times; a projection (it still has to work the first call).
    await expect(dialog.getByTestId('chain-confirm-free-at')).toContainText(/Libero verso le \d\d:\d\d/);
    await expect(dialog.getByTestId('chain-confirm-arrive-at')).toContainText(
      /Arriverebbe qui verso le \d\d:\d\d/,
    );
    await expect(dialog.getByTestId('chain-confirm-approximate')).toBeVisible();
    await expect(dialog.getByTestId('chain-confirm-basis')).toHaveAttribute('data-basis', 'WORK_END');
    await dialog.getByTestId('chain-confirm-cancel').click();
    await expect(dialog).toBeHidden();
  });

  await test.step('recalled from its sheet, the vehicle can be sent back to the same call at once', async () => {
    await goTo(page, 'Flotta');
    await expect(page.getByRole('heading', { name: 'Flotta', level: 1 })).toBeVisible({ timeout: 60_000 });
    if (isMobile(page)) await page.getByTestId('vehicle-card').filter({ hasText: callSign }).first().click();
    else await page.getByRole('row').filter({ hasText: callSign }).first().click();
    await expect(page.getByTestId('vehicle-inspector')).toBeVisible();
    await page.getByTestId('recall-vehicle').click();
    await expect(page.getByTestId('vehicle-inspector')).toHaveAttribute('data-vehicle-status', 'RETURNING', {
      timeout: 30_000,
    });
    // The server says where the unit is coming back from (it used to be null while returning): the sheet offers the way back.
    const resend = page.getByTestId('resend-here');
    await expect(resend).toBeVisible({ timeout: 30_000 });
    await expect(resend.getByTestId('resend-vehicle')).toHaveText('Rimanda alla stessa emergenza');
    await resend.getByTestId('resend-vehicle').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'rimandato qui' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('vehicle-inspector')).toHaveAttribute('data-vehicle-status', 'EN_ROUTE', {
      timeout: 30_000,
    });
  });

  await test.step('and it gets there and works the call', async () => {
    await openIncident(page, a);
    await expect(page.getByTestId('assigned-vehicle').first()).toHaveAttribute(
      'data-vehicle-status',
      'ON_SCENE',
      {
        timeout: 300_000,
      },
    );
  });
});
