import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Teams, simplified (analisi/studio-2026-10-12-squadre), on both layouts: a team is the fixed crew of one vehicle.
 * Formed from the vehicle in one tap (the game proposes the crew), seen from the vehicle sheet and from the Personnel screen,
 * moved to another facility together with its vehicle — from the sheet or from the team — and dissolved at any time.
 */
trackProblems();
test.beforeEach(async ({ page }) => {
  // Level 3 opens a service: its celebration is not what these tests are about.
  await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
    await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
  });
});

const openTeams = async (page: Page) => {
  await goTo(page, 'Personale', true);
  await expect(page.getByRole('heading', { name: 'Personale', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Squadre', exact: true }).click();
};

/** Fleet page → the vehicle → its inspector (sheet on phones, right column on desktop). */
async function openVehicleInspector(page: Page) {
  await page.goto('/game/fleet');
  await expect(page.getByRole('heading', { name: 'Flotta', level: 1 })).toBeVisible({ timeout: 60_000 });
  if (isMobile(page)) await page.getByTestId('vehicle-card').first().click();
  else await page.getByRole('row').filter({ hasText: 'APS 1' }).first().click();
  const inspector = page.getByTestId('vehicle-inspector');
  await expect(inspector).toBeVisible();
  return inspector;
}

test('form the team of a vehicle, move it with the vehicle from the sheet, dissolve it', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await bootCareer(page, info.project.name, { level: 4, credits: 60_000 });
  const station = await qa<string>(page, 'buildStation');
  expect(station).toMatch(/^fac_/);

  await test.step('the screen starts from the vehicles and says a team is optional', async () => {
    await openTeams(page);
    await expect(page.getByTestId('teams-intro')).toContainText('equipaggio fisso di un mezzo');
    await expect(page.getByText('Nessuna squadra: va bene così')).toBeVisible();
    const row = page.getByTestId('team-less-vehicle');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('APS 1');
    await expect(row).toContainText('Equipaggio automatico');
    // nothing about departments any more
    await expect(page.getByText(/reparto|reparti/i)).toHaveCount(0);
  });

  await test.step('"Forma squadra": the proposal, then one tap', async () => {
    await page.getByTestId('form-team').click();
    const dialog = page.getByTestId('form-team-dialog');
    await expect(dialog.getByTestId('proposal-summary')).toContainText('5 operatori su 5 (minimo 3)');
    await expect(dialog.getByTestId('proposal-members').getByRole('listitem')).toHaveCount(5);
    await expect(dialog.getByLabel('Nome')).toHaveValue('Squadra APS 1');
    await dialog.getByTestId('confirm-form-team').click();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Squadra «Squadra APS 1» formata: 5 operatori' }),
    ).toBeVisible();
    const card = page.getByTestId('team-card');
    await expect(card).toHaveAttribute('data-team-status', 'READY');
    await expect(card.getByTestId('team-readiness')).toHaveText('100%');
    await expect(page.getByTestId('team-less-vehicle')).toHaveCount(0);
    // the leader is automatic: a crown, no warning about a missing one
    await expect(card.locator('[title="Caposquadra"]')).toHaveCount(1);
    await expect(card.getByTestId('team-warnings')).toHaveCount(0);
  });

  await test.step('the vehicle sheet shows the team, with its actions where the player looks first', async () => {
    const inspector = await openVehicleInspector(page);
    const crew = inspector.getByTestId('vehicle-crew');
    await expect(crew).toContainText('Squadra APS 1');
    await expect(crew.getByTestId('vehicle-team-manage')).toBeVisible();
    await expect(crew.getByTestId('vehicle-team-disband')).toBeVisible();
    await expect(crew.getByTestId('vehicle-form-team')).toHaveCount(0);
    await expect(inspector.getByTestId('transfer-vehicle')).toContainText('Trasferisci mezzo e squadra');
  });

  await test.step('move vehicle and team together from the vehicle sheet', async () => {
    const inspector = page.getByTestId('vehicle-inspector');
    await inspector.getByTestId('transfer-vehicle').click();
    const dialog = page.getByTestId('transfer-dialog');
    await expect(dialog.getByTestId('transfer-team-option')).toContainText(
      'Il mezzo e 5 operatori viaggiano insieme e arrivano insieme.',
    );
    await expect(dialog.locator('[data-testid="transfer-target"][data-state="CURRENT"]')).toBeDisabled();
    await dialog.locator('[data-testid="transfer-target"][data-state="OK"]').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'in trasferimento' })).toBeVisible();
  });

  await test.step('on the road the team is frozen; on arrival it is back in service at the new facility', async () => {
    await openTeams(page);
    const card = page.getByTestId('team-card');
    await expect(card.getByTestId('team-travelling')).toContainText('In viaggio verso la nuova sede');
    await expect(card.getByTestId('team-transfer')).toBeDisabled();
    await expect(card.getByTestId('edit-members')).toBeDisabled();
    await expect(card.getByTestId('team-warnings')).toContainText('non sono disponibili');
    await qa(page, 'fastForward', 3600);
    await expect(card.getByTestId('team-travelling')).toHaveCount(0);
    await expect(card).toHaveAttribute('data-team-status', 'READY');
    await expect(card.getByTestId('team-transfer')).toBeEnabled();
  });

  await test.step('dissolve it: the operators are free again and the vehicle goes back to the automatic crew', async () => {
    await page.getByTestId('team-disband').click();
    const dialog = page.getByTestId('disband-dialog');
    await expect(dialog).toContainText('Sciogliere «Squadra APS 1»?');
    await expect(dialog).toContainText('5 operatori restano in organico e tornano liberi.');
    await expect(dialog).toContainText('APS 1 resta dov’è e torna a equipaggio automatico.');
    await dialog.getByTestId('confirm-disband').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'sciolta' })).toBeVisible();
    await expect(page.getByTestId('team-card')).toHaveCount(0);
    await expect(page.getByTestId('team-less-vehicle')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Organico' }).click();
    await expect(page.getByTestId('roster-count')).toHaveText('6 di 6 operatori');
  });
});

