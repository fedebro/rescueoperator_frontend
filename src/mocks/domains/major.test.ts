import { describe, expect, it } from 'vitest';
import {
  CancelDispatchResult,
  DispatchOptionsResult,
  DispatchResultDto,
  MajorIncidentDto,
  MajorTrophiesResult,
  type IncidentDto,
  type RealtimeEnvelope,
} from '@/contracts';
import { MAJOR_SETTINGS, xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { CANCEL_GRACE_MS, MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { installDomains } from './index';
import { majorOf, majorState } from './major';
import {
  combineShares,
  estimateVehicles,
  groupRequirements,
  majorOutcome,
  majorQuality,
  majorReward,
  phaseFor,
  reinforcementGap,
  rollMajorSeverity,
} from './major-math';

/** The domain tests below step whole minutes of game time through the engine: seconds of CPU on a busy machine. */
const SIMULATION_TIMEOUT = 30_000;

type Qa = Record<string, (...args: never[]) => unknown>;

function world(opts: { level?: number; speed?: number } = {}) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: opts.speed ?? 1,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  const ch = engine.requestOtp('maxi@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Maxi',
      acceptTerms: true,
      confirmAge: true,
    },
    'vitest',
  );
  const account = engine.authenticate(`Bearer ${auth.accessToken}`);
  const summary = engine.createCareer(account, {
    locationId: PESCARA.id,
    siteId: engine.starterSites()[1]!.id,
  });
  const career = engine.state.careers[summary.id] as MockCareer;
  const tutorial = career.incidents.find((i) => i.isTutorial)!;
  engine.close(career, tutorial, 'CANCELLED', now);
  career.pendingOutcomes = [];
  engine.advanceTutorial(career, 'DONE');
  engine.cancelActions(career, (a) => a.type === 'INCIDENT_SPAWN');
  career.summary = { ...career.summary, onDuty: false };
  if (opts.level) engine.awardXp(career, xpThreshold(opts.level));
  const qa = engine.qa as unknown as Qa;
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      engine.process();
    }
  };
  const until = (done: () => boolean, budgetMs = 900_000, step = 250) => {
    for (let t = 0; t < budgetMs && !done(); t += step) {
      now += step;
      engine.process();
    }
    return done();
  };
  const fleet = (typeCode: string, count: number) => {
    const ids = (qa.addVehicles as (t: string, c: number) => string[])(typeCode, count);
    (qa.staffAll as () => void)();
    return ids;
  };
  return {
    engine,
    events,
    career,
    qa,
    advance,
    until,
    fleet,
    now: () => now,
    setNow: (ms: number) => (now = ms),
    major: () => majorOf(engine),
  };
}

