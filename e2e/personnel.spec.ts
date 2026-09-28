import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Personnel area on both layouts: quick hire → onboarding → roster; team with members, leader and vehicle → readiness;
 * course enrollment → completion; crew preview and blocking reason in the dispatch panel; locked features show their level.
 * Mock time runs ×1 here so the managerial timers are observable; they are completed with `qa fastForward`.
 */
trackProblems();

const openPersonnel = async (page: Page, tab?: string) => {
  await goTo(page, 'Personale', true);
  await expect(page.getByRole('heading', { name: 'Personale', level: 1 })).toBeVisible();
  if (tab) await page.getByRole('tab', { name: tab }).click();
};
const openFirstOperator = async (page: Page) => {
  if (isMobile(page)) await page.getByTestId('operator-card').first().click();
  else await page.getByRole('row').nth(1).click();
  await expect(page.getByTestId('operator-sheet')).toBeVisible();
};

test('locked features show the level that opens them; the starter crew is on the roster', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 1 });
  await openPersonnel(page);
  await expect(page.getByTestId('roster-count')).toHaveText('6 di 6 operatori');

  await openFirstOperator(page);
  const sheet = page.getByTestId('operator-sheet');
  await expect(sheet.getByTestId('fatigue-gauge')).toHaveAttribute('data-band', 'RESTED');
  await expect(sheet.getByText('Riposato')).toBeVisible();
  await expect(sheet.getByText('Assunto')).toBeVisible();
  await expect(sheet.getByTestId('action-rest')).toBeDisabled();
  await page.getByRole('button', { name: 'Chiudi' }).click();

  await page.getByRole('tab', { name: 'Squadre e reparti' }).click();
  await expect(page.getByTestId('locked-TEAMS')).toContainText('Richiede il livello 4');
  await expect(page.getByTestId('locked-DEPARTMENTS')).toContainText('Richiede il livello 12');
  await page.getByRole('tab', { name: 'Formazione' }).click();
  await expect(page.getByTestId('locked-TRAINING')).toContainText('Richiede il livello 2');
});

