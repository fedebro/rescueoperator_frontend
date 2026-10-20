import { expect, test, type Page } from '@playwright/test';
import { bootCareer, qa, trackProblems } from './helpers';

/**
 * Primo turno (D-148, study analisi/studio-2026-10-20-primi-minuti): the 5 missions of a new career in a row, with the guide
 * (one-line bubbles for missions 1–4, the shop in the middle of mission 3) and without it (same pace, no bubbles). The live
 * story tells each intervention; the outcome is a short card with the countdown to the next call — never a dialog.
 *
 * Phases are short in the simulation (×12 by default): every check of a transient phase is ONE atomic assertion on a state
 * that lasts (the bubble in front of the player until they act, the card until the next call), or a poll on the simulation.
 */
trackProblems();

interface FirstShiftState {
  completed: number;
  nextCallAt: number | null;
}
/** The wire view (`career.firstShift`): null once the shift is over. */
const shift = (page: Page) =>
  qa<{ summary: { firstShift?: unknown } }>(page, 'career').then((c) => c.summary.firstShift ?? null);
const completed = async (page: Page) =>
  (await qa<FirstShiftState | null>(page, 'firstShift'))?.completed ?? 5;

/** The open call of mission `n`, once it is in. */
async function missionCall(page: Page, n: number): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        id = await page.evaluate(
          (mission) =>
            (
              window as unknown as {
                __rcMock: {
                  qa: { career: () => { incidents: { id: string; firstShift?: { mission: number } }[] } };
                };
              }
            ).__rcMock.qa
              .career()
              .incidents.find((i) => i.firstShift?.mission === mission)?.id ?? '',
          n,
        );
        return id;
      },
      { timeout: 60_000 },
    )
    .not.toBe('');
  return id;
}

const bubble = (page: Page) => page.getByTestId('first-shift-bubble');
const card = (page: Page, id: string) =>
  page.locator(`[data-testid="incident-card"][data-incident-id="${id}"]`);

async function outcomeCard(page: Page, mission: number) {
  // The card stays until the next call is in (plus a beat), or 9 s after the last mission: long enough for one check.
  await expect(page.locator(`[data-testid="first-shift-outcome"][data-mission="${mission}"]`)).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(() => completed(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(mission);
}

test('primo turno with the guide: five missions in a row, one bubble at a time, the shop inside mission 3', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  // A slower simulation (×4) keeps every bubble on screen long enough to read it in a real browser.
  await bootCareer(page, info.project.name, { tutorialDone: false, firstShift: true, speed: 4 });
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), () => {
    throw new Error('the first shift never opens the outcome dialog');
  });

  await test.step('welcome → mission 1 (RESPOND): open the call, send the recommended, follow the story', async () => {
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'WELCOME');
    await page.getByTestId('tutorial-start').click();
    const id = await missionCall(page, 1);
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'openCall');
    await card(page, id).click();
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'sendRecommended');
    await page.getByTestId('send-recommended').click();
    // The story starts at the dispatch: the line is there for the whole intervention.
    await expect(page.getByTestId('live-story')).toBeVisible();
    await outcomeCard(page, 1);
    await expect(page.getByTestId('outcome-modal')).toHaveCount(0);
  });

  await test.step('mission 2 (CHOOSE_VEHICLE): tick the vehicle yourself, then send it', async () => {
    const id = await missionCall(page, 2);
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'openCall');
    await card(page, id).click();
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'tickVehicle');
    await page.locator('[data-testid="dispatch-option"][data-busy="false"] label').first().click();
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'sendChosen');
    await page.locator('[data-testid="send-selected"], [data-testid="send-recommended"]').first().click();
    await outcomeCard(page, 2);
  });

  await test.step('mission 3 (MULTI_VEHICLE): to the shop, buy the second engine, back to the call, send both', async () => {
    const id = await missionCall(page, 3);
    await card(page, id).click();
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'needSecond');
    await page.getByTestId('first-shift-bubble-action').click();
    await expect(page).toHaveURL(/\/game\/shop/);
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'buySecond');
    await page
      .locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]')
      .getByTestId('buy-vehicle')
      .click();
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'backToCall');
    await page.getByTestId('first-shift-bubble-action').click();
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', id);
    // Delivered in a few seconds; then both engines can leave with the starter roster (two drivers): no crew block.
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'sendBoth', { timeout: 30_000 });
    await expect(page.locator('[data-blocked="CREW_INSUFFICIENT"]')).toHaveCount(0);
    await expect(page.getByTestId('send-recommended')).toContainText('2');
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('assigned-vehicle')).toHaveCount(2);
    await outcomeCard(page, 3);
  });

  await test.step('mission 4 (REDIRECT): the engines are on their way home — send one straight to the new call', async () => {
    const id = await missionCall(page, 4);
    // The way home of mission 3 lasts ≥ 45 s on the server, ~11 s here: the clock holds while the test reads the screen
    // (commands still run; only the scheduled transitions wait).
    await qa(page, 'pause', true);
    const statuses = await qa<{ vehicles: { status: string }[] }>(page, 'career').then((c) =>
      c.vehicles.map((v) => v.status),
    );
    expect(statuses).toEqual(['RETURNING', 'RETURNING']);
    await card(page, id).click();
    await expect(bubble(page)).toHaveAttribute('data-bubble', 'redirectHere');
    await page.locator('[data-testid="chain-redirect"], [data-testid="chain-resend"]').first().click();
    await expect(page.getByTestId('assigned-vehicle')).toHaveCount(1);
    await qa(page, 'pause', false);
    await outcomeCard(page, 4);
    // The guided part ends with mission 4.
    await expect(page.getByTestId('first-shift-bubble')).toHaveCount(0);
  });

  await test.step('mission 5 (FREE): no guide; the first shift is complete, level 2', async () => {
    const id = await missionCall(page, 5);
    await card(page, id).click();
    await expect(page.getByTestId('first-shift-bubble')).toHaveCount(0);
    await page.getByTestId('send-recommended').click();
    await expect(page.getByTestId('first-shift-outcome-finished')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => shift(page)).toBeNull();
    await expect
      .poll(() => qa<{ summary: { level: number } }>(page, 'career').then((c) => c.summary.level))
      .toBeGreaterThanOrEqual(2);
  });
});

