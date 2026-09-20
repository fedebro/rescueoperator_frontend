import { expect, test } from '@playwright/test';
import { bootCareer, goTo, hideDevToolsBadge, isMobile, qa, trackProblems } from './helpers';

/**
 * Facilities, in both layouts: a candidate site picked ON THE MAP (side inspector on desktop, bottom sheet on mobile) →
 * acquisition → construction countdown → OPERATIONAL → an upgrade with its build timer → promotion checklist →
 * a vehicle transferred to the new facility (from the fleet page), plus the list flow of the facilities page.
 */
trackProblems();
test.beforeEach(async ({ page }) => {
  await hideDevToolsBadge(page);
});

test('acquire a facility from a candidate site, upgrade it and transfer a vehicle', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await bootCareer(page, testInfo.project.name, { level: 3, credits: 60_000 });

  let siteId = '';
  await test.step('facilities page: nearby candidate sites, real vs generated, locked options', async () => {
    await goTo(page, 'Sedi', true);
    await expect(page.getByTestId('facility-detail')).toBeVisible();
    await expect(page.getByTestId('capacity-bar')).toHaveCount(6);
    await expect(page.getByTestId('promotion-card')).toHaveAttribute('data-state', 'LOCKED');
    await expect(page.getByTestId('promotion-requirement')).toHaveCount(3);
    const section = page.getByTestId('new-facility-section');
    await expect(section.getByTestId('site-row').first()).toBeVisible();
    expect(await section.getByTestId('site-row').count()).toBeGreaterThanOrEqual(13);
    await expect(section.locator('[data-testid="site-origin"][data-real="true"]').first()).toBeVisible();
    await expect(section.locator('[data-testid="site-origin"][data-real="false"]').first()).toBeVisible();
    // a POLICE site is visible but locked at level 3
    await section.getByRole('button', { name: 'Polizia', exact: true }).click();
    const police = section.getByTestId('site-row').first();
    await expect(police).toHaveAttribute('data-buyable', 'false');
    await police.click();
    const dialog = page.getByTestId('site-dialog');
    await expect(dialog.getByTestId('site-option-locked').first()).toContainText('livello 6');
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
    // the generated FIRE site in the north is the one we will buy — from the map
    await section.getByRole('button', { name: 'Vigili del Fuoco', exact: true }).click();
    const north = section.getByTestId('site-row').filter({ hasText: 'Via Nazionale Adriatica Nord' });
    siteId = (await north.getAttribute('data-site-id')) ?? '';
    expect(siteId).toMatch(/^sit_/);
    await north.click();
    await page.getByTestId('site-dialog').getByRole('button', { name: 'Mostra sulla mappa' }).click();
  });

  let facilityName = '';
  await test.step('map: "new facility" mode, site inspector, acquisition', async () => {
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('new-facility-banner')).toBeVisible();
    const inspector = page.getByTestId('site-inspector');
    await expect(inspector).toHaveAttribute('data-site-id', siteId);
    if (isMobile(page)) await expect(page.getByTestId('bottom-sheet')).toContainText('Sito disponibile');
    facilityName = (await inspector.getByTestId('inspector-title').textContent()) ?? '';
    await expect(inspector.locator('[data-testid="site-origin"]')).toHaveAttribute('data-real', 'false');
    const local = inspector.locator('[data-testid="site-option"][data-type="FIRE_LOCAL_STATION"]');
    await expect(local).toHaveAttribute('data-available', 'true');
    await expect(
      inspector
        .locator('[data-testid="site-option"][data-type="FIRE_DETACHMENT"]')
        .getByTestId('site-option-locked'),
    ).toContainText('livello 7');
    const before = await page.getByTestId('credits').textContent();
    await local.getByTestId('acquire-facility').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'sede acquisita' })).toBeVisible();
    // the site became a facility under construction: mode off, facility inspector with countdown
    const facility = page.getByTestId('facility-inspector');
    await expect(facility).toHaveAttribute('data-facility-status', 'UNDER_CONSTRUCTION');
    await expect(facility.getByTestId('construction-banner').getByTestId('countdown')).toBeVisible();
    await expect(page.getByTestId('new-facility-mode')).toBeVisible();
    await expect(page.getByTestId('credits')).not.toHaveText(before ?? '');
  });

  await test.step('construction ends → OPERATIONAL; upgrade with build timer', async () => {
    await qa(page, 'fastForward', 600);
    await expect(page.getByTestId('facility-inspector')).toHaveAttribute(
      'data-facility-status',
      'OPERATIONAL',
    );
    await page.getByTestId('facility-inspector').getByRole('link', { name: 'Gestisci la sede' }).click();
    await expect(page).toHaveURL(/\/game\/facilities\?id=fac_/);
    const detail = page.getByTestId('facility-detail');
    await expect(detail.getByRole('heading', { name: facilityName })).toBeVisible();
    await expect(detail.getByTestId('construction-banner')).toHaveCount(0);
    const garage = detail.getByTestId('upgrade-offer').first();
    await garage.getByRole('button', { name: /Costruisci/ }).click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Lavori avviati' })).toBeVisible();
    await expect(garage.getByTestId('countdown')).toBeVisible();
    const ground = detail.locator('[data-testid="capacity-bar"][data-domain="GROUND"]');
    const total = Number(await ground.getAttribute('data-total'));
    await qa(page, 'fastForward', 900);
    await expect(ground).toHaveAttribute('data-total', String(total + 2));
    await expect(garage).toContainText('Liv. 1/');
  });

  await test.step('fleet: transfer the fire engine to the new facility', async () => {
    await goTo(page, 'Flotta');
    await page.getByTestId('transfer-vehicle').first().click();
    const dialog = page.getByTestId('transfer-dialog');
    await expect(dialog.locator('[data-testid="transfer-target"][data-state="CURRENT"]')).toBeDisabled();
    const target = dialog.locator('[data-testid="transfer-target"][data-state="OK"]');
    await expect(target).toContainText(facilityName);
    await target.click();
    await expect(page.getByTestId('toast').filter({ hasText: 'in trasferimento' })).toBeVisible();
    await expect(page.getByTestId('transfer-vehicle').first()).toBeDisabled();
    await qa(page, 'fastForward', 300);
    await expect(page.getByTestId('transfer-vehicle').first()).toBeEnabled();
    await goTo(page, 'Sedi', true);
    await page
      .getByRole('button', { name: new RegExp(facilityName) })
      .first()
      .click();
    await expect(
      page.getByTestId('facility-detail').locator('[data-testid="capacity-bar"][data-domain="GROUND"]'),
    ).toHaveAttribute('data-used', '2');
  });
});