test('hire → team with vehicle and readiness → course → crew preview and blocked vehicle', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await bootCareer(page, info.project.name, { level: 4, credits: 5000, speed: 1 });

  await test.step('quick hire two firefighters: onboarding timer, then on the roster', async () => {
    await openPersonnel(page, 'Assunzioni');
    const hire = page.getByTestId('quick-hire');
    await hire.getByRole('button', { name: 'Uno in più' }).click();
    await expect(hire.getByTestId('hire-count')).toHaveText('2');
    await hire.getByTestId('quick-hire-submit').click();
    await expect(page.getByTestId('toast').filter({ hasText: '2 operatori assunti' })).toBeVisible();
    await expect(page.getByTestId('onboarding-row')).toHaveCount(2);
    await expect(page.getByTestId('onboarding-row').first().getByTestId('countdown')).toBeVisible();
    await expect(page.getByTestId('candidates-market')).toContainText('non esiste alcun rinnovo a pagamento');
    await qa(page, 'fastForward', 60);
    await expect(page.getByTestId('onboarding-row')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Organico' }).click();
    await expect(page.getByTestId('roster-count')).toHaveText('8 di 8 operatori');
  });

  await test.step('create a team, add members + leader, assign the vehicle: readiness is shown', async () => {
    await page.getByRole('tab', { name: 'Squadre e reparti' }).click();
    await expect(page.getByTestId('locked-DEPARTMENTS')).toBeVisible();
    await page.getByTestId('new-team').click();
    await page.getByLabel('Nome').fill('Prima partenza');
    await page.getByRole('button', { name: 'Crea', exact: true }).click();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Squadra «Prima partenza» creata' }),
    ).toBeVisible();

    // the members dialog opens right after the creation
    const members = page.getByTestId('member-list');
    await expect(members.getByRole('checkbox')).toHaveCount(8);
    for (let i = 0; i < 6; i++) await members.getByRole('checkbox').nth(i).click();
    await expect(page.getByTestId('member-count')).toHaveText('Membri 6/12');
    await page.getByRole('combobox', { name: 'Caposquadra' }).click();
    await page.getByRole('option').nth(1).click();
    await page.getByTestId('save-members').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Squadra aggiornata' })).toBeVisible();

    const card = page.getByTestId('team-card');
    await expect(card.getByTestId('team-warnings')).toContainText('Nessun mezzo assegnato');
    await card.getByRole('combobox', { name: 'Mezzo assegnato' }).click();
    await page.getByRole('option', { name: /APS 1/ }).click();
    await expect(card).toHaveAttribute('data-team-status', 'READY');
    await expect(card.getByTestId('team-readiness')).toHaveText('100%');
    await expect(card.getByText('Pronta')).toBeVisible();
  });

  await test.step('enroll an operator in a course and see it complete', async () => {
    await page.getByRole('tab', { name: 'Formazione' }).click();
    const course = page.locator('[data-course="COURSE_HEAVY_VEHICLE_LICENSE"]');
    await expect(course).toContainText('Corso patente mezzi pesanti');
    await expect(page.locator('[data-course="COURSE_SAF"]')).toContainText('Richiede il livello 12');
    await course.getByRole('button', { name: /Iscrivi a/ }).click();
    await page.getByTestId('enroll-list').getByRole('checkbox').first().click();
    await page.getByTestId('enroll-submit').click();
    await expect(
      page.getByTestId('toast').filter({ hasText: '1 operatore iscritto al corso' }),
    ).toBeVisible();
    const row = page.getByTestId('enrollment-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('countdown')).toBeVisible();
    await qa(page, 'fastForward', 200);
    await expect(page.getByTestId('enrollment-row')).toHaveCount(0);
    await expect(page.getByTestId('completed-count')).toContainText('1 corso completato');
  });

  await test.step('the dispatch panel shows the crew preview of each option', async () => {
    const incidentId = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 1);
    // A full navigation (the mock world persists): on phones the dev-server "Compiling…" pill can cover the map link.
    await page.goto('/game');
    await expect(page.getByTestId('topbar')).toBeVisible();
    // This call, not whichever random one happens to top the list.
    await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
    const preview = page.getByTestId('dispatch-option').first().getByTestId('crew-preview');
    await expect(preview).toContainText('Equipaggio 5/5 (min 3)');
    await expect(preview).toContainText('Efficienza 100%');
    await expect(preview).toHaveAttribute('data-blocked', '');
  });

  await test.step('an exhausted crew blocks the vehicle: the reason and the way to fix it are shown', async () => {
    await qa(page, 'tireAll', 95);
    const incidentId = await qa<string>(page, 'spawn', 'FIRE_VEHICLE', 2);
    expect(incidentId).toMatch(/^inc_/);
    // Re-open the panel on the NEW incident: its dispatch options are computed with the tired crew.
    // (fresh navigation: on phones the open inspector sheet covers the queue)
    await page.goto('/game');
    await expect(page.getByTestId('topbar')).toBeVisible();
    await page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).click();
    const blocked = page.getByTestId('crew-blocked-list');
    await expect(blocked).toContainText('APS 1');
    await expect(blocked.getByTestId('crew-preview')).toHaveAttribute('data-blocked', 'CREW_EXHAUSTED');
    await expect(blocked).toContainText('Equipaggio allo stremo');
    await blocked.getByTestId('crew-fix-link').click();
    await expect(page.getByRole('heading', { name: 'Personale', level: 1 })).toBeVisible();

    await openFirstOperator(page);
    const sheet = page.getByTestId('operator-sheet');
    await expect(sheet.getByTestId('fatigue-gauge')).toHaveAttribute('data-band', 'REST_REQUIRED');
    await sheet.getByTestId('action-rest').click();
    await expect(sheet.getByTestId('operator-busy')).toContainText('Riposo in corso');
    await qa(page, 'fastForward', 3000);
    await expect(sheet.getByTestId('fatigue-gauge')).toHaveAttribute('data-band', 'RESTED');
  });
});
