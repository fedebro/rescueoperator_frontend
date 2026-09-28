import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CandidatesResult,
  CrewPreview,
  EnrollmentDto,
  PersonnelDto,
  TeamDto,
  type RealtimeEnvelope,
} from '@/contracts';
import { PersonnelDetailDto, TrainingOverview, VehicleCrewGapDto } from '@/contracts';
import { VEHICLE_TYPES, xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockEngine, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { installQa } from '../qa';
import {
  bandOf,
  deriveTeam,
  fatigueAt,
  installPersonnel,
  loadClassOf,
  personnelDomain,
  selectCrew,
  type MockOperator,
  type MockTeam,
} from './personnel';

function world(speed = 1) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installPersonnel(engine);
  installQa(engine);
  const ch = engine.requestOtp('p@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Dir P',
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
  const advance = (ms: number, step = 500) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      engine.process();
    }
  };
  const level = (n: number) => engine.awardXp(career, xpThreshold(n) - Number(career.summary.xp));
  return { engine, career, events, advance, level, domain: personnelDomain(engine), now: () => now };
}
const hq = (career: MockCareer) => career.facilities[0]!;
const APS = VEHICLE_TYPES.find((t) => t.code === 'FIRE_APS')!;

function operator(patch: Partial<MockOperator>): MockOperator {
  return {
    id: `per_${Math.random().toString(36).slice(2)}`,
    firstName: 'A',
    lastName: 'B',
    roleCode: 'FIREFIGHTER',
    family: 'FIRE',
    facilityId: 'fac_1',
    teamId: null,
    status: 'AVAILABLE',
    competence: 50,
    fatigue: { value: 0, ratePerSecond: 0, anchorAt: '2026-03-01T09:00:00.000Z', band: 'RESTED' },
    qualifications: [],
    missions: 0,
    hiredAt: '2026-03-01T09:00:00.000Z',
    busyUntil: null,
    busyReason: null,
    costPerPeriod: '4',
    history: [],
    injury: null,
    recentMissions: [],
    ...patch,
  };
}
const NOW = Date.parse('2026-03-01T09:00:00.000Z');
const licence = [{ code: 'HEAVY_VEHICLE_LICENSE', obtainedAt: '2026-03-01T09:00:00.000Z', expiresAt: null }];

describe('fatigue (anchored value)', () => {
  it('derives the band from the catalog thresholds 40 / 65 / 85', () => {
    expect([0, 39.9, 40, 64, 65, 84.9, 85, 100].map(bandOf)).toEqual([
      'RESTED', 'RESTED', 'TIRED', 'TIRED', 'FATIGUED', 'FATIGUED', 'REST_REQUIRED', 'REST_REQUIRED',
    ]); // prettier-ignore
  });
  it('is value + rate·elapsed, clamped to 0–100', () => {
    const f = { value: 50, ratePerSecond: -1, anchorAt: '2026-03-01T09:00:00.000Z', band: 'TIRED' as const };
    expect(fatigueAt(f, NOW + 10_000)).toBe(40);
    expect(fatigueAt(f, NOW + 100_000)).toBe(0);
    expect(fatigueAt({ ...f, ratePerSecond: 2 }, NOW + 100_000)).toBe(100);
  });
  it('maps incident severity to the mission load class', () => {
    expect([1, 3, 4, 6, 7, 8, 9, 10].map(loadClassOf)).toEqual([
      'ROUTINE', 'ROUTINE', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'EXTREME', 'EXTREME',
    ]); // prettier-ignore
  });
});

