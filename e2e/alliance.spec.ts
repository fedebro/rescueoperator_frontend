import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Alliances, phase 1 (study 02, 09 §2): the section in the navigation, the locked state, founding, the invite link, a
 * simulated ally joining, roles, settings, the Director card, leaving. The mock backend mirrors the server rules
 * (analisi/note-agenti/alleanze-backend.md); simulated allies act through the same rules.
 */
trackProblems();

const openAlliance = async (page: Page) => {
  await goTo(page, 'Alleanza', true);
  await expect(page.getByRole('heading', { level: 1, name: 'Alleanza' })).toBeVisible();
};

test('below level 3 the section only explains when it unlocks; the nav entry is there', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 1 });
  if (isMobile(page)) {
    // The five bottom items stay (D-34); "Alleanza" is the first row under "Altro".
    await expect(page.getByTestId('bottom-nav').getByRole('link')).toHaveCount(5);
    await page.getByTestId('bottom-nav').getByRole('link', { name: 'Altro' }).click();
    await expect(page.getByRole('main').getByRole('link').first()).toHaveAttribute('data-nav', 'alliance');
  }
  await openAlliance(page);
  await expect(page.getByTestId('alliance-locked')).toContainText('livello 3');
  await expect(page.getByTestId('alliance-find')).toHaveCount(0);
});

test('found → invite link → simulated ally joins → roles → settings → Director card → leave', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 5, credits: 5000 });
  await openAlliance(page);
  const suffix = `${Date.now()}`.slice(-5);

  // Trova is empty, Fonda is the second tab: cost and requirement in plain sight.
  await expect(page.getByTestId('alliance-none')).toBeVisible();
  await page.getByTestId('tab-found').click();
  await expect(page.getByTestId('found-requirement')).toContainText('livello 5');
  await page.getByTestId('found-name').fill(`Abruzzo ${suffix}`);
  await page.getByTestId('found-tag').fill(`ab${suffix.slice(-2)}`);
  await page.getByTestId('found-description').fill('Ci aiutiamo tra province.');
  await page.getByTestId('emblem-HEXAGON').click();
  await page.getByTestId('found-submit').click();
  await page.getByTestId('found-confirm').click();
  await expect(page.getByTestId('alliance-section')).toBeVisible();
  await expect(page.getByTestId('alliance-overview')).toContainText(`Abruzzo ${suffix}`);
  await expect(page.getByTestId('alliance-overview')).toContainText('Coordinatore');
  // 1000 Credits paid; the top bar shows the rest.
  await expect(page.getByTestId('topbar')).toContainText('4');

  // Members: the invite link, copied as a code; a simulated ally joins through it.
  await page.getByTestId('alliance-tab-members').click();
  await expect(page.getByTestId('member-row')).toHaveCount(1);
  await page.getByTestId('invite-create').click();
  const code = (await page.getByTestId('invite-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z2-9]{8,10}$/);
  const marta = await qa<{ careerId: string }>(page, 'simulateAlly', 'Marta', {
    level: 4,
    city: 'Chieti',
    onDuty: true,
  });
  await qa(page, 'allyJoin', marta.careerId, { inviteCode: code });
  // The alliance stream brings the new member without a reload.
  const rows = page.getByTestId('member-row');
  await expect(rows).toHaveCount(2);
  const martaRow = rows.filter({ hasText: 'Marta' });
  await expect(martaRow.getByTestId('member-role')).toHaveText('Membro');
  await expect(martaRow.getByTestId('member-presence')).toHaveAttribute('data-presence', 'ON_DUTY');
  await expect(martaRow).toContainText('Chieti');
  await expect(page.getByTestId('invite-code')).toBeVisible();

  // Roles: promote to Vice, then the Director card from the row.
  await martaRow.getByTestId('member-actions').click();
  await page.getByTestId('action-promote').click();
  await expect(martaRow.getByTestId('member-role')).toHaveText('Vice');
  await martaRow.getByRole('button', { name: 'Apri la scheda del Direttore' }).click();
  const card = page.getByTestId('director-card');
  await expect(card).toContainText('Chieti');
  await expect(card).toContainText('Vice');
  await expect(card).toContainText('In servizio');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // A second ally asks to join an alliance switched to "su richiesta": the request lands in Membri and is accepted.
  await page.getByTestId('alliance-settings-button').click();
  const settings = page.getByTestId('alliance-settings');
  await settings.getByLabel('Ingresso').first().click();
  await page.getByRole('option', { name: 'Su richiesta' }).click();
  await settings.getByTestId('settings-save').click();
  await expect(settings).toHaveCount(0);
  const home = await qa<{ alliance: { id: string } }>(page, 'allianceHome');
  const luca = await qa<{ careerId: string }>(page, 'simulateAlly', 'Luca', { level: 6 });
  await qa(page, 'allyRequestJoin', luca.careerId, home.alliance.id);
  await expect(page.getByTestId('alliance-tab-members')).toContainText('1');
  await expect(page.getByTestId('join-request')).toContainText('Luca');
  await page.getByTestId('request-accept').click();
  await expect(page.getByTestId('member-row')).toHaveCount(3);

  // Leaving as coordinator is refused until the role is handed over; then the cooldown shows on the empty section.
  await page.getByTestId('alliance-leave').click();
  await expect(page.getByTestId('confirm-leave')).toBeDisabled();
  await page.keyboard.press('Escape');
  await martaRow.getByTestId('member-actions').click();
  await page.getByTestId('action-transfer').click();
  await page.getByTestId('confirm-transfer').click();
  await expect(
    page.getByTestId('member-row').filter({ hasText: 'Marta' }).getByTestId('member-role'),
  ).toHaveText('Coordinatore');
  await page.getByTestId('alliance-leave').click();
  await page.getByTestId('confirm-leave').click();
  await expect(page.getByTestId('alliance-none')).toBeVisible();
  await expect(page.getByTestId('alliance-cooldown')).toBeVisible();
});

