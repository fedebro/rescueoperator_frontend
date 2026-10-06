import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Alliance chat, phase 2 (study 03 §3–4, 09 §3): a full-screen page with the composer glued to the keyboard, quick
 * phrases, @ mentions through the member picker, the filter's rejection kept in the composer with Riprova, the message
 * menu (Segnala, Silenzia), who is on duty, no toast for messages, the unread badge on the section tab.
 */
trackProblems();

type Ally = { careerId: string; directorName: string };
type Alliance = { id: string; tag: string; name: string };

/** A level-5 Director founds an alliance through the mock, Marta joins, writing is enabled (rules, age). */
async function setupAlliance(page: Page, project: string): Promise<{ alliance: Alliance; marta: Ally }> {
  await bootCareer(page, project, { level: 5, credits: 5000 });
  const suffix = `${Date.now()}`.slice(-2);
  const alliance = await qa<Alliance>(page, 'foundAlliance', {
    name: `Abruzzo Soccorso ${suffix}`,
    tag: `AB${suffix}`,
  });
  const marta = await qa<Ally>(page, 'simulateAlly', 'Marta', { level: 4, city: 'Chieti', onDuty: true });
  await qa(page, 'allyRequestJoin', marta.careerId, alliance.id);
  await qa(page, 'enableWriting');
  return { alliance, marta };
}

const back = async (page: Page) => {
  if (isMobile(page)) await page.getByTestId('chat-back').click();
  else await goTo(page, 'Alleanza');
  await expect(page.getByTestId('alliance-section')).toBeVisible();
};

const openAlliance = async (page: Page) => {
  await goTo(page, 'Alleanza', true);
  await expect(page.getByRole('heading', { level: 1, name: 'Alleanza' })).toBeVisible();
};

test('send and receive, quick phrase, mention picker, filter rejection → Riprova, presence, back, unread, menu', async ({
  page,
}, info) => {
  const { marta } = await setupAlliance(page, info.project.name);
  await openAlliance(page);
  await page.getByTestId('alliance-tab-chat').click();
  await expect(page).toHaveURL(/\/game\/alliance\/chat/);
  const composer = page.getByTestId('chat-composer');
  await expect(composer).toBeVisible();
  const messages = page.getByTestId('chat-message');

  // Mine goes out and the draft empties.
  await composer.fill('Ciao a tutti, sono in servizio');
  await page.getByTestId('chat-send').click();
  await expect(messages.filter({ hasText: 'Ciao a tutti, sono in servizio' })).toHaveAttribute(
    'data-mine',
    'true',
  );
  await expect(composer).toHaveValue('');

  // Marta's lands through the stream — and no toast (09 §3 #6: messages never toast).
  await qa(page, 'allyMessage', marta.careerId, 'Arrivo subito con l’APS');
  await expect(messages.filter({ hasText: 'Arrivo subito' })).toBeVisible();
  await expect(page.getByTestId('toast').filter({ hasText: 'Arrivo subito' })).toHaveCount(0);

  // A quick phrase is one tap and travels as QUICK.
  await page.getByTestId('quick-COMING').click();
  const quick = page.locator('[data-testid="chat-message"][data-kind="QUICK"]');
  await expect(quick).toHaveCount(1);
  await expect(quick).toContainText('Arrivo');

  // @ opens the member picker; picking inserts the name.
  await composer.pressSequentially('Grazie @Ma');
  const picker = page.getByTestId('mention-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('option', { name: /Marta/ }).click();
  await expect(composer).toHaveValue('Grazie @Marta ');
  await page.getByTestId('chat-send').click();
  await expect(messages.filter({ hasText: 'Grazie @Marta' })).toHaveAttribute('data-mine', 'true');

  // The filter says no to a phone number: the text stays, the button becomes Riprova; editing clears the state.
  await composer.fill('Chiamami al 3331234567');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-unsent')).toBeVisible();
  await expect(composer).toHaveValue('Chiamami al 3331234567');
  await expect(page.getByTestId('chat-send')).toHaveAccessibleName('Riprova');
  await composer.fill('Ci sentiamo qui in chat');
  await expect(page.getByTestId('chat-unsent')).toHaveCount(0);
  await page.getByTestId('chat-send').click();
  await expect(messages.filter({ hasText: 'Ci sentiamo qui in chat' })).toBeVisible();

  // Who is here: Marta on duty.
  await page.getByTestId('chat-presence-button').click();
  await expect(page.getByTestId('chat-presence')).toContainText('Marta');
  await page.keyboard.press('Escape');

  // Phone: the keyboard-aware screen keeps the composer in view while typing (09 §3 #1).
  if (isMobile(page)) {
    await composer.focus();
    await expect(composer).toBeInViewport();
    await expect(page.getByTestId('chat-send')).toBeInViewport();
  }

  // Back to the section (the header's back button is the phone's; desktop has the navigation); a message landing
  // meanwhile bumps the chat badge; opening the chat reads it.
  await back(page);
  await expect(page.getByTestId('alliance-section')).toBeVisible();
  await qa(page, 'allyMessage', marta.careerId, 'Siete ancora lì?');
  await expect(page.getByTestId('alliance-tab-unread-chat')).toHaveText('1');
  await page.getByTestId('alliance-tab-chat').click();
  await expect(messages.filter({ hasText: 'Siete ancora lì?' })).toBeVisible();

  // The message menu on hers: Segnala (one tap, the outcome comes back as a notification), then Silenzia (high role).
  const hers = messages.filter({ hasText: 'Siete ancora lì?' });
  await hers.getByTestId('message-actions').click();
  await page.getByTestId('message-report').click();
  await expect(page.getByTestId('report-form')).toBeVisible();
  await page.getByTestId('report-reason-HARASSMENT').check();
  await page.getByTestId('report-submit').click();
  await expect(page.getByTestId('report-done')).toBeVisible();
  await page.keyboard.press('Escape');
  await hers.getByTestId('message-actions').click();
  await page.getByTestId('message-mute').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'silenziato' })).toBeVisible();
  await back(page);
  await expect(page.getByTestId('alliance-tab-unread-chat')).toHaveCount(0);
});
