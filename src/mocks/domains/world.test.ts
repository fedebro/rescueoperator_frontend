import { describe, expect, it } from 'vitest';
import {
  CoverageDto,
  MilestoneDto,
  ProgressionDto,
  StipendDto,
  WorldContextDto,
  type RealtimeEnvelope,
} from '@/contracts';
import { z } from 'zod';
import { MockEngine, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { ECONOMY, INCIDENT_TEMPLATES, MILESTONES, VEHICLE_TYPES } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { installDomains } from './index';
import { WORLD_ACTION, worldApiOf, worldState } from './world';
import {
  closureFactor,
  computeCoverage,
  computeStipend,
  corridorPolygon,
  coverageFactor,
  dayPhaseOf,
  demoClosuresAt,
  pathCrossesPolygon,
  populationCells,
  reputationFactor,
  timeContext,
  trafficLevelOf,
  trafficMultiplierOf,
  weatherAt,
  type MockClosure,
} from './world-sim';

const SPEED = 1200; // one stipend period (4 h) = 12 real seconds
const PERIOD_MS = (ECONOMY.stipend.periodSeconds * 1000) / SPEED;

function world(startIso = '2026-03-04T09:00:00.000Z') {
  let now = Date.parse(startIso);
  const events: RealtimeEnvelope[] = [];
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: SPEED,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  const ch = engine.requestOtp('w@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'World',
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
  const career = () => engine.state.careers[summary.id] as MockCareer;
  /** Advances the clock; `present` keeps the player's heartbeat alive (D-11). */
  const advance = (ms: number, present = true, step = 500) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      if (present) engine.touch(career());
      engine.process();
    }
  };
  const finishTutorial = () => {
    const tutorial = career().incidents.find((i) => i.isTutorial);
    if (tutorial) engine.close(career(), tutorial, 'CANCELLED', now);
    career().pendingOutcomes = [];
    engine.advanceTutorial(career(), 'DONE');
    engine.setDuty(career(), false); // no random incidents: the tests below are about the world, not the core loop
  };
  return { engine, events, career, advance, finishTutorial, api: worldApiOf(engine), now: () => now };
}