test('search, the card of an alliance and a one-tap join into an open one', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 3 });
  const suffix = `${Date.now()}`.slice(-5);
  const ally = await qa<{ careerId: string }>(page, 'simulateAlly', 'Giulia', { level: 5 });
  await qa(page, 'allyFound', ally.careerId, {
    name: `Marsica ${suffix}`,
    tag: `m${suffix.slice(-3)}`,
    joinPolicy: 'OPEN',
  });
  await qa(
    page,
    'allyFound',
    (await qa<{ careerId: string }>(page, 'simulateAlly', 'Paolo', { level: 5 })).careerId,
    {
      name: `Vestina ${suffix}`,
      tag: `v${suffix.slice(-3)}`,
      joinPolicy: 'INVITE',
      language: 'en',
    },
  );
  await openAlliance(page);
  await expect(page.getByTestId('alliance-card')).toHaveCount(2);
  await page.getByTestId('alliance-search').fill('mars');
  await expect(page.getByTestId('alliance-card')).toHaveCount(1);
  await page
    .getByTestId('alliance-card')
    .getByRole('button', { name: /Marsica/ })
    .click();
  const detail = page.getByTestId('alliance-detail');
  await expect(detail).toContainText('Liv. 1');
  await expect(detail).toContainText('1/10 membri');
  await page.getByTestId('alliance-join').click();
  await expect(page.getByTestId('alliance-section')).toBeVisible();
  await expect(page.getByTestId('alliance-overview')).toContainText(`Marsica ${suffix}`);
  await expect(page.getByTestId('alliance-overview')).toContainText('Membro');
  // The nav shows the alliance; the badge stays off (nothing unread).
  if (isMobile(page)) await expect(page.getByTestId('nav-badge-more')).toHaveCount(0);
  else await expect(page.getByTestId('nav-badge-alliance')).toHaveCount(0);
});
