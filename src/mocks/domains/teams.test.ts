import { describe, expect, it } from 'vitest';
import {
  FacilityDto,
  TeamDto,
  TeamProposalDto,
  TransferTeamResult,
  TransferVehicleResult,
  type RealtimeEnvelope,
} from '@/contracts';
import { FACILITY_TYPES, xpThreshold } from '../data/catalog';
import { CANDIDATE_SITES, PESCARA } from '../data/pescara';
import { MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { installDomains } from './index';
import { acquireFacility, listSites, transferVehicle } from './facilities';
import { personnelDomain } from './personnel';

/**
 * The simplified teams (analisi/studio-2026-10-12-squadre) in the simulation, rule by rule as in the backend suite
 * `tests/integration/teams.test.ts`: formed from a vehicle with the recommended crew, dissolved at any time, moved together
 * with the vehicle, the leader derived. Same identifiers (`details.reason`) and limits.
 */
function world() {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  const ch = engine.requestOtp('t@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Director T',
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
  const advance = (seconds: number) => {
    now += seconds * 1000;
    engine.process();
  };
  engine.awardXp(career, xpThreshold(4) - Number(career.summary.xp)); // teams open at level 4
  engine.credit(career, 500_000, 'ADMIN_ADJUSTMENT', true);
  return { engine, events, career, advance, domain: personnelDomain(engine), now: () => now };
}
type World = ReturnType<typeof world>;

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof MockError ? e.code : 'THROWN';
  }
  return 'OK';
};
const reason = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e instanceof MockError ? (e.details as { reason?: string } | undefined)?.reason : 'THROWN';
  }
  return undefined;
};

/** A second, operational local station. */
function secondStation(w: World): string {
  const site = listSites(w.engine, w.career, null).find(
    (s) => s.name === CANDIDATE_SITES.find((c) => c.key === 'fire-north')!.name,
  )!;
  const detail = acquireFacility(w.engine, w.career, {
    siteId: site.id,
    facilityTypeCode: 'FIRE_LOCAL_STATION',
  });
  w.advance(FACILITY_TYPES.find((f) => f.code === 'FIRE_LOCAL_STATION')!.setupSeconds + 1);
  return detail.id;
}
const withTeam = (w: World) => {
  const vehicle = w.career.vehicles[0]!;
  const team = w.domain.createTeam(w.career, { vehicleId: vehicle.id });
  return { vehicle, team };
};
const moveVehicle = (w: World) => (vehicleId: string, facilityId: string) =>
  transferVehicle(w.engine, w.career, vehicleId, facilityId, true);

