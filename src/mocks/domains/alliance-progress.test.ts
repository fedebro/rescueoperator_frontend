import { describe, expect, it } from 'vitest';
import { xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockEngine, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { installDomains } from './index';
import { allianceApiOf } from './alliance';
import { allianceProgressOf, PROGRESS_CFG } from './alliance-progress';

/** A founder at level 5 with an OPEN alliance; allies join through the same rules as the UI. */
export function progressWorld() {
  let now = Date.parse('2026-10-06T09:00:00.000Z');
  const events: { type: string }[] = [];
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e as { type: string }),
    random,
  });
  installDomains(engine);
  for (const f of ['alliance_objectives', 'alliance_ranking', 'alliance_operations', 'alliance_aid'])
    engine.state.featureFlags[f] = true;
  const ch = engine.requestOtp('founder@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Federico',
      acceptTerms: true,
      confirmAge: true,
    },
    'vitest',
  );
  const account = engine.authenticate(`Bearer ${auth.accessToken}`);
  const summary = engine.createCareer(account, {
    locationId: PESCARA.id,
    siteId: engine.starterSites()[0]!.id,
  });
  const career = engine.state.careers[summary.id] as MockCareer;
  engine.advanceTutorial(career, 'DONE');
  engine.awardXp(career, xpThreshold(5));
  engine.credit(career, 5000, 'ADMIN_ADJUSTMENT');
  const alliances = allianceApiOf(engine);
  const my = alliances.found(career, {
    name: 'Abruzzo Soccorso',
    tag: 'ABR',
    emblem: { shape: 'SHIELD', symbol: 'FLAME', primaryColor: 'RED', secondaryColor: 'SILVER' },
    description: '',
    language: 'it',
    joinPolicy: 'OPEN',
    minLevel: null,
  });
  const qa = engine.qa as unknown as Record<string, (...a: never[]) => unknown>;
  const ally = (name: string, opts: Record<string, unknown> = {}) => {
    const id = (qa.simulateAlly as (n: string, o: Record<string, unknown>) => { careerId: string })(
      name,
      opts,
    ).careerId;
    alliances.join(engine.state.careers[id]!, { allianceId: my.id });
    return id;
  };
  const advance = (ms: number) => {
    now += ms;
    engine.process();
  };
  return {
    engine,
    career,
    alliances,
    allianceId: my.id,
    ally,
    advance,
    events,
    qa,
    progress: allianceProgressOf(engine),
    careerOf: (id: string) => engine.state.careers[id]!,
  };
}