test('move a team from its own card, and leave the team behind when only the vehicle goes', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await bootCareer(page, info.project.name, { level: 4, credits: 60_000 });
  await qa(page, 'buildStation');

  await test.step('form the team, then move it from the team card', async () => {
    await openTeams(page);
    await page.getByTestId('form-team').click();
    await page.getByTestId('confirm-form-team').click();
    const card = page.getByTestId('team-card');
    await expect(card).toHaveAttribute('data-team-status', 'READY');
    await expect(card.getByTestId('team-transfer')).toContainText('Trasferisci con il mezzo');
    await card.getByTestId('team-transfer').click();
    const dialog = page.getByTestId('transfer-team-dialog');
    await expect(dialog).toContainText('Parte insieme a APS 1');
    await expect(dialog.locator('[data-testid="team-transfer-target"][data-state="CURRENT"]')).toBeDisabled();
    await dialog.locator('[data-testid="team-transfer-target"][data-state="OK"]').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'in viaggio verso' })).toBeVisible();
    await expect(card.getByTestId('team-travelling')).toBeVisible();
    await qa(page, 'fastForward', 3600);
    await expect(card.getByTestId('team-travelling')).toHaveCount(0);
  });

  await test.step('the vehicle alone: untick "Porta con sé la squadra" and the team stays, free, without a vehicle', async () => {
    const inspector = await openVehicleInspector(page);
    await inspector.getByTestId('transfer-vehicle').click();
    const dialog = page.getByTestId('transfer-dialog');
    await dialog.getByTestId('transfer-team-option').getByRole('checkbox').click();
    await expect(dialog.getByTestId('transfer-team-option')).toContainText(
      'La squadra resta qui, libera e senza mezzo',
    );
    await dialog.locator('[data-testid="transfer-target"][data-state="OK"]').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'in trasferimento' })).toBeVisible();
    await qa(page, 'fastForward', 3600);
    await openTeams(page);
    const card = page.getByTestId('team-card');
    await expect(card.getByTestId('team-warnings')).toContainText('Nessun mezzo assegnato');
    await expect(card.getByTestId('team-travelling')).toHaveCount(0);
    // the vehicle is on its own again: it can get a new team at its new facility
    await expect(page.getByTestId('team-less-vehicle')).toHaveCount(1);
  });
});

test('from the vehicle sheet: form the team without leaving the map', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 4 });
  const inspector = await openVehicleInspector(page);
  const crew = inspector.getByTestId('vehicle-crew');
  await expect(crew).toContainText('Nessuna squadra');
  await crew.getByTestId('vehicle-form-team').click();
  await expect(page.getByTestId('form-team-dialog').getByTestId('proposal-summary')).toContainText(
    'operatori su 5',
  );
  await page.getByTestId('confirm-form-team').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'formata' })).toBeVisible();
  await expect(crew).toContainText('Squadra APS 1');
  // dissolve it from here too
  await crew.getByTestId('vehicle-team-disband').click();
  await page.getByTestId('confirm-disband').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'sciolta' })).toBeVisible();
  await expect(crew.getByTestId('vehicle-form-team')).toBeVisible();
});

test('below level 4 the vehicle sheet does not offer teams', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 3 });
  const inspector = await openVehicleInspector(page);
  await expect(inspector.getByTestId('vehicle-crew')).toContainText('Nessuna squadra');
  await expect(inspector.getByTestId('vehicle-form-team')).toHaveCount(0);
});