describe('forming a team from a vehicle', () => {
  it('proposes the recommended crew and forms the team in one call', () => {
    const w = world();
    const vehicle = w.career.vehicles[0]!;
    const people = w.domain.list(w.career);
    const proposal = w.domain.teamProposal(w.career, vehicle.id);
    expect(TeamProposalDto.safeParse(proposal).success).toBe(true);
    expect(proposal).toMatchObject({
      vehicleId: vehicle.id,
      min: 3,
      optimal: 5,
      available: 6,
      remainingFree: 1,
      teamId: null,
    });
    expect(proposal.memberIds).toHaveLength(5);
    const driver = people.find((p) => p.roleCode === 'DRIVER_OPERATOR')!;
    const leader = people.find((p) => p.roleCode === 'TEAM_LEADER')!;
    expect(proposal.memberIds).toContain(driver.id);
    expect(proposal.leaderId).toBe(leader.id);
    expect(proposal.efficiency).toBeGreaterThan(0.9);

    const team = w.domain.createTeam(w.career, { vehicleId: vehicle.id });
    expect(TeamDto.safeParse(team).success).toBe(true);
    expect(team).toMatchObject({
      name: vehicle.callSign,
      vehicleId: vehicle.id,
      facilityId: vehicle.facilityId,
      leaderId: leader.id,
      status: 'READY',
      transferUntil: null,
    });
    expect([...team.memberIds].sort()).toEqual([...proposal.memberIds].sort());
    expect(team.warnings).not.toContain('NO_LEADER');
    expect(
      w.domain
        .list(w.career)
        .filter((p) => team.memberIds.includes(p.id))
        .every((p) => p.status === 'ASSIGNED'),
    ).toBe(true);
    expect(w.career.vehicles[0]!.crew.assigned).toBe(5);
    expect(w.domain.teamProposal(w.career, vehicle.id)).toMatchObject({ teamId: team.id, memberIds: [] });
    expect(reason(() => w.domain.createTeam(w.career, { vehicleId: vehicle.id }))).toBe('VEHICLE_HAS_TEAM');
  });

  it('takes the name and members the player chose; refuses a vehicle that is not theirs', () => {
    const w = world();
    const vehicle = w.career.vehicles[0]!;
    const picked = w.domain
      .list(w.career)
      .slice(0, 3)
      .map((p) => p.id);
    const team = w.domain.createTeam(w.career, {
      vehicleId: vehicle.id,
      name: 'Prima partenza',
      memberIds: picked,
    });
    expect(team.name).toBe('Prima partenza');
    expect([...team.memberIds].sort()).toEqual([...picked].sort());
    expect(
      w.domain
        .list(w.career)
        .filter((p) => !picked.includes(p.id))
        .every((p) => p.status === 'AVAILABLE' && p.teamId === null),
    ).toBe(true);
    expect(code(() => w.domain.createTeam(w.career, { vehicleId: 'veh_nope' }))).toBe('NOT_FOUND');
    expect(code(() => w.domain.teamProposal(w.career, 'veh_nope'))).toBe('NOT_FOUND');
  });

  it('leaves the others free: the next vehicle gets what is left, and with nobody left there is nothing to form', () => {
    const w = world();
    const { vehicle } = withTeam(w);
    const second = w.engine.addVehicle(w.career, 'FIRE_APS', w.career.facilities[0]!.id, true);
    const proposal = w.domain.teamProposal(w.career, second.id);
    expect(proposal.memberIds).toHaveLength(1);
    expect(proposal).toMatchObject({ remainingFree: 0, efficiency: 0 });
    w.domain.createTeam(w.career, { vehicleId: second.id });
    const third = w.engine.addVehicle(w.career, 'FIRE_APS', w.career.facilities[0]!.id, true);
    expect(w.domain.teamProposal(w.career, third.id).memberIds).toEqual([]);
    expect(code(() => w.domain.createTeam(w.career, { vehicleId: third.id }))).toBe('CREW_INSUFFICIENT');
    expect(vehicle.id).not.toBe(second.id);
  });

  it('never draws a member of a team that holds ANOTHER vehicle', () => {
    const w = world();
    withTeam(w);
    const second = w.engine.addVehicle(w.career, 'FIRE_APS', w.career.facilities[0]!.id, true);
    const incident = w.career.incidents[0]!;
    // The only free operator is not enough for the minimum crew of the second engine: the team of the first one is not touched.
    expect(
      w.engine.dispatchOptions(w.career, incident.id).options.find((o) => o.vehicleId === second.id),
    ).toMatchObject({
      dispatchable: false,
      blockedReason: 'CREW_INSUFFICIENT',
    });
  });
});

describe('dissolving a team', () => {
  it('frees the operators and leaves the vehicle where it was', () => {
    const w = world();
    const { vehicle, team } = withTeam(w);
    w.domain.disbandTeam(w.career, team.id);
    expect(w.domain.teams(w.career)).toEqual([]);
    expect(w.domain.list(w.career).every((p) => p.status === 'AVAILABLE' && p.teamId === null)).toBe(true);
    expect(w.career.vehicles[0]).toMatchObject({
      id: vehicle.id,
      status: 'AVAILABLE',
      facilityId: vehicle.facilityId,
    });
    expect(code(() => w.domain.disbandTeam(w.career, team.id))).toBe('NOT_FOUND');
    expect(code(() => w.domain.createTeam(w.career, { vehicleId: vehicle.id }))).toBe('OK');
  });

  it('is allowed on a mission: the crew finishes it and comes back free, never ASSIGNED to a team that is gone', () => {
    const w = world();
    const { vehicle, team } = withTeam(w);
    w.engine.dispatch(w.career, w.career.incidents[0]!.id, [vehicle.id]);
    w.domain.disbandTeam(w.career, team.id);
    const during = w.domain.list(w.career).filter((p) => team.memberIds.includes(p.id));
    expect(during.every((p) => p.status === 'ON_MISSION' && p.teamId === null)).toBe(true);
    w.advance(600);
    const after = w.domain.list(w.career);
    expect(
      after
        .filter((p) => team.memberIds.includes(p.id))
        .every((p) => p.status === 'AVAILABLE' || p.status === 'RESTING'),
    ).toBe(true);
    expect(after.some((p) => p.status === 'ASSIGNED')).toBe(false);
  });
});

