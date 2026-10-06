import { expect, test, type Page } from '@playwright/test';
import { bootCareer, goTo, qa, trackProblems } from './helpers';

/**
 * Progression, phase 3 (study 06, 09 §2.2): the weekly objectives with everyone's contribution, the XP ledger with its
 * sources, the weekly ranking (top 20, my place, who carried it), the Monday rollover, the off switch of the ranking.
 */
trackProblems();

type Ally = { careerId: string; directorName: string };
type Alliance = { id: string; tag: string; name: string };

async function setupAlliance(page: Page, project: string): Promise<{ alliance: Alliance; allies: Ally[] }> {
  await bootCareer(page, project, { level: 5, credits: 5000 });
  const suffix = `${Date.now()}`.slice(-2);
  const alliance = await qa<Alliance>(page, 'foundAlliance', {
    name: `Abruzzo Soccorso ${suffix}`,
    tag: `AB${suffix}`,
  });
  const allies: Ally[] = [];
  for (const [name, city] of [
    ['Marta', 'Chieti'],
    ['Luca', 'Teramo'],
  ] as const) {
    const ally = await qa<Ally>(page, 'simulateAlly', name, { level: 5, city, onDuty: true });
    await qa(page, 'allyRequestJoin', ally.careerId, alliance.id);
    allies.push(ally);
  }
  return { alliance, allies };
}

const openAlliance = async (page: Page) => {
  await goTo(page, 'Alleanza', true);
  await expect(page.getByRole('heading', { level: 1, name: 'Alleanza' })).toBeVisible();
};

test('objectives with contributions, the XP ledger, the ranking with my place, the rollover, the off switch', async ({
  page,
}, info) => {
  const { allies } = await setupAlliance(page, info.project.name);
  await openAlliance(page);

  // Three objectives sized on the members; my contribution lands through the stream.
  const objectives = page.getByTestId('alliance-objectives');
  await expect(objectives).toBeVisible();
  await expect(objectives.getByTestId('objective')).toHaveCount(3);
  await qa(page, 'objectiveProgress', 'VOLUME', null, 4);
  const volume = objectives.locator('[data-testid="objective"][data-type="VOLUME"]');
  await expect(volume.getByTestId('objective-progress')).toContainText('4 /');
  await expect(volume.getByTestId('objective-mine')).toContainText('4');
  await volume.getByTestId('objective-contributions-toggle').click();
  await expect(volume.getByTestId('objective-contributions')).toContainText('QA');

  // The XP ledger says where the points came from; the level bar follows the alliance.
  await qa(page, 'allianceXp', 120);
  const xp = page.getByTestId('alliance-xp');
  await expect(xp).toBeVisible();
  await expect(xp.getByTestId('xp-entry').first()).toContainText('+120');

  // Ranking: eleven simulated alliances, three scoring members here → my alliance has a place and its top contributors.
  await qa(page, 'simulateRanking', 11);
  await qa(page, 'addWeeklyPoints', null, 120);
  await qa(page, 'addWeeklyPoints', allies[0]!.careerId, 80);
  await qa(page, 'addWeeklyPoints', allies[1]!.careerId, 50);
  await page.getByTestId('alliance-tab-ranking').click();
  const mine = page.getByTestId('ranking-mine');
  await expect(mine).toBeVisible();
  const position = Number(await mine.getAttribute('data-position'));
  expect(position).toBeGreaterThan(0);
  await expect(page.getByTestId('ranking-top')).toContainText('Marta');
  await expect(page.locator('[data-testid="ranking-row"][data-mine="true"]')).toHaveCount(1);
  expect(await page.getByTestId('ranking-row').count()).toBeGreaterThanOrEqual(11);

  // Monday: last week's place is kept, the objectives start over.
  await qa(page, 'weeklyRollover');
  await expect(page.getByTestId('ranking-last-week')).toContainText(`#${position}`);
  await page.getByTestId('alliance-tab-overview').click();
  await expect(
    objectives.locator('[data-testid="objective"][data-type="VOLUME"]').getByTestId('objective-progress'),
  ).toContainText('0 /');

  // The ranking has its own switch (06 §3.4).
  await qa(page, 'setFlag', 'alliance_ranking', false);
  await page.reload();
  await expect(page.getByTestId('alliance-section')).toBeVisible();
  await page.getByTestId('alliance-tab-ranking').click();
  await expect(page.getByTestId('alliance-off-ranking')).toBeVisible();
});
