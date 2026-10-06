import { describe, expect, it } from 'vitest';
import { AidColumnDto, AidRequestDto, type RealtimeEnvelope } from '@/contracts';
import { xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockEngine, OTP_CODE, memoryStorage, type MockCareer, type MockError } from '../engine';
import { installDomains } from './index';
import { allianceApiOf } from './alliance';
import { allianceAidOf } from './alliance-aid';

function world() {
  let now = Date.parse('2026-10-06T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 13;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random,
  });
  installDomains(engine);
  engine.state.featureFlags.alliance_aid = true;
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
  engine.awardXp(career, xpThreshold(5));
  engine.credit(career, 5000, 'ADMIN_ADJUSTMENT');
  const tutorial = career.incidents.find((i) => i.isTutorial);
  if (tutorial) engine.close(career, tutorial, 'CANCELLED', now);
  engine.advanceTutorial(career, 'DONE');
  const alliances = allianceApiOf(engine);
  const aid = allianceAidOf(engine);
  const qa = engine.qa as unknown as Record<string, (...a: never[]) => unknown>;
  alliances.found(career, {
    name: 'Abruzzo Soccorso',
    tag: 'ABR',
    emblem: { shape: 'SHIELD', symbol: 'FLAME', primaryColor: 'RED', secondaryColor: 'SILVER' },
    description: '',
    language: 'it',
    joinPolicy: 'OPEN',
    minLevel: null,
  });
  const invite = alliances.createInvite(career);
  const marta = (qa.simulateAlly as (n: string, o?: Record<string, unknown>) => { careerId: string })(
    'Marta',
    { level: 5 },
  ).careerId;
  const martaCareer = engine.state.careers[marta]!;
  alliances.join(martaCareer, { inviteCode: invite.code });
  (qa.allyAddVehicles as (id: string, type: string, n: number) => string[])(marta, 'FIRE_APS', 3);
  return {
    engine,
    career,
    martaCareer,
    events,
    alliances,
    aid,
    qa,
    advance: (ms: number) => {
      now += ms;
      engine.process();
    },
  };
}
const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as MockError;
  }
  throw new Error('expected a MockError');
};
/** A fire with REQUIRED needs the requester cannot cover: his only engine is kept out of the way. */
function sharedFire(w: ReturnType<typeof world>) {
  for (const v of w.career.vehicles) w.engine.patchVehicle(w.career, v.id, { status: 'MAINTENANCE' });
  const incident = w.engine.spawnIncident(w.career, 'FIRE_DWELLING', false, { severity: 6 });
  return incident;
}