describe('moving a team to another facility', () => {
  it('moves the team with its vehicle: one trip, one arrival, beds follow, back in service on arrival', () => {
    const w = world();
    const { vehicle, team } = withTeam(w);
    const target = secondStation(w);
    const from = w.career.facilities[0]!.id;
    const bedsAt = (id: string) =>
      w.career.facilities.find((f) => f.id === id)!.capacities.find((c) => c.domain === 'PERSONNEL')!.used;
    const usedBefore = bedsAt(from);

    const result = w.domain.transferTeam(w.career, team.id, target, moveVehicle(w));
    expect(TransferTeamResult.safeParse(result).success).toBe(true);
    expect(result.team).toMatchObject({ facilityId: target, vehicleId: vehicle.id });
    expect(result.vehicle).toMatchObject({ status: 'IN_DELIVERY', facilityId: target });
    expect(result.team.transferUntil).not.toBeNull();
    expect(Date.parse(result.team.transferUntil!)).toBe(Date.parse(result.vehicle!.busyUntil!));
    const travelling = w.domain.list(w.career).filter((p) => team.memberIds.includes(p.id));
    expect(travelling.every((p) => p.status === 'TRANSFERRING' && p.busyReason === 'TRANSFER')).toBe(true);
    expect(bedsAt(target)).toBe(5);
    expect(bedsAt(from)).toBe(usedBefore - 5);
    result.facilities.forEach((f) => expect(FacilityDto.safeParse(f).success).toBe(true));

    // Frozen on the road.
    expect(reason(() => w.domain.setTeamMembers(w.career, team.id, { memberIds: [team.memberIds[0]] }))).toBe(
      'TEAM_IN_TRANSIT',
    );
    expect(reason(() => w.domain.transferTeam(w.career, team.id, from, moveVehicle(w)))).toBe(
      'TEAM_IN_TRANSIT',
    );

    w.advance(3600);
    const arrived = w.domain.list(w.career).filter((p) => team.memberIds.includes(p.id));
    expect(arrived.every((p) => p.status === 'ASSIGNED' && p.facilityId === target)).toBe(true);
    expect(w.career.vehicles[0]).toMatchObject({ status: 'AVAILABLE', facilityId: target });
    expect(w.domain.teams(w.career).find((t) => t.id === team.id)).toMatchObject({
      status: 'READY',
      transferUntil: null,
    });
  });

  it('arrives no sooner than an operator travelling alone: the vehicle trip is stretched to the operators', () => {
    const w = world();
    const { vehicle, team } = withTeam(w);
    const target = secondStation(w);
    const started = w.now();
    const result = w.domain.transferTeam(w.career, team.id, target, moveVehicle(w));
    // 180 s + 20 s/km, managerial time; the mock's driving time of a few km is shorter than the base.
    const floor = Math.max(10, Math.round(180 * 0.1)) * 1000;
    expect(Date.parse(result.team.transferUntil!) - started).toBeGreaterThanOrEqual(floor);
    expect(vehicle.id).toBe(result.vehicle!.id);
  });

  it('the vehicle transfer takes its team along, or releases it when asked (withTeam: false)', () => {
    const together = world();
    const a = withTeam(together);
    const targetA = secondStation(together);
    const movedA = transferVehicle(together.engine, together.career, a.vehicle.id, targetA);
    expect(TransferVehicleResult.safeParse(movedA).success).toBe(true);
    expect(together.domain.teams(together.career).find((t) => t.id === a.team.id)).toMatchObject({
      facilityId: targetA,
      vehicleId: a.vehicle.id,
    });
    expect(
      together.domain
        .list(together.career)
        .filter((p) => a.team.memberIds.includes(p.id))
        .every((p) => p.status === 'TRANSFERRING'),
    ).toBe(true);

    const alone = world();
    const b = withTeam(alone);
    const targetB = secondStation(alone);
    const home = alone.career.facilities[0]!.id;
    transferVehicle(alone.engine, alone.career, b.vehicle.id, targetB, false);
    expect(alone.domain.teams(alone.career).find((t) => t.id === b.team.id)).toMatchObject({
      facilityId: home,
      vehicleId: null,
    });
    expect(
      alone.domain.list(alone.career).every((p) => p.status === 'AVAILABLE' && p.facilityId === home),
    ).toBe(true);
  });

  it('leaves behind whoever cannot travel, and refuses when nobody can', () => {
    const w = world();
    const { team } = withTeam(w);
    const target = secondStation(w);
    const resting = team.memberIds[team.memberIds.length - 1]!;
    w.engine.qa.tire?.(resting as never, 70 as never);
    w.domain.rest(w.career, resting);
    const moved = w.domain.transferTeam(w.career, team.id, target, moveVehicle(w));
    expect(moved.team.memberIds).toHaveLength(4);
    expect(moved.team.memberIds).not.toContain(resting);
    expect(w.domain.list(w.career).find((p) => p.id === resting)).toMatchObject({
      status: 'RESTING',
      teamId: null,
    });

    const stuck = world();
    const s = withTeam(stuck);
    const dest = secondStation(stuck);
    for (const op of stuck.domain.state(stuck.career).people) op.status = 'TRAINING';
    expect(reason(() => stuck.domain.transferTeam(stuck.career, s.team.id, dest, moveVehicle(stuck)))).toBe(
      'TEAM_NOT_READY',
    );
    expect(stuck.career.vehicles[0]).toMatchObject({ status: 'AVAILABLE', facilityId: s.vehicle.facilityId });
  });

  it('moves a team without a vehicle on its own, and refuses a destination without beds', () => {
    const w = world();
    const hq = w.career.facilities[0]!;
    const team = w.domain.createTeam(w.career, { name: 'A piedi', facilityId: hq.id });
    const members = w.domain
      .list(w.career)
      .slice(0, 2)
      .map((p) => p.id);
    w.domain.setTeamMembers(w.career, team.id, { memberIds: members });
    const target = secondStation(w);
    const moved = w.domain.transferTeam(w.career, team.id, target, moveVehicle(w));
    expect(moved.vehicle).toBeNull();
    expect(moved.team).toMatchObject({ facilityId: target, vehicleId: null });
    w.advance(3600);
    expect(
      w.domain
        .list(w.career)
        .filter((p) => members.includes(p.id))
        .every((p) => p.status === 'AVAILABLE' && p.facilityId === target),
    ).toBe(true);

    const full = world();
    const f = withTeam(full);
    const dest = secondStation(full);
    // The simulation counts the operators based at a facility: fill the quarters of the destination by hiring into them.
    const total = full.career.facilities
      .find((x) => x.id === dest)!
      .capacities.find((c) => c.domain === 'PERSONNEL')!.total;
    full.domain.quickHire(full.career, {
      roleCode: 'FIREFIGHTER',
      facilityId: dest,
      count: Math.min(10, total),
    });
    if (total > 10)
      full.domain.quickHire(full.career, { roleCode: 'FIREFIGHTER', facilityId: dest, count: total - 10 });
    expect(() => full.domain.transferTeam(full.career, f.team.id, dest, moveVehicle(full))).toThrowError(
      expect.objectContaining({
        code: 'CAPACITY_EXCEEDED',
        details: expect.objectContaining({ reason: 'NO_BEDS', domain: 'PERSONNEL' }),
      }),
    );
    expect(
      code(() => full.domain.transferTeam(full.career, f.team.id, f.vehicle.facilityId, moveVehicle(full))),
    ).toBe('VALIDATION_ERROR');
  });
});

describe('the leader is automatic', () => {
  it('shows the most senior member when the stored leader is not a member any more', () => {
    const w = world();
    const { team } = withTeam(w);
    const leader = w.domain.list(w.career).find((p) => p.roleCode === 'TEAM_LEADER')!;
    expect(team.leaderId).toBe(leader.id);
    const without = team.memberIds.filter((id) => id !== leader.id);
    const updated = w.domain.setTeamMembers(w.career, team.id, { memberIds: without });
    expect(without).toContain(updated.leaderId);
    expect(updated.warnings).not.toContain('NO_LEADER');
    const chosen = without[without.length - 1]!;
    expect(
      w.domain.setTeamMembers(w.career, team.id, { memberIds: without, leaderId: chosen }).leaderId,
    ).toBe(chosen);
  });
});
