import { expect, test } from '@playwright/test';
import { bootCareer, trackProblems } from './helpers';

/**
 * Owner, 2026-10-18 (D-141): under every facility name its municipality — the player's facilities and the sites for sale —
 * and the player renames their facilities (2–40 characters, word filter), on both layouts.
 */
trackProblems();

test('facilities carry their municipality and can be renamed', async ({ page }, info) => {
  await bootCareer(page, info.project.name, { level: 3, credits: 3000 });
  await page.goto('/game/facilities');
  const detail = page.getByTestId('facility-detail');
  await expect(detail).toBeVisible({ timeout: 60_000 });
  await expect(detail.getByTestId('facility-detail-municipality')).toHaveText('Pescara');
  await expect(page.getByTestId('facility-municipality').first()).toHaveText('Pescara');

  await test.step('the sites for sale show their municipality', async () => {
    const row = page.getByTestId('site-row').first();
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByTestId('site-municipality')).toHaveText('Pescara');
  });

  await test.step('a name too short cannot be saved, a banned word is refused with a reason', async () => {
    await detail.getByTestId('rename-facility').click();
    const dialog = page.getByTestId('rename-facility-dialog');
    await expect(dialog).toBeVisible();
    const input = dialog.getByTestId('facility-name-input');
    await input.fill('A');
    await expect(dialog.getByTestId('rename-facility-save')).toBeDisabled();
    await input.fill('Caserma merde');
    await dialog.getByTestId('rename-facility-save').click();
    await expect(dialog.getByRole('alert')).toContainText('non è consentito');
    await expect(dialog).toBeVisible();
  });

  await test.step('a good name is saved everywhere at once', async () => {
    const dialog = page.getByTestId('rename-facility-dialog');
    await dialog.getByTestId('facility-name-input').fill('  Caserma   del Porto ');
    await dialog.getByTestId('rename-facility-save').click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Sede rinominata: Caserma del Porto' }),
    ).toBeVisible();
    await expect(detail.getByRole('heading', { level: 2, name: 'Caserma del Porto' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Caserma del Porto/ }).first()).toBeVisible();
  });
});