describe('mock mutual aid', () => {
  it('a request needs a real gap, is one per incident and shares the incident; useful allies are notified', () => {
    const w = world();
    const incident = sharedFire(w);
    const request = w.aid.createRequest(w.career, incident.id, null);
    expect(AidRequestDto.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({
      status: 'OPEN',
      mine: true,
      viewer: { canSend: false, blockedReason: 'OWN_REQUEST' },
    });
    expect(request.gaps.length).toBeGreaterThan(0);
    expect(request.gaps.every((g) => g.initial > 0 && g.missing === g.initial)).toBe(true);
    const shared = w.career.incidents.find((i) => i.id === incident.id)!;
    expect(shared).toMatchObject({ visibility: 'ALLIANCE', aidRequestId: request.id, allied: [] });
    expect(error(() => w.aid.createRequest(w.career, incident.id, null)).details).toMatchObject({
      reason: 'ALREADY_REQUESTED',
    });
    // Marta owns engines that bring the missing capability: she is told; she sees the request as sendable.
    expect(w.martaCareer.notifications[0]).toMatchObject({
      category: 'ALLIANCE',
      action: { targetId: `aid:${request.id}` },
    });
    const seen = w.aid.listRequests(w.martaCareer, {}).data[0]!;
    expect(seen).toMatchObject({
      id: request.id,
      mine: false,
      viewer: { canSend: true, blockedReason: null },
    });
    expect(seen.distanceKm).not.toBeNull();
    // A covered incident has no real gap.
    const covered = w.engine.spawnIncident(w.career, 'FIRE_DWELLING', false, { severity: 2 });
    w.engine.patchIncident(w.career, covered.id, {
      requirements: covered.requirements.map((r) => ({ ...r, onScene: r.required })),
    });
    expect(error(() => w.aid.createRequest(w.career, covered.id, null)).code).toBe('NO_REAL_GAP');
    // Cancelling makes it private again.
    expect(w.aid.cancelRequest(w.career, request.id).status).toBe('CANCELLED');
    expect(w.career.incidents.find((i) => i.id === incident.id)!.visibility).toBe('PRIVATE');
  });

  it('a column leaves the helper (ALLIED_SUPPORT), arrives within 2–15 min, covers the gap, is settled on resolution and comes back', () => {
    const w = world();
    const incident = sharedFire(w);
    const request = w.aid.createRequest(w.career, incident.id, null);
    const options = w.aid.columnOptions(w.martaCareer, request.id);
    expect(options.vehicles.length).toBeGreaterThan(0);
    expect(options.vehicles.every((v) => v.etaSeconds >= 120 && v.etaSeconds <= 900)).toBe(true);
    expect(options.maxVehicles).toBe(4);
    expect(
      error(() =>
        w.aid.sendColumn(
          w.martaCareer,
          request.id,
          options.vehicles
            .map((v) => v.vehicleId)
            .concat(['veh_01J8Z0000000000000000000AA', 'veh_01J8Z0000000000000000000AB']),
        ),
      ).details,
    ).toMatchObject({ reason: 'TOO_MANY_VEHICLES' });
    const column = w.aid.sendColumn(w.martaCareer, request.id, [
      options.vehicles[0]!.vehicleId,
      options.vehicles[1]!.vehicleId,
    ]);
    expect(AidColumnDto.safeParse(column).success).toBe(true);
    expect(column).toMatchObject({ status: 'EN_ROUTE', mine: true, items: [{}, {}] });
    const lent = w.martaCareer.vehicles.find((v) => v.id === column.items[0]!.vehicleId)!;
    expect(lent).toMatchObject({ status: 'ALLIED_SUPPORT', incidentId: null, movement: null });
    expect(lent.alliedSupport).toMatchObject({
      columnId: column.id,
      requester: { directorName: 'Federico', tag: 'ABR' },
      status: 'EN_ROUTE',
    });
    expect(
      error(() => w.aid.sendColumn(w.martaCareer, request.id, [options.vehicles[2]!.vehicleId])).details,
    ).toMatchObject({ reason: 'ONE_PER_REQUEST' });
    const before = BigInt(w.martaCareer.summary.credits);
    // The requester sees the column coming.
    const live = () => w.career.incidents.find((i) => i.id === incident.id)!;
    expect(live().allied).toHaveLength(1);
    expect(live().allied![0]).toMatchObject({
      helper: { directorName: 'Marta', tag: 'ABR' },
      status: 'EN_ROUTE',
    });
    // Arrival: the capability lands on the incident, the coverage follows.
    w.advance(Date.parse(column.arriveAt) - w.engine.now() + 1000);
    expect(w.aid.getRequest(w.career, request.id).columns[0]!.status).toBe('ON_SCENE');
    const after = live();
    expect(after.requirements.some((r) => (r.allied ?? 0) > 0)).toBe(true);
    expect(after.coverageRatio).toBeGreaterThan(0);
    expect(after.status).toBe('ON_SCENE');
    // Five minutes of useful work on scene, then the incident resolves: the helper is paid from the fund (share × time
    // factor, 05 §6.2), the column returns, the vehicles are available again.
    w.advance(5 * 60_000);
    // With the allied cover the work may already be done (the engine resolved it): close only if still open.
    const open = w.career.incidents.find((i) => i.id === incident.id);
    if (open) w.engine.close(w.career, open, 'RESOLVED', w.engine.now());
    const settled = w.aid.listColumns(w.martaCareer, { role: 'GIVEN' }).data[0]!;
    expect(settled.reward.status).toBe('PAID');
    expect(BigInt(w.martaCareer.summary.credits)).toBeGreaterThan(before);
    expect(['RETURNING', 'RETURNED']).toContain(settled.status);
    expect(w.aid.getRequest(w.career, request.id).status).toBe('CLOSED');
    if (settled.status === 'RETURNING') w.advance(Date.parse(settled.returnAt!) - w.engine.now() + 1000);
    expect(w.martaCareer.vehicles.find((v) => v.id === column.items[0]!.vehicleId)).toMatchObject({
      status: 'AVAILABLE',
      alliedSupport: null,
    });
    expect(w.aid.listColumns(w.martaCareer, { role: 'GIVEN' }).data[0]!.status).toBe('RETURNED');
    expect(w.martaCareer.ledger[0]).toMatchObject({ entryType: 'ALLIANCE_AID' });
  });

  it('a recalled column stops covering; an aborted one (incident over first) earns nothing', () => {
    const w = world();
    const incident = sharedFire(w);
    const request = w.aid.createRequest(w.career, incident.id, null);
    const options = w.aid.columnOptions(w.martaCareer, request.id);
    const column = w.aid.sendColumn(w.martaCareer, request.id, [options.vehicles[0]!.vehicleId]);
    w.advance(Date.parse(column.arriveAt) - w.engine.now() + 1000);
    expect(
      w.career.incidents.find((i) => i.id === incident.id)!.requirements.some((r) => (r.allied ?? 0) > 0),
    ).toBe(true);
    const recalled = w.aid.recall(w.martaCareer, column.id);
    expect(recalled.status).toBe('RECALLED');
    expect(
      w.career.incidents.find((i) => i.id === incident.id)!.requirements.every((r) => (r.allied ?? 0) === 0),
    ).toBe(true);
    expect(w.career.incidents.find((i) => i.id === incident.id)!.allied).toHaveLength(0);
    // A second column, aborted because the incident is cancelled before it arrives.
    const w2 = world();
    const incident2 = sharedFire(w2);
    const request2 = w2.aid.createRequest(w2.career, incident2.id, null);
    const options2 = w2.aid.columnOptions(w2.martaCareer, request2.id);
    const column2 = w2.aid.sendColumn(w2.martaCareer, request2.id, [options2.vehicles[0]!.vehicleId]);
    w2.engine.close(
      w2.career,
      w2.career.incidents.find((i) => i.id === incident2.id)!,
      'CANCELLED',
      w2.engine.now(),
    );
    const aborted = w2.aid
      .listColumns(w2.martaCareer, { role: 'GIVEN' })
      .data.find((c) => c.id === column2.id)!;
    expect(aborted.status).toBe('ABORTED');
    expect(aborted.reward.status).toBe('NONE');
  });
});