describe('mock progression — objectives', () => {
  it('generates three weekly objectives sized on the members, tracks contributions and pays the eligible ones', () => {
    const w = progressWorld();
    const marta = w.ally('Marta');
    const first = w.progress.objectives(w.career)!;
    expect(first.objectives).toHaveLength(3);
    expect(first.objectives.map((o) => o.type)).toEqual(expect.arrayContaining(['VOLUME', 'COOPERATION']));
    const volume = first.objectives.find((o) => o.type === 'VOLUME')!;
    expect(volume.target).toBe(15 * 2);
    (w.qa.objectiveProgress as (t: string, c: string | null, v: number) => unknown)('VOLUME', null, 4);
    const after = w.progress.objectives(w.career)!.objectives.find((o) => o.type === 'VOLUME')!;
    expect(after.progress).toBe(4);
    expect(after.myContribution).toBe(4);
    expect(after.myRewardEligible).toBe(true); // threshold = min(ceil(30 × 0.05), 3) = 2
    expect(after.contributions[0]).toMatchObject({ careerId: w.career.summary.id, value: 4 });
    // Marta brings the rest: completion pays both (she contributed ≥ the threshold) and the alliance gains XP.
    const credits = Number(w.career.summary.credits);
    const xp = w.alliances.alliance(w.allianceId)!.xp;
    (w.qa.objectiveProgress as (t: string, c: string, v: number) => unknown)(
      'VOLUME',
      marta,
      volume.target - 4,
    );
    const done = w.progress.objectives(w.career)!.objectives.find((o) => o.type === 'VOLUME')!;
    expect(done.completed).toBe(true);
    expect(done.myRewardPaidAt).not.toBeNull();
    expect(Number(w.career.summary.credits) - credits).toBe(PROGRESS_CFG.objectiveMemberCredits);
    expect(w.alliances.alliance(w.allianceId)!.xp - xp).toBe(PROGRESS_CFG.objectiveXp.VOLUME);
    expect(w.alliances.sync(w.career, 0).events.some((e) => e.type === 'alliance.objectives.updated')).toBe(
      true,
    );
    const ledger = w.progress.xp(w.career, {}).data;
    expect(ledger[0]).toMatchObject({
      source: 'OBJECTIVE',
      points: PROGRESS_CFG.objectiveXp.VOLUME,
      member: null,
    });
  });

  it('caps the incident XP per member and week, visibly', () => {
    const w = progressWorld();
    const xp = w.alliances.alliance(w.allianceId)!.xp;
    for (let i = 0; i < PROGRESS_CFG.incidentXpWeeklyCap + 1; i += 1)
      w.progress.addXp(w.allianceId, 'INCIDENT_RESOLVED', 1, w.career.summary.id);
    expect(w.alliances.alliance(w.allianceId)!.xp - xp).toBe(PROGRESS_CFG.incidentXpWeeklyCap);
    const page = w.progress.xp(w.career, { limit: 5 });
    expect(page.data[0]).toMatchObject({ capped: true, points: 0 });
    expect(page.hasMore).toBe(true);
    expect(w.progress.xp(w.career, { cursor: page.nextCursor!, limit: 100 }).data.length).toBe(
      PROGRESS_CFG.incidentXpWeeklyCap + 1 - 5,
    );
  });
});

describe('mock progression — ranking and rollover', () => {
  it('is off with its flag; on, it ranks alliances with at least three scoring members by their ten best', () => {
    const w = progressWorld();
    w.engine.state.featureFlags.alliance_ranking = false;
    expect(w.progress.ranking(w.career)).toMatchObject({ enabled: false, entries: [], mine: null });
    w.engine.state.featureFlags.alliance_ranking = true;
    (w.qa.simulateRanking as (n: number) => number)(11);
    const marta = w.ally('Marta');
    const luca = w.ally('Luca');
    w.progress.addPoints(w.career.summary.id, 120);
    const notYet = w.progress.ranking(w.career);
    expect(notYet.mine).toMatchObject({ position: 0, scoringMembers: 1, isMine: true });
    expect(notYet.entries.every((e) => !e.isMine)).toBe(true);
    w.progress.addPoints(marta, 80);
    w.progress.addPoints(luca, 50);
    const ranked = w.progress.ranking(w.career);
    expect(ranked.mine!.position).toBeGreaterThan(0);
    expect(ranked.mine!.score).toBe(250);
    expect(ranked.mine!.topContributors!.map((c) => c.points)).toEqual([120, 80, 50]);
    expect(ranked.entries.length).toBeLessThanOrEqual(20);
    expect(ranked.entries.filter((e) => e.topContributors !== null).every((e) => e.isMine)).toBe(true);
    expect(ranked.myPoints).toBe(120);
    expect(ranked.lastWeek).toBeNull();

    // Monday: last week's place and frame are kept, the objectives start over, the alliance gets ranking XP when on the podium.
    const xp = w.alliances.alliance(w.allianceId)!.xp;
    w.progress.rollover();
    const next = w.progress.ranking(w.career);
    expect(next.lastWeek).toMatchObject({ position: ranked.mine!.position, score: 250 });
    if (ranked.mine!.position <= 3) {
      expect(next.lastWeek!.frame).not.toBeNull();
      expect(w.alliances.alliance(w.allianceId)!.xp).toBeGreaterThan(xp);
    } else expect(next.lastWeek!.frame).toBeNull();
    expect(w.alliances.sync(w.career, 0).events.some((e) => e.type === 'alliance.updated')).toBe(true);
  });
});
