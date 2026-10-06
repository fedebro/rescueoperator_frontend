import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, qa, trackProblems } from './helpers';

/**
 * Alliance board, phase 2 (study 03 §2, 09 §4.1): the rules gate before the first post, announcements pinned on top,
 * notes, replies and the four reactions, Segnala / Rimuovi / Modifica from the post menu, the unread badge. Simulated
 * allies act through the same mock rules (analisi/note-agenti/alleanze-backend.md).
 */
trackProblems();

type Ally = { careerId: string; directorName: string };
type Alliance = { id: string; tag: string; name: string };

/** A level-5 Director founds an alliance through the mock (the UI rules), Marta joins. Writing is NOT enabled yet. */
async function setupAlliance(page: Page, project: string): Promise<{ alliance: Alliance; marta: Ally }> {
  await bootCareer(page, project, { level: 5, credits: 5000 });
  const suffix = `${Date.now()}`.slice(-2);
  const alliance = await qa<Alliance>(page, 'foundAlliance', {
    name: `Abruzzo Soccorso ${suffix}`,
    tag: `AB${suffix}`,
  });
  const marta = await qa<Ally>(page, 'simulateAlly', 'Marta', { level: 4, city: 'Chieti', onDuty: true });
  await qa(page, 'allyRequestJoin', marta.careerId, alliance.id);
  return { alliance, marta };
}

const openBoard = async (page: Page) => {
  await goTo(page, 'Alleanza', true);
  await expect(page.getByRole('heading', { level: 1, name: 'Alleanza' })).toBeVisible();
  await page.getByTestId('alliance-tab-board').click();
  await expect(page.getByTestId('alliance-board')).toBeVisible();
};

test('rules gate → pinned announcement → replies and reactions → report, remove, edit → unread badge', async ({
  page,
}, info) => {
  const { marta } = await setupAlliance(page, info.project.name);
  await openBoard(page);

  // The gate (04 §2.1): no composer, one line that leads to the rules screen; accepting is one tap.
  await expect(page.getByTestId('board-composer')).toHaveCount(0);
  await expect(page.getByTestId('write-blocked-RULES_NOT_ACCEPTED')).toBeVisible();
  await page.getByTestId('write-blocked-rules').click();
  const rules = page.getByTestId('community-rules');
  await expect(rules).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Sicurezza e regole della comunità');
  await expect(rules.getByRole('listitem')).toHaveCount(6);
  await expect(rules.getByTestId('rules-note-minors')).toContainText('18 anni');
  await page.getByTestId('rules-accept').click();
  await expect(page.getByTestId('rules-accepted')).toBeVisible();
  await page.keyboard.press('Escape');
  // Next check in the server's order: the account is minutes old, writing waits for 24 h.
  await expect(page.getByTestId('write-blocked-ACCOUNT_TOO_NEW')).toBeVisible();
  await qa(page, 'enableWriting');
  await page.reload();
  await expect(page.getByTestId('alliance-section')).toBeVisible();
  await page.getByTestId('alliance-tab-board').click();
  const composer = page.getByTestId('board-composer');
  await expect(composer).toBeVisible();
  await expect(composer).toContainText('15 minuti');

  // An announcement, pinned at once (coordinator).
  await composer.getByTestId('board-textarea').fill('Benvenuti nella bacheca');
  await composer.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Annuncio' }).click();
  await composer.getByTestId('board-pin-checkbox').click();
  await composer.getByTestId('board-post-button').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Annuncio pubblicato' })).toBeVisible();
  const posts = page.getByTestId('board-post');
  const mine = posts.filter({ hasText: 'Benvenuti nella bacheca' });
  await expect(mine).toHaveAttribute('data-pinned', 'true');
  await expect(mine).toHaveAttribute('data-kind', 'ANNOUNCEMENT');
  await expect(mine.getByTestId('board-pinned')).toBeVisible();
  await expect(composer.getByTestId('board-textarea')).toHaveValue('');
  const postId = (await mine.getAttribute('data-post-id'))!;

  // Marta replies and reacts through the same rules; the alliance stream brings both without a reload.
  await qa(page, 'allyReply', marta.careerId, postId, 'Grazie, ci sono');
  await expect(mine.getByTestId('board-reply')).toContainText('Grazie, ci sono');
  await qa(page, 'allyReact', marta.careerId, postId, 'ACK');
  await expect(mine.getByTestId('reaction-ACK')).toContainText('1');

  // My reply and my reaction: one tap each.
  await mine.getByTestId('reply-composer').fill('Buon turno a tutti');
  await mine.getByTestId('reply-send').click();
  await expect(mine.getByTestId('board-reply')).toHaveCount(2);
  await mine.getByTestId('reaction-WELL_DONE').click();
  await expect(mine.getByTestId('reaction-WELL_DONE')).toContainText('1');

  // Marta's note: Segnala (the outcome comes back as a notification), then Rimuovi as a high role.
  await qa(page, 'allyPost', marta.careerId, 'Stasera turno lungo, chi c’è?');
  const hers = posts.filter({ hasText: 'Stasera turno lungo' });
  await expect(hers).toBeVisible();
  const hersId = (await hers.getAttribute('data-post-id'))!;
  await hers.getByTestId('post-actions').click();
  await page.getByTestId('post-report').click();
  await expect(page.getByTestId('report-form')).toBeVisible();
  await page.getByTestId('report-reason-SPAM_SCAM').check();
  await page.getByTestId('report-submit').click();
  await expect(page.getByTestId('report-done')).toBeVisible();
  await page.keyboard.press('Escape');
  await hers.getByTestId('post-actions').click();
  await page.getByTestId('post-remove').click();
  await expect(page.locator(`[data-testid="board-post"][data-post-id="${hersId}"]`)).toContainText(
    'Post rimosso',
  );

  // Modifica within the window (15 min from the config): the post carries the "modificato" mark.
  await mine.getByTestId('post-actions').click();
  await page.getByTestId('post-edit').click();
  const form = mine.getByTestId('post-edit-form');
  await form.getByRole('textbox').fill('Benvenuti nella bacheca: qui gli avvisi del turno');
  await form.getByRole('button', { name: 'Salva' }).click();
  await expect(mine).toContainText('qui gli avvisi del turno');
  await expect(mine).toContainText('modificato');

  // Unread: a post landing while I look elsewhere bumps the badge; opening the board reads it.
  await page.getByTestId('alliance-tab-members').click();
  await qa(page, 'allyPost', marta.careerId, 'Domani esercitazione alle 9');
  await expect(page.getByTestId('alliance-tab-unread-board')).toHaveText('1');
  await page.getByTestId('alliance-tab-board').click();
  await expect(posts.filter({ hasText: 'Domani esercitazione' })).toBeVisible();
  await expect(page.getByTestId('alliance-tab-unread-board')).toHaveCount(0);
});