describe('major incidents — the pure rules', () => {
  it('sizes on the fleet and estimates the vehicles a band needs from the own types', () => {
    const pumper = { FIRE_SUPPRESSION: 60, WATER_SUPPLY: 40 };
    expect(
      estimateVehicles(
        [
          { capability: 'FIRE_SUPPRESSION', level: 'REQUIRED', required: 150 },
          { capability: 'HAZMAT', level: 'REQUIRED', required: 30 },
        ],
        [pumper],
      ),
    ).toBe(3);
  });
  it('rolls the severity inside the level, or one band above it', () => {
    const t = {
      severity: [1, 9] as const,
      bands: [
        { severity: [1, 3] as const, minLevel: 1 },
        { severity: [4, 6] as const, minLevel: 5 },
        { severity: [7, 9] as const, minLevel: 12 },
      ],
    };
    const boosted = rollMajorSeverity(t, 6, 1, () => 0.1);
    expect(boosted.boosted).toBe(true);
    expect(boosted.severity).toBeGreaterThanOrEqual(7);
    const normal = rollMajorSeverity(t, 6, 0, () => 0.99);
    expect(normal).toEqual({ severity: 6, boosted: false });
  });
  it('moves the phases forward only, on arrival, progress and time', () => {
    const phases = MAJOR_SETTINGS.phases;
    const base = { mainReached: false, secondsSinceStart: 0, progress: 0, mainDone: false };
    expect(phaseFor({ ...base, current: 'ALARM' }, phases)).toBe('ALARM');
    expect(phaseFor({ ...base, current: 'ALARM', mainReached: true }, phases)).toBe('CONTAINMENT');
    expect(phaseFor({ ...base, current: 'ALARM', secondsSinceStart: 999 }, phases)).toBe('CONTAINMENT');
    expect(phaseFor({ ...base, current: 'ALARM', mainReached: true, progress: 0.4 }, phases)).toBe('RESCUE');
    expect(phaseFor({ ...base, current: 'RESCUE', mainReached: true, progress: 0.8 }, phases)).toBe(
      'SECURING',
    );
    expect(phaseFor({ ...base, current: 'SECURING', progress: 0 }, phases)).toBe('SECURING');
  });
  it('quotes what the committed units do not cover, and compounds columns', () => {
    const gap = reinforcementGap([
      {
        incidentId: 'a',
        capability: 'X',
        family: 'FIRE',
        level: 'REQUIRED',
        required: 100,
        onScene: 40,
        enRoute: 20,
        external: false,
        reinforced: 0,
      },
      {
        incidentId: 'a',
        capability: 'Y',
        family: 'EMS',
        level: 'OPTIONAL',
        required: 50,
        onScene: 0,
        enRoute: 0,
        external: false,
        reinforced: 0,
      },
    ]);
    expect(gap.items).toEqual([{ incidentId: 'a', capability: 'X', family: 'FIRE', value: 40 }]);
    expect(gap.share).toBe(0.4);
    expect(combineShares([0.5, 0.5])).toBe(0.75);
  });
  it('pays ≈ 165 × √target × quality, less with reinforcements, 10 % on a failure', () => {
    const q = majorQuality(
      { main: 'RESOLVED', meanCoverage: 1, responseSeconds: 60, subsResolved: 2, subsTotal: 2 },
      MAJOR_SETTINGS.reward,
    );
    expect(q).toBeCloseTo(1.12, 2);
    expect(majorOutcome('RESOLVED', q, MAJOR_SETTINGS.reward)).toBe('SUCCESS');
    const full = majorReward(
      { level: 8, targetVehicles: 16, quality: 1, outcome: 'SUCCESS', reinforcedShare: 0 },
      MAJOR_SETTINGS,
    );
    expect(full.credits).toBe(660);
    const reinforced = majorReward(
      { level: 8, targetVehicles: 16, quality: 1, outcome: 'SUCCESS', reinforcedShare: 0.5 },
      MAJOR_SETTINGS,
    );
    expect(reinforced.credits).toBe(Math.round(660 * 0.6));
    expect(
      majorReward(
        { level: 8, targetVehicles: 16, quality: 1, outcome: 'FAILURE', reinforcedShare: 0 },
        MAJOR_SETTINGS,
      ),
    ).toEqual({ credits: 66, xp: 0 });
  });
  it('groups requirement bars by service with the reinforced part', () => {
    const groups = groupRequirements(
      [
        {
          incidentId: 'a',
          capability: 'FIRE_SUPPRESSION',
          family: 'FIRE',
          level: 'REQUIRED',
          required: 100,
          onScene: 50,
          enRoute: 0,
          external: false,
          externalSource: null,
        },
        {
          incidentId: 'b',
          capability: 'FIRE_SUPPRESSION',
          family: 'FIRE',
          level: 'REQUIRED',
          required: 60,
          onScene: 60,
          enRoute: 0,
          external: false,
          externalSource: null,
        },
        {
          incidentId: 'a',
          capability: 'MEDICAL_BASIC',
          family: 'EMS',
          level: 'REQUIRED',
          required: 40,
          onScene: 0,
          enRoute: 40,
          external: false,
          externalSource: null,
        },
      ],
      () => ({ enRoute: 0, onScene: 0 }),
    );
    expect(groups.map((g) => [g.family, g.required, g.onScene, g.enRoute])).toEqual([
      ['FIRE', 160, 110, 0],
      ['EMS', 40, 0, 40],
    ]);
    expect(groups[0]!.coverage).toBeCloseTo(110 / 160, 4);
  });
});