describe('world simulation (pure)', () => {
  it('derives hour band, weekday type, season and day phase from the local clock', () => {
    const t = timeContext(Date.parse('2026-07-18T16:30:00.000Z'), 'Europe/Rome'); // Saturday 18:30 CEST
    expect(t).toMatchObject({
      hour: 18,
      hourBand: 'EVENING',
      weekdayType: 'SATURDAY',
      season: 'SUMMER',
      dayPhase: 'DAY',
    });
    expect(dayPhaseOf(1, 3, 0)).toBe('NIGHT');
    expect(dayPhaseOf(1, 7, 40)).toBe('TWILIGHT');
    expect(dayPhaseOf(6, 22, 0)).toBe('NIGHT');
  });

  it('weather is deterministic per slot and only uses contract codes', () => {
    const slot = 100_000;
    const base = Date.parse('2026-11-02T08:00:00.000Z');
    const codes = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const at = base + i * slot;
      const a = weatherAt(at, slot, 'Europe/Rome');
      expect(weatherAt(at + slot - 1, slot, 'Europe/Rome')).toEqual(weatherAt(at, slot, 'Europe/Rome'));
      expect(() => WorldContextDto.shape.weather.shape.code.parse(a.code)).not.toThrow();
      expect(a.windKmh).toBeGreaterThanOrEqual(0);
      codes.add(a.code);
    }
    expect(codes.size).toBeGreaterThan(3); // the sky does change
  });

  it('traffic follows rush hours and bad weather, within the clamp', () => {
    const rush = trafficMultiplierOf({ hour: 8, weekdayType: 'WEEKDAY', season: 'AUTUMN' }, 'CLEAR');
    const night = trafficMultiplierOf({ hour: 3, weekdayType: 'WEEKDAY', season: 'AUTUMN' }, 'CLEAR');
    const storm = trafficMultiplierOf({ hour: 8, weekdayType: 'WEEKDAY', season: 'AUTUMN' }, 'STORM');
    expect(night).toBe(1);
    expect(rush).toBeGreaterThan(night);
    expect(storm).toBeGreaterThan(rush);
    expect(storm).toBeLessThanOrEqual(1.8);
    expect(trafficLevelOf(night)).toBe('FREE_FLOW');
    expect(trafficLevelOf(rush)).toBe('HEAVY');
    expect(trafficLevelOf(storm)).toBe('SEVERE');
  });

  it('a path is slowed down only when it runs into a closure polygon', () => {
    const polygon = corridorPolygon([14.21, 42.46], [14.21, 42.47], 30);
    const closure: MockClosure = {
      id: 'c',
      polygon,
      reasonKey: 'world.closure.ROADWORKS',
      reasonParams: {},
      endsAt: null,
      kind: 'FULL',
      multiplier: 1.6,
      incidentId: null,
    };
    const crossing = [
      [14.2, 42.465],
      [14.22, 42.465],
    ] as [number, number][];
    const away = [
      [14.2, 42.48],
      [14.22, 42.48],
    ] as [number, number][];
    expect(pathCrossesPolygon(crossing, polygon)).toBe(true);
    expect(pathCrossesPolygon(away, polygon)).toBe(false);
    expect(closureFactor(crossing, [closure])).toBe(1.6);
    expect(closureFactor(away, [closure])).toBe(1);
  });

  it('demo closures appear and expire on the slot rota with a future end', () => {
    const slot = 100_000;
    const seen = new Set<number>();
    for (let s = 0; s < 18; s++) {
      const now = s * slot + 10;
      const closures = demoClosuresAt(now, slot);
      seen.add(closures.length);
      for (const c of closures) expect(c.endsAt).toBeGreaterThan(now);
    }
    expect(seen.has(0) || seen.has(1)).toBe(true);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(1);
  });

  it('population cells cover the municipality: denser in the centre, total = residents', () => {
    const cells = populationCells();
    expect(cells.length).toBeGreaterThan(40);
    const total = cells.reduce((s, c) => s + c.population, 0);
    expect(Math.abs(total - PESCARA.population)).toBeLessThan(cells.length);
    const sorted = [...cells].sort((a, b) => b.population - a.population);
    expect(sorted[0]!.population).toBeGreaterThan(sorted.at(-1)!.population * 5);
  });

  it('coverage weighs only the unlocked families', () => {
    const facility = { id: 'fac_1', position: PESCARA.center, families: ['FIRE' as const] };
    const fireOnly = computeCoverage({ facilities: [facility], unlockedFamilies: ['FIRE'], computedAt: 'x' });
    const withEms = computeCoverage({
      facilities: [facility],
      unlockedFamilies: ['FIRE', 'EMS'],
      computedAt: 'x',
    });
    const fire = fireOnly.byFamily.find((f) => f.family === 'FIRE')!;
    expect(fireOnly.overallPct).toBe(fire.pct);
    expect(fire.pct).toBeGreaterThan(50);
    expect(fire.active).toBe(true);
    expect(withEms.byFamily.find((f) => f.family === 'EMS')).toMatchObject({ pct: 0, active: false });
    expect(withEms.overallPct).toBeCloseTo(fire.pct / 2, 1); // FIRE and EMS weigh the same
    expect(fireOnly.method).toBe('STRAIGHT_LINE');
    expect(fireOnly.cells.every((c) => c.bestSeconds === null || c.bestSeconds > 0)).toBe(true);
    expect(computeCoverage({ facilities: [], unlockedFamilies: ['FIRE'], computedAt: 'x' })).toMatchObject({
      overallPct: 0,
      method: 'NONE',
    });
  });

  it('stipend = base × g(coverage) × h(reputation) − personnel, never negative', () => {
    expect(coverageFactor(0.49)).toBe(0.5);
    expect(coverageFactor(0.7)).toBe(1);
    expect(coverageFactor(1)).toBe(1.3);
    expect(reputationFactor(0)).toBe(0.8);
    expect(reputationFactor(50)).toBe(1);
    expect(reputationFactor(100)).toBe(1.2);
    expect(computeStipend({ base: 150, coveragePct: 82, reputation: 50, personnelCost: 40 }).net).toBe(110);
    expect(computeStipend({ base: 150, coveragePct: 82, reputation: 50, personnelCost: 4000 }).net).toBe(0);
  });
});

