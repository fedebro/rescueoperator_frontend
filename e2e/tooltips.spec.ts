import { expect, test } from '@playwright/test';
import { bootCareer, goTo, trackProblems } from './helpers';

/**
 * Hover-visible tooltips / titles on truncated names and icon-only status signals: Fleet (vehicle type name + the
 * bare TopdownGlyph icon), Personnel (locked-feature lock, team-leader crown) and Shop (vehicle name/description,
 * locked-reason). These are `title`/`aria-label` attributes rather than a Radix `Tooltip` in most of these spots —
 * Radix tooltips are hover-only with no reliable touch equivalent, so on both `desktop` and `mobile` projects we
 * assert the underlying attribute (which is present and correct regardless of pointer type) instead of trying to
 * trigger a hover state through a tap.
 */
trackProblems();

test('fleet: a vehicle with a long type name is inspectable via title', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 5000 });
  await goTo(page, 'Acquisti');
  await expect(page).toHaveURL(/\/game\/shop$/);

  // FIRE_4X4 ("Fuoristrada con modulo antincendio") is unlocked at level 2 and has a naturally long Italian name —
  // long enough to truncate in the Fleet type-name column without needing a dedicated rename QA helper.
  const offer = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_4X4"]');
  await expect(offer).toBeVisible();
  await offer.getByTestId('buy-vehicle').click();
  await expect(page.getByTestId('toast')).toBeVisible();

  await goTo(page, 'Flotta');
  await expect(page).toHaveURL(/\/game\/fleet$/);
  const longTypeName = 'Fuoristrada con modulo antincendio';
  // Both the truncated type-name text (desktop column / mobile card) and the bare TopdownGlyph vehicle icon next to
  // it carry the full type name as `title` — assert the exact attribute value, not just that some title exists.
  await expect(page.locator(`[title="${longTypeName}"]`).first()).toBeVisible();
});

test('personnel: a locked-feature icon shows a hover tooltip', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 1 });
  await goTo(page, 'Personale', true);
  await expect(page.getByRole('heading', { name: 'Personale', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Squadre e reparti' }).click();

  const locked = page.getByTestId('locked-TEAMS');
  await expect(locked).toContainText('Richiede il livello 4');
  // The lock icon already carries `aria-label` for screen readers; `title` gives a sighted mouse user the same
  // information on hover.
  await expect(locked.locator('[title="Bloccato"]')).toHaveCount(1);
});

test('personnel: a team leader crown shows a hover tooltip', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 4, credits: 5000, speed: 1 });
  await goTo(page, 'Personale', true);
  await expect(page.getByRole('heading', { name: 'Personale', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Squadre e reparti' }).click();

  await page.getByTestId('new-team').click();
  await page.getByLabel('Nome').fill('Prima partenza');
  await page.getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Squadra «Prima partenza» creata' }),
  ).toBeVisible();

  // The members dialog opens right after creation: pick two of the starter crew and make the first one leader.
  const members = page.getByTestId('member-list');
  await members.getByRole('checkbox').nth(0).click();
  await members.getByRole('checkbox').nth(1).click();
  await page.getByRole('combobox', { name: 'Caposquadra' }).click();
  await page.getByRole('option').nth(1).click();
  await page.getByTestId('save-members').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Squadra aggiornata' })).toBeVisible();

  const card = page.getByTestId('team-card');
  // The crown already carries `aria-label={t('leader')}` for screen readers; `title` makes the same "team leader"
  // information visible to a sighted mouse user on hover.
  await expect(card.locator('[title="Caposquadra"]')).toHaveCount(1);
});

test('shop: a vehicle name/description and a locked reason are inspectable via title', async ({
  page,
}, info) => {
  await bootCareer(page, info.project.name, { level: 1 });
  await goTo(page, 'Acquisti');
  await expect(page).toHaveURL(/\/game\/shop$/);

  const engine = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_APS"]');
  await expect(engine).toBeVisible();
  // Name, then description: both truncated (`truncate` / `line-clamp-2`) paragraphs carry the full text as `title`.
  await expect(engine.locator('p').first()).toHaveAttribute('title', 'Autopompa serbatoio');
  await expect(engine.locator('p').nth(1)).toHaveAttribute('title', /Mezzo base dei Vigili del Fuoco/);

  const ladder = page.locator('[data-testid="vehicle-offer"][data-code="FIRE_AS"]');
  await expect(ladder).toHaveAttribute('data-unlocked', 'false');
  await expect(ladder.getByTestId('locked-reason')).toHaveAttribute('title', /livello 5/);
});