describe('major incidents — the mock domain', () => {
  it('starts a major sized on the fleet: announced with its ref, a CRITICAL notification, outside the active cap', () => {
    const w = world({ level: 8 });
    w.fleet('FIRE_APS', 9);
    const before = w.events.length;
    const dto = w.major().start(w.career, { scenarioCode: 'MAJ_RESIDENTIAL_FIRE', targetVehicles: 12 });
    expect(MajorIncidentDto.safeParse(dto).success).toBe(true);
    expect(dto.status).toBe('ACTIVE');
    expect(dto.phase).toBe('ALARM');
    expect(dto.fleet.targetVehicles).toBe(12);
    const main = w.career.incidents.find((i) => i.id === dto.mainIncidentId)!;
    expect(main.major).toMatchObject({ id: dto.id, role: 'MAIN', sector: 0, phase: 'ALARM' });
    // The main scene is scaled on the fleet and lasts 3× a normal call.
    expect(Date.parse(main.expiresAt!) - w.now()).toBeGreaterThan(1500 * 1000);
    const created = w.events
      .slice(before)
      .find((e) => e.type === 'incident.created' && (e.payload.incident as IncidentDto).id === main.id)!;
    // Already on its `incident.created`: the client never shows it as a normal call.
    expect((created.payload.incident as IncidentDto).major?.id).toBe(dto.id);
    const notification = w.events.slice(before).find((e) => e.type === 'notification.created')!.payload
      .notification as { priority: string; title: { key: string } };
    expect(notification.priority).toBe('CRITICAL');
    expect(notification.title.key).toBe('major.notification.STARTED.title');
    const update = w.events.slice(before).find((e) => e.type === 'career.updated' && 'major' in e.payload)!;
    expect(MajorIncidentDto.parse(update.payload.major).id).toBe(dto.id);
    expect(update.payload.career).toBeUndefined();
    expect(w.engine.snapshot(w.career).activeMajorIncidentId).toBe(dto.id);
    expect(w.engine.activeCount(w.career)).toBe(0);
    // Never two at once.
    expect(() => w.major().start(w.career)).toThrowError(MockError);
  });

  it('lets 24 vehicles go to a member in one dispatch (12 on a normal call)', () => {
    const w = world({ level: 8 });
    const ids = w.fleet('FIRE_APS', 14);
    const dto = w.major().start(w.career, { scenarioCode: 'MAJ_RESIDENTIAL_FIRE', targetVehicles: 30 });
    const options = DispatchOptionsResult.parse(w.engine.dispatchOptions(w.career, dto.mainIncidentId!));
    expect(options.maxVehiclesPerDispatch).toBe(24);
    expect(options.recommendedVehicleIds.length).toBeLessThanOrEqual(24);
    const normal = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false);
    expect(
      DispatchOptionsResult.parse(w.engine.dispatchOptions(w.career, normal.id)).maxVehiclesPerDispatch,
    ).toBe(12);
    expect(() => w.engine.dispatch(w.career, normal.id, ids.slice(0, 13))).toThrowError(/Too many/);
    const sent = DispatchResultDto.parse(w.engine.dispatch(w.career, dto.mainIncidentId!, ids.slice(0, 13)));
    expect(sent.vehicles).toHaveLength(13);
  });

  it(
    'runs the phases with linked incidents, grows when left uncovered, and ends with a bonus, a trophy and XP',
    () => {
      const w = world({ level: 9 });
      const ids = w.fleet('FIRE_APS', 8);
      const dto = w.major().start(w.career, { scenarioCode: 'MAJ_RESIDENTIAL_FIRE', targetVehicles: 14 });
      // Nobody goes: after the first growth check the event widens (one more linked incident, a wider area).
      const grew = w.until(() => (w.qa.major as () => MajorIncidentDto)().growth.level >= 1, 600_000);
      expect(grew).toBe(true);
      const grown = (w.qa.major as () => MajorIncidentDto)();
      expect(grown.areaRadiusMeters).toBeGreaterThan(dto.areaRadiusMeters);
      expect(grown.sectors.some((s) => s.cause === 'GROWTH')).toBe(true);
      expect(grown.phase).toBe('CONTAINMENT'); // after 180 s anyway
      // The whole fleet on the main scene: the phases follow the work.
      w.engine.dispatch(w.career, dto.mainIncidentId!, ids);
      const rescued = w.until(
        () => ['RESCUE', 'SECURING', 'ENDED'].includes((w.qa.major as () => MajorIncidentDto)().phase),
        600_000,
      );
      expect(rescued).toBe(true);
      const linked = (w.qa.major as () => MajorIncidentDto)().sectors.filter((s) => s.role === 'SUB');
      expect(linked.length).toBeGreaterThan(0);
      for (const s of linked) {
        const incident = w.career.incidents.find((i) => i.id === s.incidentId);
        if (incident) expect(incident.major).toMatchObject({ id: dto.id, role: 'SUB' });
      }
      const credits = BigInt(w.career.summary.credits);
      const xp = Number(w.career.summary.xp);
      const ended = (w.qa.finishMajor as () => MajorIncidentDto)();
      expect(ended.status).toBe('ENDED');
      expect(['SUCCESS', 'PARTIAL']).toContain(ended.outcome);
      expect(Number(ended.reward.credits)).toBeGreaterThan(0);
      const bonus = w.career.ledger.find((l) => l.entryType === 'MAJOR_INCIDENT')!;
      expect(bonus.description).toMatchObject({
        key: 'ledger.MAJOR_INCIDENT',
        params: { scenario: 'MAJ_RESIDENTIAL_FIRE' },
      });
      expect(BigInt(w.career.summary.credits)).toBeGreaterThan(credits);
      expect(Number(w.career.summary.xp)).toBeGreaterThan(xp);
      const trophies = MajorTrophiesResult.parse(w.major().trophies(w.career));
      const trophy = trophies.trophies.find((t) => t.scenarioCode === 'MAJ_RESIDENTIAL_FIRE')!;
      expect(trophy.attempts).toBe(1);
      expect(trophy.medal).not.toBeNull();
      expect(trophies.trophies).toHaveLength(14);
      expect(w.engine.snapshot(w.career).activeMajorIncidentId).toBeNull();
      expect(w.major().current(w.career)).toBeNull();
      expect(w.major().list(w.career, 5)[0]!.id).toBe(dto.id);
    },
    SIMULATION_TIMEOUT,
  );

  it(
    'members move no reputation of their own',
    () => {
      const w = world({ level: 8 });
      const ids = w.fleet('FIRE_APS', 8);
      const dto = w.major().start(w.career, { scenarioCode: 'MAJ_RESIDENTIAL_FIRE', targetVehicles: 6 });
      const reputation = w.career.summary.reputation;
      w.engine.dispatch(w.career, dto.mainIncidentId!, ids);
      expect(w.until(() => w.career.pendingOutcomes.length > 0, 7_200_000, 1_000)).toBe(true);
      const outcome = w.career.pendingOutcomes[0]!;
      expect(outcome.reputationDelta).toBe(0);
      expect(outcome.notes.map((n) => n.key)).toContain('major.note.MEMBER');
      expect(w.career.summary.reputation).toBe(reputation);
    },
    SIMULATION_TIMEOUT,
  );

  it(
    'quotes and sends reinforcements: blocked without an own unit, then the column covers the gap at a cost',
    () => {
      const w = world({ level: 8 });
      const [first] = w.fleet('FIRE_APS', 2);
      const dto = w.major().start(w.career, { scenarioCode: 'MAJ_RESIDENTIAL_FIRE', targetVehicles: 16 });
      expect(w.major().quote(w.career, dto.id).blockedReason).toBe('NO_OWN_UNIT');
      expect(() => w.major().requestReinforcements(w.career, dto.id)).toThrowError(MockError);
      w.engine.dispatch(w.career, dto.mainIncidentId!, [first!]);
      const quote = w.major().quote(w.career, dto.id);
      expect(quote.available).toBe(true);
      expect(quote.coverageShare).toBeGreaterThan(0);
      expect(quote.rewardReductionShare).toBeCloseTo(quote.coverageShare * 0.8, 3);
      const requested = w.major().requestReinforcements(w.career, dto.id);
      expect(requested.reinforcements.requests[0]!.status).toBe('EN_ROUTE');
      expect(requested.reinforcements.quote.blockedReason).toBe('ALREADY_EN_ROUTE');
      const arrived = w.until(
        () => (w.qa.major as () => MajorIncidentDto)().reinforcements.requests[0]!.status === 'ON_SCENE',
        900_000,
      );
      expect(arrived).toBe(true);
      const after = (w.qa.major as () => MajorIncidentDto)();
      expect(after.reinforcements.reinforcedShare).toBeGreaterThan(0);
      const main = w.career.incidents.find((i) => i.id === dto.mainIncidentId);
      if (main)
        expect(main.requirements.some((r) => r.externalSource === 'REINFORCEMENTS' || r.required < 200)).toBe(
          true,
        );
      expect(
        w.career.notifications.some((n) => n.title.key === 'major.notification.REINFORCEMENTS.title'),
      ).toBe(true);
    },
    SIMULATION_TIMEOUT,
  );

  it('generates majors only from level 5, on duty, after the play time (wall-clock minutes)', () => {
    const w = world({ level: 4 });
    w.fleet('FIRE_APS', 4);
    w.career.summary = { ...w.career.summary, onDuty: true };
    w.engine.touch(w.career);
    expect(w.career.actions.some((a) => a.type === 'MAJOR_CHECK')).toBe(false);
    w.engine.awardXp(w.career, xpThreshold(6) - Number(w.career.summary.xp));
    // The heartbeat keeps the player present; the chain accrues play every 2 minutes.
    let started = false;
    for (let minute = 0; minute < 45 && !started; minute++) {
      w.advance(60_000, 5_000);
      w.engine.touch(w.career);
      started = majorState(w.career).majors.length > 0;
    }
    expect(started).toBe(true);
    expect(majorState(w.career).schedule.first).toBe(true);
  });
});

