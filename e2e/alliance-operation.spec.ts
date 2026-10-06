import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, qa, trackProblems } from './helpers';

/**
 * Alliance operations, phase 3 (study 07, 09 §5): the full-screen alert with Partecipa / Non ora, the start with my
 * front as a real major (the "Operazione di alleanza" strip over the coordination view), the shared board with one row
 * per front, the OPERATION chat channel, the end with the collective outcome and everyone's reward; the cancellation
 * when fewer than two join. Started by QA (the organic trigger lives on the server).
 */
trackProblems();

type Ally = { careerId: string; directorName: string };
type Alliance = { id: string; tag: string; name: string };

async function setupAlliance(
  page: Page,
  project: string,
): Promise<{ alliance: Alliance; marta: Ally; luca: Ally }> {
  await bootCareer(page, project, { level: 5, credits: 5000 });
  const suffix = `${Date.now()}`.slice(-2);
  const alliance = await qa<Alliance>(page, 'foundAlliance', {
    name: `Abruzzo Soccorso ${suffix}`,
    tag: `AB${suffix}`,
  });
  const marta = await qa<Ally>(page, 'simulateAlly', 'Marta', { level: 5, city: 'Chieti', onDuty: true });
  await qa(page, 'allyRequestJoin', marta.careerId, alliance.id);
  const luca = await qa<Ally>(page, 'simulateAlly', 'Luca', { level: 5, city: 'Teramo', onDuty: true });
  await qa(page, 'allyRequestJoin', luca.careerId, alliance.id);
  await qa(page, 'addVehicles', 'FIRE_APS', 4);
  await qa(page, 'staffAll');
  return { alliance, marta, luca };
}

test('alert → Partecipa → start → my front with the strip → board → chat channel → end → outcome', async ({
  page,
}, info) => {
  const { marta } = await setupAlliance(page, info.project.name);

  // The alert over any page: scenario, who joined, Partecipa.
  await qa(page, 'startOperation', 'MAJ_ALLIANCE_VALLEY_FLOOD', { alertSeconds: 600 });
  const alert = page.getByTestId('operation-alert');
  await expect(alert).toBeVisible();
  await expect(page.getByTestId('operation-alert-title')).toContainText(/alluvione/i);
  await expect(page.getByTestId('operation-alert-joined')).toContainText('0 partecipanti');
  await page.getByTestId('operation-alert-join').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Sei dentro' })).toBeVisible();
  await expect(alert).toHaveCount(0);

  // Marta joins, the alert ends: my front is a real major with the operation strip over its coordination view.
  await qa(page, 'allyJoinOperation', marta.careerId);
  await qa(page, 'operationAlertEnd');
  await expect(page.getByTestId('major-alert')).toBeVisible();
  await page.getByTestId('major-alert-open').click();
  const inspector = page.getByTestId('major-inspector');
  await expect(inspector).toHaveAttribute('data-status', 'ACTIVE');
  const strip = inspector.getByTestId('operation-strip');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('2 partecipanti');
  await strip.getByTestId('operation-strip-board').click();

  // The shared board: one row per front, mine marked; the operation channel in the chat.
  await expect(page).toHaveURL(/\/game\/alliance\/operation/);
  const board = page.getByTestId('operation-board');
  await expect(board.getByTestId('operation-status')).toHaveAttribute('data-status', 'ACTIVE');
  const fronts = board.getByTestId('operation-front');
  await expect(fronts).toHaveCount(3);
  await expect(page.locator('[data-testid="operation-front"][data-mine="true"]')).toHaveAttribute(
    'data-status',
    'JOINED',
  );
  await expect(fronts.filter({ hasText: 'Marta' })).toHaveAttribute('data-status', 'JOINED');
  await expect(fronts.filter({ hasText: 'Luca' })).toHaveAttribute('data-status', 'INVITED');
  await board.getByTestId('operation-chat').click();
  await expect(page).toHaveURL(/\/game\/alliance\/chat\?channel=/);
  await expect(page.getByTestId('chat-channel-OPERATION')).toBeVisible();
  await page.goto('/game/alliance/operation');
  await expect(page.getByTestId('operation-board')).toBeVisible();

  // Marta's front ends, the clock runs out: the outcome, the rewards, the trophy board.
  await qa(page, 'advanceOperation', 1);
  await expect(fronts.filter({ hasText: 'Marta' })).toContainText('Fronte chiuso');
  await qa(page, 'endOperation');
  await expect(page.getByTestId('operation-outcome-card')).toBeVisible();
  await expect(page.getByTestId('operation-outcome-card').getByTestId('operation-outcome')).toHaveAttribute(
    'data-outcome',
    /GOLD|SILVER|BRONZE|FAILED/,
  );
  await expect(page.getByTestId('operation-rewards')).toContainText('Marta');
  await expect(page.getByTestId('operation-history').locator('li').first()).toContainText(/alluvione/i);

  // The overview card remembers the outcome.
  await goTo(page, 'Alleanza', true);
  await expect(page.getByTestId('operation-card')).toHaveAttribute('data-status', 'ENDED');
  await expect(page.getByTestId('operation-card').getByTestId('operation-outcome')).toBeVisible();
});

test('Non ora: no enlistment; fewer than two joined at the end of the alert → cancelled without consequences', async ({
  page,
}, info) => {
  await setupAlliance(page, info.project.name);
  await qa(page, 'startOperation', 'MAJ_ALLIANCE_STORM_WAVE', { alertSeconds: 600 });
  await expect(page.getByTestId('operation-alert')).toBeVisible();
  await page.getByTestId('operation-alert-decline').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'non ora' })).toBeVisible();
  await expect(page.getByTestId('operation-alert')).toHaveCount(0);
  await goTo(page, 'Alleanza', true);
  const card = page.getByTestId('operation-card');
  await expect(card).toHaveAttribute('data-status', 'ALERT');
  await expect(card.getByTestId('operation-me-declined')).toBeVisible();
  await qa(page, 'operationAlertEnd');
  await expect(card).toHaveAttribute('data-status', 'CANCELLED');
  await expect(page.getByTestId('major-alert')).toHaveCount(0);
});