describe('selectCrew', () => {
  const driver = operator({ id: 'per_d', roleCode: 'DRIVER_OPERATOR', qualifications: licence });
  const crewOf = (n: number) => Array.from({ length: n }, (_, i) => operator({ id: `per_f${i}` }));
  const opts = { now: NOW, ownTeam: new Set<string>(), target: 'OPTIMAL' as const };

  it('fills required roles and qualifications first, then up to the optimal crew', () => {
    const s = selectCrew(APS, [...crewOf(6), driver], opts);
    expect(s.blocked).toBeNull();
    expect(s.crew).toHaveLength(APS.crewOptimal);
    expect(s.crew.map((o) => o.id)).toContain('per_d');
    expect(s.efficiency).toBe(1);
  });
  it('reports what blocks the vehicle', () => {
    expect(selectCrew(APS, [driver, ...crewOf(1)], opts).blocked).toBe('CREW_INSUFFICIENT');
    const noDriver = selectCrew(APS, crewOf(5), opts);
    expect(noDriver.blocked).toBe('CREW_UNQUALIFIED');
    expect(noDriver.missing).toEqual(['DRIVER_OPERATOR', 'HEAVY_VEHICLE_LICENSE']);
    const tired = crewOf(4).map((o) => ({ ...o, fatigue: { ...o.fatigue, value: 90 } }));
    expect(selectCrew(APS, [driver, ...tired], opts).blocked).toBe('CREW_EXHAUSTED');
  });
  it('prefers the members of the vehicle’s own team and works below optimal with reduced efficiency', () => {
    const people = [...crewOf(8), driver];
    const own = new Set(['per_f5', 'per_f6', 'per_f7']);
    const s = selectCrew(APS, people, { ...opts, ownTeam: own });
    expect(s.crew.map((o) => o.id)).toEqual(expect.arrayContaining([...own]));
    const small = selectCrew(APS, [driver, ...crewOf(2)], opts);
    expect(small.blocked).toBeNull();
    expect(small.efficiency).toBeLessThan(1);
    expect(selectCrew(APS, people, { ...opts, target: 'MIN' }).crew).toHaveLength(APS.crewMin);
  });
  it('like the backend: a missing qualification blocks, a missing role only warns, never more than the target', () => {
    // Five licensed firefighters and no driver-operator: the crew leaves without the recommended role.
    const licensed = Array.from({ length: 5 }, (_, i) =>
      operator({ id: `per_l${i}`, qualifications: licence }),
    );
    const noRole = selectCrew(APS, licensed, opts);
    expect(noRole.blocked).toBeNull();
    expect(noRole.missingRoles).toEqual(['DRIVER_OPERATOR']);
    expect(noRole.missingQualifications).toEqual([]);
    // The minimum crew is exactly the minimum, whatever the size of the pool.
    expect(selectCrew(APS, [...licensed, driver], { ...opts, target: 'MIN' }).crew).toHaveLength(APS.crewMin);
    const unqualified = selectCrew(APS, crewOf(5), opts);
    expect(unqualified).toMatchObject({
      blocked: 'CREW_UNQUALIFIED',
      missingQualifications: ['HEAVY_VEHICLE_LICENSE'],
    });
  });
  it('never drafts operators of another family or busy ones', () => {
    const others = [operator({ family: 'EMS', roleCode: 'RESCUER' }), operator({ status: 'TRAINING' })];
    expect(selectCrew(APS, [driver, ...crewOf(1), ...others], opts).crew).toHaveLength(2);
  });
});

describe('deriveTeam', () => {
  const members = [
    operator({ id: 'per_1', roleCode: 'DRIVER_OPERATOR', qualifications: licence }),
    operator({ id: 'per_2' }),
    operator({ id: 'per_3' }),
  ];
  const team: MockTeam = {
    id: 'tem_1', name: 'Alfa', facilityId: 'fac_1', departmentId: null, vehicleId: 'veh_1', leaderId: 'per_1',
    memberIds: members.map((m) => m.id),
  }; // prettier-ignore
  it('is PARTIAL below the optimal crew and lists the warnings', () => {
    const d = deriveTeam(team, members, APS, NOW);
    expect(d.status).toBe('PARTIAL');
    expect(d.warnings).toEqual(['BELOW_OPTIMAL_CREW']);
    expect(d.readiness).toBeCloseTo(0.6);
  });
  it('is UNAVAILABLE without the required role, ON_MISSION while out, READY when complete', () => {
    const noDriver = deriveTeam(team, members.slice(1), APS, NOW);
    expect(noDriver.status).toBe('UNAVAILABLE');
    expect(noDriver.warnings).toEqual(
      expect.arrayContaining(['BELOW_MIN_CREW', 'MISSING_ROLE:DRIVER_OPERATOR']),
    );
    const out = members.map((m) => ({ ...m, status: 'ON_MISSION' as const }));
    expect(deriveTeam(team, out, APS, NOW).status).toBe('ON_MISSION');
    const full = [...members, operator({ id: 'per_4' }), operator({ id: 'per_5' })];
    const ready = deriveTeam({ ...team, memberIds: full.map((m) => m.id) }, full, APS, NOW);
    expect(ready).toEqual({ status: 'READY', readiness: 1, warnings: [] });
    expect(deriveTeam({ ...team, memberIds: [] }, [], APS, NOW).warnings).toEqual(['NO_MEMBERS']);
  });
});