describe('world domain on the engine', () => {
  it('computes the real coverage of the first station and exposes contract-valid resources', () => {
    const w = world();
    const career = w.career();
    expect(career.summary.coveragePct).toBeGreaterThan(50);
    expect(() => CoverageDto.parse(w.api.coverage(career))).not.toThrow();
    expect(() => StipendDto.parse(w.api.stipend(career))).not.toThrow();
    expect(() => WorldContextDto.parse(w.api.world(career))).not.toThrow();
    expect(() => z.array(MilestoneDto).parse(w.api.milestones(career))).not.toThrow();
    expect(w.api.milestones(career)).toHaveLength(MILESTONES.length);
    const extras = w.api.progressionExtras(career);
    expect(() =>
      ProgressionDto.parse({
        level: 1,
        xp: '0',
        xpForCurrentLevel: '0',
        xpForNextLevel: '100',
        reputation: 50,
        incidentsResolved: 0,
        incidentsFailed: 0,
        ...extras,
      }),
    ).not.toThrow();
    expect(extras).toMatchObject({ rank: { code: 'TRAINEE_DIRECTOR' }, stipendBase: '150' });
    expect((extras.nextUnlocks as unknown[]).length).toBeGreaterThan(0);
    expect(w.api.world(career)).toMatchObject({
      season: 'SPRING',
      hourBand: 'MORNING',
      weekdayType: 'WEEKDAY',
      weatherSource: 'simulated',
    });
  });

  it('pays the stipend every period while the player is present', () => {
    const w = world();
    w.finishTutorial();
    const before = BigInt(w.career().summary.credits);
    const estimate = Number(w.api.stipend(w.career()).estimate.net);
    expect(estimate).toBeGreaterThan(0);
    w.advance(PERIOD_MS * 2 + 1000);
    const career = w.career();
    const paid = w.events.filter((e) => e.type === 'stipend.paid');
    expect(paid).toHaveLength(2);
    expect(paid[0]!.payload).toMatchObject({ amount: String(estimate) });
    expect(career.ledger.filter((l) => l.entryType === 'COVERAGE_STIPEND')).toHaveLength(2);
    expect(BigInt(career.summary.credits) - before).toBe(BigInt(estimate * 2));
    expect(career.notifications.some((n) => n.category === 'ECONOMY')).toBe(true);
    const view = w.api.stipend(career);
    expect(view.history?.map((h) => h.status)).toEqual(['PAID', 'PAID']);
    expect(new Set(view.history?.map((h) => h.periodKey)).size).toBe(2);
    expect(view.lastPayout?.net).toBe(String(estimate));
    expect(Date.parse(view.nextPayoutAt)).toBeGreaterThan(w.now());
    expect(view.periodSeconds).toBe(Math.round(ECONOMY.stipend.periodSeconds / SPEED));
  });

  it('keeps accruing while away up to the cap, then stops until the player returns (D-11)', () => {
    const w = world();
    w.finishTutorial();
    w.engine.touch(w.career());
    const cap = ECONOMY.stipend.offlineCapPeriods;
    w.advance(PERIOD_MS * (cap + 4), false);
    const career = w.career();
    const history = worldState(career).stipend.history;
    expect(history.filter((h) => h.status === 'PAID')).toHaveLength(cap);
    expect(history.filter((h) => h.status === 'SKIPPED_INACTIVE')).toHaveLength(1);
    expect(career.actions.some((a) => a.type === WORLD_ACTION.stipend)).toBe(false);
    expect(career.away.stipend).toBe(
      Number(history.filter((h) => h.status === 'PAID').reduce((s, h) => s + Number(h.net), 0)),
    );
    expect(w.api.stipend(career).accruedPeriods).toBe(cap);
    // Coming back restarts the chain at the next boundary.
    w.engine.touch(career);
    expect(career.actions.filter((a) => a.type === WORLD_ACTION.stipend)).toHaveLength(1);
  });

  it('QA payStipend pays through the normal executor and never duplicates a period key', () => {
    const w = world();
    w.finishTutorial();
    const row = (
      w.engine.qa as unknown as { payStipend: () => { status: string; periodKey: string } }
    ).payStipend();
    expect(row.status).toBe('PAID');
    w.advance(PERIOD_MS + 1000);
    const keys = worldState(w.career()).stipend.history.map((h) => h.periodKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('subtracts the personnel deductions without ever going below zero', () => {
    const w = world();
    const already = Number(w.api.stipend(w.career()).estimate.personnelCost); // the personnel domain's own deduction
    w.engine.hooks.stipendDeductions.push(() => 100_000);
    const view = w.api.stipend(w.career());
    expect(view.estimate.net).toBe('0');
    expect(view.estimate.personnelCost).toBe(String(100_000 + already));
  });

  it('milestones reached during the tutorial are recorded but not paid twice; later ones pay once', () => {
    const w = world();
    const during = worldState(w.career()).milestones.achieved;
    expect(Object.keys(during)).toContain('COVERAGE_50');
    expect(w.career().ledger.filter((l) => l.entryType === 'MILESTONE')).toHaveLength(0);
    w.finishTutorial();
    expect(worldState(w.career()).milestones.achieved).toHaveProperty('TUTORIAL_COMPLETED');
    expect(w.career().ledger.filter((l) => l.entryType === 'MILESTONE')).toHaveLength(0);

    w.engine.credit(w.career(), 5000, 'ADMIN_ADJUSTMENT');
    const creditsBefore = BigInt(w.career().summary.credits);
    const xpBefore = Number(w.career().summary.xp);
    const aps = VEHICLE_TYPES.find((v) => v.code === 'FIRE_APS')!;
    w.engine.buyVehicle(w.career(), {
      vehicleTypeCode: 'FIRE_APS',
      facilityId: w.career().facilities[0]!.id,
    });
    const milestone = MILESTONES.find((m) => m.code === 'FIRST_VEHICLE_PURCHASED')!;
    expect(BigInt(w.career().summary.credits)).toBe(
      creditsBefore - BigInt(aps.price) + BigInt(milestone.rewardCredits),
    );
    expect(Number(w.career().summary.xp)).toBe(xpBefore + milestone.rewardXp);
    expect(
      w
        .career()
        .notifications.some(
          (n) => n.category === 'PROGRESSION' && n.body.key === 'milestone.FIRST_VEHICLE_PURCHASED.title',
        ),
    ).toBe(true);
    const list = w.api.milestones(w.career());
    expect(list.find((m) => m.code === 'FIRST_VEHICLE_PURCHASED')).toMatchObject({
      achieved: true,
      progress: { current: 1, target: 1 },
    });
    // Buying again does not pay the same milestone again.
    const again = BigInt(w.career().summary.credits);
    w.engine.buyVehicle(w.career(), {
      vehicleTypeCode: 'FIRE_APS',
      facilityId: w.career().facilities[0]!.id,
    });
    expect(BigInt(w.career().summary.credits)).toBe(again - BigInt(aps.price));
  });

  it('recomputes coverage (debounced, stale meanwhile) when the fleet changes', () => {
    const w = world();
    w.finishTutorial();
    w.engine.awardXp(w.career(), 100_000); // unlocks every family → EMS now weighs on the overall figure
    const stale = w.api.coverage(w.career());
    expect(stale.stale).toBe(true);
    const fireOnly = stale.overallPct;
    w.advance(3000);
    const fresh = w.api.coverage(w.career());
    expect(fresh.stale).toBe(false);
    expect(fresh.overallPct).toBeLessThan(fireOnly);
    expect(w.career().summary.coveragePct).toBe(fresh.overallPct);
    expect(
      w.events.some(
        (e) =>
          e.type === 'career.updated' &&
          (e.payload.career as { coveragePct: number }).coveragePct === fresh.overallPct,
      ),
    ).toBe(true);
    expect(w.events.filter((e) => e.type === 'world.updated').length).toBeGreaterThan(0);
  });

  it('QA closures reach the client, slow crossing routes down and expire', () => {
    const w = world();
    w.finishTutorial();
    const qa = w.engine.qa as unknown as {
      addClosure: (o?: { seconds?: number }) => string;
      setWeather: (c: string | null, d?: boolean) => void;
    };
    qa.setWeather('CLEAR');
    const id = qa.addClosure({ seconds: 6000 }); // 5 real seconds at this speed
    const event = w.events.filter((e) => e.type === 'world.updated').at(-1)!;
    const closures = (event.payload.world as { closures: { id: string; endsAt: string }[] }).closures;
    expect(closures.some((c) => c.id === id)).toBe(true);
    const crossing: [number, number][] = [
      [14.205, 42.465],
      [14.215, 42.465],
    ];
    const factor = (path: [number, number][]) =>
      w.engine.hooks.travelFactor.reduce((f, h) => f * h(w.career(), path, 'FIRE_APS'), 1);
    const clear: [number, number][] = [
      [14.17, 42.43],
      [14.175, 42.43],
    ];
    expect(factor(crossing) / factor(clear)).toBeCloseTo(1.6, 5);
    w.advance(6000);
    expect(w.api.world(w.career()).closures.some((c) => c.id === id)).toBe(false);
    qa.setWeather('STORM', true);
    expect(w.api.world(w.career()).weather).toMatchObject({ code: 'STORM', degraded: true });
  });

  it('closes the road around an incident while external units that block it are at work', () => {
    const w = world();
    w.finishTutorial();
    const incident = w.engine.spawnIncident(
      w.career(),
      INCIDENT_TEMPLATES.find((t) => !t.tutorial && t.primaryFamily === 'FIRE')!.code,
      false,
    );
    w.engine.patchIncident(w.career(), incident.id, {
      status: 'RESOLVING',
      externalSupport: [
        {
          id: 'ung_1',
          unitTypeCode: 'TOW_TRUCK',
          name: { key: 'ung.TOW_TRUCK.name' },
          status: 'WORKING',
          arriveAt: new Date(w.now()).toISOString(),
          completeAt: new Date(w.now() + 60_000).toISOString(),
          keepsRoadClosed: true,
        },
      ],
    });
    const closures = w.api.world(w.career()).closures;
    expect(closures).toContainEqual(expect.objectContaining({ incidentId: incident.id, kind: 'PARTIAL' }));
  });
});