describe('free undo of a dispatch (★POST /dispatches/:id/cancel)', () => {
  it('restores the vehicle and the ORIGINAL expiry within the window, without a "recalled" line', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false);
    const expiresAt = incident.expiresAt;
    const expireDue = w.career.actions.find(
      (a) => a.type === 'INCIDENT_EXPIRE' && a.ref === incident.id,
    )!.dueAt;
    const vehicle = w.career.vehicles[0]!;
    const sent = DispatchResultDto.parse(w.engine.dispatch(w.career, incident.id, [vehicle.id]));
    expect(sent.cancellableUntil).not.toBeNull();
    expect(Date.parse(sent.cancellableUntil!) - w.now()).toBeLessThanOrEqual(CANCEL_GRACE_MS);
    w.advance(2_000);
    const result = CancelDispatchResult.parse(w.engine.cancelDispatch(w.career, sent.dispatchId));
    expect(result.status).toBe('CANCELLED');
    expect(result.vehicles[0]!.status).toBe('AVAILABLE');
    expect(result.incident.status).toBe('PENDING_RESPONSE');
    expect(result.incident.expiresAt).toBe(expiresAt);
    expect(w.career.actions.find((a) => a.type === 'INCIDENT_EXPIRE' && a.ref === incident.id)!.dueAt).toBe(
      expireDue,
    );
    const lines = (w.career.timelines[incident.id] ?? []).map((l) => l.type);
    expect(lines).toContain('vehicle.dispatch_cancelled');
    expect(lines).not.toContain('vehicle.recalled');
    expect(w.events.some((e) => e.type === 'vehicle.updated' && e.payload.dispatchCancelled === true)).toBe(
      true,
    );
    // A replay answers the same.
    expect(CancelDispatchResult.parse(w.engine.cancelDispatch(w.career, sent.dispatchId)).dispatchId).toBe(
      sent.dispatchId,
    );
  });

  it('refuses after the window, once a vehicle left, and for an unknown dispatch', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false);
    const vehicle = w.career.vehicles[0]!;
    const sent = w.engine.dispatch(w.career, incident.id, [vehicle.id]);
    w.advance(CANCEL_GRACE_MS + 500);
    expect(() => w.engine.cancelDispatch(w.career, sent.dispatchId)).toThrowError(
      expect.objectContaining({
        code: expect.stringMatching(/CANCEL_WINDOW_EXPIRED|DISPATCH_NOT_CANCELLABLE/),
      }),
    );
    expect(() => w.engine.cancelDispatch(w.career, 'dsp_00000000000000000000000000')).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    const fast = world({ level: 3, speed: 12 });
    const other = fast.engine.spawnIncident(fast.career, 'FIRE_TRASH_BIN', false);
    const quick = fast.engine.dispatch(fast.career, other.id, [fast.career.vehicles[0]!.id]);
    // At ×12 the pumper leaves after ~1 s: the window closes with its departure.
    expect(Date.parse(quick.cancellableUntil!) - fast.now()).toBeLessThan(CANCEL_GRACE_MS);
    fast.until(() => fast.career.vehicles[0]!.status !== 'PREPARING', 10_000);
    expect(() => fast.engine.cancelDispatch(fast.career, quick.dispatchId)).toThrowError(MockError);
  });
});