describe('personnel domain', () => {
  it('seeds the starter crew: the first vehicle is fully crewed and the quarters are counted', () => {
    const w = world();
    const people = w.domain.list(w.career);
    expect(people).toHaveLength(6);
    expect(z.array(PersonnelDto).safeParse(people).success).toBe(true);
    expect(w.career.vehicles[0]!.crew).toEqual({ min: 3, optimal: 5, assigned: 5 });
    expect(hq(w.career).capacities.find((c) => c.domain === 'PERSONNEL')).toMatchObject({ used: 6 });
    const option = w.engine.dispatchOptions(w.career, w.career.incidents[0]!.id).options[0]!;
    expect(option.dispatchable).toBe(true);
    expect(CrewPreview.parse(option.crew)).toMatchObject({ available: 5, min: 3, optimal: 5, efficiency: 1 });
  });

  it('draws the crew at dispatch, tires it on return and keeps vehicle.crew.assigned in sync', () => {
    const w = world(12);
    const incident = w.career.incidents[0]!;
    w.engine.dispatch(w.career, incident.id, [w.career.vehicles[0]!.id]);
    const out = w.domain.list(w.career).filter((p) => p.status === 'ON_MISSION');
    expect(out).toHaveLength(5);
    expect(out.every((p) => p.busyReason === 'MISSION' && p.fatigue.ratePerSecond === 0)).toBe(true);
    expect(w.events.some((e) => e.type === 'personnel.updated')).toBe(true);
    w.advance(120_000);
    expect(w.career.vehicles[0]!.status).toBe('AVAILABLE');
    const back = w.domain.list(w.career);
    expect(back.every((p) => p.status === 'AVAILABLE')).toBe(true);
    expect(back.filter((p) => p.missions === 1)).toHaveLength(5);
    const detail = w.domain.detail(w.career, back.find((p) => p.missions === 1)!.id);
    expect(PersonnelDetailDto.safeParse(detail).success).toBe(true);
    expect(detail.history.map((h) => h.kind)).toEqual(['MISSION', 'HIRED']);
    expect(detail.fatigue.ratePerSecond).toBeLessThan(0);
  });

  it('gives the crew back untired when the vehicle is recalled while preparing', () => {
    const w = world();
    const vehicle = w.career.vehicles[0]!;
    w.engine.dispatch(w.career, w.career.incidents[0]!.id, [vehicle.id]);
    w.engine.recall(w.career, vehicle.id);
    const people = w.domain.list(w.career);
    expect(people.every((p) => p.status === 'AVAILABLE' && p.missions === 0)).toBe(true);
  });

  it('blocks a vehicle without a qualified crew, and qa.staffAll fixes it', () => {
    const w = world();
    const second = w.engine.addVehicle(w.career, 'FIRE_APS', hq(w.career).id, true);
    const incident = w.career.incidents[0]!;
    w.engine.dispatch(w.career, incident.id, [w.career.vehicles[0]!.id]);
    const blocked = w.engine
      .dispatchOptions(w.career, incident.id)
      .options.find((o) => o.vehicleId === second.id)!;
    expect(blocked).toMatchObject({ dispatchable: false, blockedReason: 'CREW_INSUFFICIENT' });
    expect(() => w.engine.dispatch(w.career, incident.id, [second.id])).toThrowError(
      expect.objectContaining({ code: 'CREW_INSUFFICIENT' }),
    );
    w.engine.qa.staffAll();
    const option = w.engine
      .dispatchOptions(w.career, incident.id)
      .options.find((o) => o.vehicleId === second.id)!;
    expect(option.dispatchable).toBe(true);
    expect(option.crew).toMatchObject({ available: 5, missingQualifications: [] });
    const row = hq(w.career).capacities.find((c) => c.domain === 'PERSONNEL')!;
    expect(row.used).toBeLessThanOrEqual(row.total);
  });

  it('shares operators fairly when two vehicles leave together (minimum first, then top up)', () => {
    const w = world();
    const second = w.engine.addVehicle(w.career, 'FIRE_APS', hq(w.career).id, true);
    w.domain.quickHire(w.career, { roleCode: 'DRIVER_OPERATOR', facilityId: hq(w.career).id, count: 1 });
    w.advance(13_000);
    // 7 operators for two engines (min 3, optimal 5): a greedy first crew of 5 would leave the second one blocked.
    w.engine.dispatch(w.career, w.career.incidents[0]!.id, [w.career.vehicles[0]!.id, second.id]);
    const crews = w.domain.state(w.career).crews;
    expect(
      Object.values(crews)
        .map((c) => c.length)
        .sort(),
    ).toEqual([3, 4]);
    expect(w.career.vehicles.map((v) => v.crew.assigned)).toEqual(
      w.career.vehicles.map((v) => crews[v.id]!.length),
    );
  });

  it('exhausted operators block the dispatch until they rest; REST_DONE follows the timer convention', () => {
    const w = world();
    w.engine.qa.tireAll?.(90 as never);
    const incident = w.career.incidents[0]!;
    expect(w.engine.dispatchOptions(w.career, incident.id).options[0]).toMatchObject({
      dispatchable: false,
      blockedReason: 'CREW_EXHAUSTED',
    });
    const op = w.domain.list(w.career)[0]!;
    expect(op.fatigue.band).toBe('REST_REQUIRED');
    const resting = w.domain.rest(w.career, op.id);
    expect(resting).toMatchObject({ status: 'RESTING', busyReason: 'REST' });
    const action = w.engine.findAction(w.career, ['REST_DONE'], op.id)!;
    expect(Date.parse(resting.busyUntil!)).toBe(action.dueAt);
    w.engine.completeNow(w.career, action);
    const rested = w.domain.list(w.career).find((p) => p.id === op.id)!;
    expect(rested).toMatchObject({ status: 'AVAILABLE', busyUntil: null });
    expect(rested.fatigue.value).toBe(0);
    expect(() => w.domain.rest(w.career, op.id)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  });

  it('quick hire: cost, ledger, onboarding timer, capacity and role gates', () => {
    const w = world();
    const before = Number(w.career.summary.credits);
    const hired = w.domain.quickHire(w.career, {
      roleCode: 'FIREFIGHTER',
      facilityId: hq(w.career).id,
      count: 2,
    });
    expect(hired.map((p) => p.status)).toEqual(['ONBOARDING', 'ONBOARDING']);
    expect(Number(w.career.summary.credits)).toBe(before - 160);
    expect(w.career.ledger[0]).toMatchObject({ entryType: 'PERSONNEL_HIRE', amount: '-160' });
    expect(w.engine.findAction(w.career, ['ONBOARDING_DONE'], hired[0]!.id)).toBeDefined();
    w.advance(13_000);
    expect(w.domain.list(w.career).filter((p) => p.status === 'AVAILABLE')).toHaveLength(8);
    expect(w.career.notifications[0]).toMatchObject({ category: 'PERSONNEL' });
    const hire = (roleCode: string, count = 1) =>
      w.domain.quickHire(w.career, { roleCode, facilityId: hq(w.career).id, count });
    expect(() => hire('TEAM_LEADER')).toThrowError(expect.objectContaining({ code: 'LEVEL_TOO_LOW' }));
    expect(() => hire('RESCUER')).toThrowError(expect.objectContaining({ code: 'NOT_UNLOCKED' }));
    expect(() => hire('FIREFIGHTER', 5)).toThrowError(expect.objectContaining({ code: 'CAPACITY_EXCEEDED' }));
    w.engine.credit(w.career, -Number(w.career.summary.credits), 'ADMIN_ADJUSTMENT');
    expect(() => hire('FIREFIGHTER')).toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_CREDITS' }));
  });

  it('candidates market: timed refresh only, hire moves the candidate into the roster', () => {
    const w = world();
    w.level(3);
    w.engine.credit(w.career, 5000, 'ADMIN_ADJUSTMENT');
    const market = w.domain.candidates(w.career);
    expect(CandidatesResult.safeParse(market).success).toBe(true);
    expect(market.candidates).toHaveLength(5);
    expect(w.engine.findAction(w.career, ['CANDIDATES_REFRESH'], w.career.summary.id)!.dueAt).toBe(
      Date.parse(market.nextRefreshAt),
    );
    const candidate = market.candidates.find((c) => c.family === 'FIRE')!;
    const hired = w.domain.hireCandidate(w.career, candidate.id, hq(w.career).id);
    expect(hired).toMatchObject({
      lastName: candidate.lastName,
      status: 'ONBOARDING',
      competence: candidate.competence,
    });
    expect(w.domain.candidates(w.career).candidates.map((c) => c.id)).not.toContain(candidate.id);
    expect(() => w.domain.hireCandidate(w.career, candidate.id, hq(w.career).id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    w.advance(60_000, 5000);
    w.engine.completeNow(
      w.career,
      w.engine.findAction(w.career, ['CANDIDATES_REFRESH'], w.career.summary.id)!,
    );
    expect(Date.parse(w.domain.candidates(w.career).nextRefreshAt)).toBeGreaterThan(
      Date.parse(market.nextRefreshAt),
    );
  });

  it('teams are gated by level 4; members, leader and vehicle produce a derived status', () => {
    const w = world();
    const body = { name: 'Squadra Alfa', facilityId: hq(w.career).id };
    expect(() => w.domain.createTeam(w.career, body)).toThrowError(
      expect.objectContaining({
        code: 'LEVEL_TOO_LOW',
        details: expect.objectContaining({ requiredLevel: 4 }),
      }),
    );
    w.level(4);
    const team = w.domain.createTeam(w.career, body);
    expect(team).toMatchObject({ status: 'UNAVAILABLE', warnings: ['NO_MEMBERS'] });
    const people = w.domain.list(w.career);
    const driver = people.find((p) => p.roleCode === 'DRIVER_OPERATOR')!;
    const memberIds = [driver.id, ...people.filter((p) => p.roleCode === 'FIREFIGHTER').map((p) => p.id)];
    expect(() =>
      w.domain.setTeamMembers(w.career, team.id, {
        memberIds: memberIds.slice(0, 2),
        leaderId: people[0]!.id,
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    w.domain.setTeamMembers(w.career, team.id, { memberIds, leaderId: driver.id });
    const ready = w.domain.setTeamVehicle(w.career, team.id, w.career.vehicles[0]!.id);
    expect(TeamDto.safeParse(ready).success).toBe(true);
    expect(ready).toMatchObject({ status: 'READY', readiness: 1, warnings: [], leaderId: driver.id });
    expect(w.domain.list(w.career).filter((p) => p.status === 'ASSIGNED')).toHaveLength(5);
    // an operator belongs to one team only
    const other = w.domain.createTeam(w.career, { ...body, name: 'Squadra Bravo' });
    w.domain.setTeamMembers(w.career, other.id, { memberIds: [driver.id] });
    const first = w.domain.teams(w.career).find((t) => t.id === team.id)!;
    expect(first.memberIds).not.toContain(driver.id);
    expect(first.leaderId).toBeNull();
    expect(first.warnings).toContain('MISSING_ROLE:DRIVER_OPERATOR');
    expect(w.domain.updateTeam(w.career, team.id, { name: 'Prima partenza' }).name).toBe('Prima partenza');
    expect(() =>
      w.domain.createDepartment(w.career, { name: 'Reparto', family: 'FIRE', facilityId: hq(w.career).id }),
    ).toThrowError(expect.objectContaining({ code: 'LEVEL_TOO_LOW' }));
  });

  it('training: slots, eligibility, completion grants the qualification, cancel refunds half', () => {
    const w = world();
    const people = w.domain.list(w.career);
    const firefighters = people.filter((p) => p.roleCode === 'FIREFIGHTER');
    const enrol = (ids: string[], courseCode = 'COURSE_HEAVY_VEHICLE_LICENSE') =>
      w.domain.enroll(w.career, { courseCode, personnelIds: ids });
    expect(() => enrol([firefighters[0]!.id])).toThrowError(
      expect.objectContaining({ code: 'LEVEL_TOO_LOW' }),
    );
    w.level(2);
    const overview = w.domain.training(w.career);
    expect(TrainingOverview.safeParse(overview).success).toBe(true);
    expect(overview.slots[0]).toMatchObject({ total: 2, used: 0 });
    expect(overview.courses.find((c) => c.code === 'COURSE_SAF')!.unlocked).toBe(false);
    const leader = people.find((p) => p.roleCode === 'TEAM_LEADER')!;
    expect(() => enrol([leader.id])).toThrowError(
      expect.objectContaining({ details: expect.objectContaining({ reason: 'ROLE_NOT_ELIGIBLE' }) }),
    );
    expect(() => enrol(firefighters.slice(0, 3).map((p) => p.id))).toThrowError(
      expect.objectContaining({ code: 'CAPACITY_EXCEEDED' }),
    );
    const credits = Number(w.career.summary.credits);
    const [a, b] = enrol(firefighters.slice(0, 2).map((p) => p.id));
    expect(z.array(EnrollmentDto).safeParse([a, b]).success).toBe(true);
    expect(Number(w.career.summary.credits)).toBe(credits - 120);
    expect(w.career.ledger[0]!.entryType).toBe('TRAINING');
    expect(w.engine.findAction(w.career, ['TRAINING_DONE'], a!.id)!.dueAt).toBe(Date.parse(a!.endsAt));
    expect(w.domain.cancelEnrollment(w.career, b!.id).status).toBe('CANCELLED');
    expect(Number(w.career.summary.credits)).toBe(credits - 90);
    w.advance(95_000, 1000);
    const trained = w.domain.list(w.career).find((p) => p.id === a!.personnelId)!;
    expect(trained.status).toBe('AVAILABLE');
    expect(trained.qualifications.map((q) => q.code)).toContain('HEAVY_VEHICLE_LICENSE');
    expect(w.domain.training(w.career).enrollments.map((e) => e.status)).toEqual(['COMPLETED', 'CANCELLED']);
    expect(() => enrol([trained.id])).toThrowError(
      expect.objectContaining({ details: expect.objectContaining({ reason: 'ALREADY_QUALIFIED' }) }),
    );
  });

  it('transfer reserves a bed at the destination and dismissing frees it; busy operators stay', () => {
    const w = world();
    const op = w.domain.list(w.career)[5]!;
    expect(() => w.domain.transfer(w.career, op.id, hq(w.career).id)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
    w.engine.dispatch(w.career, w.career.incidents[0]!.id, [w.career.vehicles[0]!.id]);
    const busy = w.domain.list(w.career).find((p) => p.status === 'ON_MISSION')!;
    expect(() => w.domain.dismiss(w.career, busy.id)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
    const free = w.domain.list(w.career).find((p) => p.status === 'AVAILABLE')!;
    w.domain.dismiss(w.career, free.id);
    expect(w.domain.list(w.career)).toHaveLength(5);
    expect(hq(w.career).capacities.find((c) => c.domain === 'PERSONNEL')!.used).toBe(5);
  });

  it('the personnel cost per period is what the stipend deducts', () => {
    const w = world();
    const total = w.engine.hooks.stipendDeductions.reduce((s, h) => s + h(w.career), 0);
    expect(total).toBe(8 + 5 + 4 * 4);
  });

  it('qa.injure: MINOR injury with a recovery timer, then back to AVAILABLE', () => {
    const w = world();
    const op = w.domain.list(w.career)[2]!;
    (w.engine.qa.injure as unknown as (id: string) => void)(op.id);
    const detail = w.domain.detail(w.career, op.id);
    expect(detail).toMatchObject({ status: 'INJURED', busyReason: 'INJURY', injury: { severity: 'MINOR' } });
    w.engine.completeNow(w.career, w.engine.findAction(w.career, ['INJURY_RECOVERED'], op.id)!);
    expect(w.domain.detail(w.career, op.id)).toMatchObject({ status: 'AVAILABLE', injury: null });
  });

  it('vehicle crew gaps: the specialist roles the career can neither staff nor hire now, per vehicle type', () => {
    const w = world();
    const gaps = z.array(VehicleCrewGapDto).parse(w.domain.vehicleCrewGaps(w.career));
    // Quick-hire roles are never a gap; a specialist (candidate market only) is one while nobody holds or offers it.
    const quick = new Set(['FIREFIGHTER', 'DRIVER_OPERATOR', 'RESCUER', 'DRIVER', 'OFFICER']);
    for (const gap of gaps) {
      expect(gap.missingRoles.length).toBeGreaterThan(0);
      for (const role of gap.missingRoles) expect(quick.has(role)).toBe(false);
    }
    const offered = new Set(w.domain.candidates(w.career).candidates.map((c) => c.roleCode));
    const heli = gaps.find((g) => g.vehicleTypeCode === 'FIRE_HELI');
    if (offered.has('PILOT')) expect(heli?.missingRoles ?? []).not.toContain('PILOT');
    else expect(heli?.missingRoles).toContain('PILOT');
    // Holding the role closes the gap.
    w.domain.staffAll(w.career);
    w.engine.addVehicle(w.career, 'FIRE_HELI', hq(w.career).id, true);
    w.domain.staffAll(w.career);
    expect(
      w.domain.vehicleCrewGaps(w.career).find((g) => g.vehicleTypeCode === 'FIRE_HELI')?.missingRoles ?? [],
    ).not.toContain('PILOT');
  });
});