test('primo turno without the guide: «Salta» asks first, the pace stays, no bubbles', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await bootCareer(page, info.project.name, { tutorialDone: false, firstShift: true });
  await page.addLocatorHandler(page.getByTestId('outcome-modal'), () => {
    throw new Error('the first shift never opens the outcome dialog');
  });

  await test.step('«Gioca senza guida» asks for confirmation, then the guide is gone', async () => {
    await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'WELCOME');
    await page.getByTestId('tutorial-skip').click();
    const confirm = page.getByTestId('tutorial-skip-confirm');
    await expect(confirm).toContainText('Vuoi davvero giocare senza guida?');
    await expect(confirm).toContainText('Le prime missioni restano brevi');
    await page.getByTestId('tutorial-skip-confirm-button').click();
    await expect(page.getByTestId('tutorial')).toHaveCount(0);
  });

  for (const n of [1, 2, 3, 4, 5]) {
    await test.step(`mission ${n}: one call, the story, the short outcome`, async () => {
      const id = await missionCall(page, n);
      await card(page, id).click();
      await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', id);
      await expect(page.getByTestId('first-shift-bubble')).toHaveCount(0);
      // The engines may still be on their way home (mission 4 is born for that): a busy one is sent from the road.
      const redirect = page.locator('[data-testid="chain-redirect"], [data-testid="chain-resend"]').first();
      const send = page.getByTestId('send-recommended');
      await expect(redirect.or(send).first()).toBeVisible();
      if ((await send.count()) > 0 && (await send.isEnabled())) await send.click();
      else await redirect.click();
      await outcomeCard(page, n);
      // One call at a time: never a second open call of the normal generator during the shift.
      if (n < 5)
        expect(
          await page.evaluate(
            () =>
              (
                window as unknown as {
                  __rcMock: { qa: { career: () => { incidents: { firstShift?: unknown }[] } } };
                }
              ).__rcMock.qa
                .career()
                .incidents.filter((i) => !i.firstShift).length,
          ),
        ).toBe(0);
    });
  }
  await expect.poll(() => shift(page)).toBeNull();
});
