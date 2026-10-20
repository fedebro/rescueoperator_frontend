import { describe, expect, it } from 'vitest';
import { AdminFirstShiftDto, CareerSummary, IncidentDto, type RealtimeEnvelope } from '@/contracts';
import { MockEngine, TUTORIAL_BONUS, memoryStorage, type MockCareer } from './engine';
import { installDomains } from './domains';
import { chainOf } from './domains/dispatch-chain';
import { xpThreshold } from './data/catalog';
import { haversineMeters } from '@/lib/geo';
import {
  FIRST_SHIFT_DELIVERY_SECONDS,
  FIRST_SHIFT_MISSIONS,
  GENTLE_PERIOD,
  MISSION_3_MIN_RETURN_SECONDS,
  arrivalFactor,
  firstShiftReport,
  firstShiftReturnSeconds,
  missionRule,
} from './first-shift';

/**
 * Primo turno (D-148) in the simulation — the same rules as the server (analisi/note-agenti/primo-turno-server.md):
 * the 5 missions in order, near the first station, on scene within the cap, never lost, one call at a time, the next one on
 * a timer after the outcome, fixed rewards, level 2 at the end, then the normal generator with a gentle quarter of an hour.
 */
const SPEED = 4;

async function world(opts: { skipTutorial?: boolean } = {}) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
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
  await Promise.resolve();
  const { careerId } = engine.qa.createReadyCareer({
    email: 'primo@example.com',
    directorName: 'Dir Primo',
    tutorialDone: false,
    firstShift: true,
  });
  const career = engine.state.careers[careerId] as MockCareer;
  if (opts.skipTutorial) engine.advanceTutorial(career, 'DONE');
  const advance = (ms: number, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      career.lastSeenAt = now;
      engine.process();
    }
  };
  const until = (done: () => boolean, budgetMs = 600_000, step = 100): boolean => {
    for (let t = 0; t < budgetMs && !done(); t += step) advance(step, step);
    return done();
  };
  const open = (mission: number) => career.incidents.find((i) => i.firstShift?.mission === mission);
  /** Plays a mission with the given vehicles: dispatch, every unit on scene within the cap, outcome. */
  const play = (mission: number, vehicleIds?: string[]) => {
    const incident = open(mission)!;
    const ids = vehicleIds ?? engine.dispatchOptions(career, incident.id).recommendedVehicleIds;
    expect(ids.length).toBeGreaterThan(0);
    const at = now;
    engine.dispatch(career, incident.id, ids);
    const cap = incident.firstShift!.arrivalCapSeconds;
    expect(
      until(() => ids.every((id) => career.vehicles.find((v) => v.id === id)!.status === 'ON_SCENE')),
    ).toBe(true);
    // Within the cap (server seconds → mock ms), one process step of slack.
    expect(now - at).toBeLessThanOrEqual((cap * 1000) / SPEED + 250);
    expect(until(() => career.pendingOutcomes.some((o) => o.incidentId === incident.id))).toBe(true);
    return career.pendingOutcomes.find((o) => o.incidentId === incident.id)!;
  };
  return { engine, career, events, advance, until, open, play, now: () => now };
}

describe('primo turno in the simulation (mock = server)', () => {
  it('runs the 5 missions in order with the server numbers, then hands over to the normal generator', async () => {
    const w = await world();
    const { engine, career } = w;
    const hq = career.facilities[0]!.position;

    // ── mission 1: the tutorial call, near the station, protected
    expect(CareerSummary.shape.firstShift.parse(career.summary.firstShift)).toEqual({
      mission: 1,
      completed: 0,
      guided: true,
      nextCallAt: null,
    });
    expect(career.incidents).toHaveLength(1);
    const m1 = career.incidents[0]!;
    expect(IncidentDto.parse(m1).firstShift).toEqual({
      mission: 1,
      lesson: 'RESPOND',
      arrivalCapSeconds: 20,
    });
    expect(m1).toMatchObject({
      isTutorial: true,
      templateCode: 'FIRE_TRASH_BIN',
      severity: 1,
      expiresAt: null,
    });
    expect(m1.estimatedReward).toEqual({ min: '120', max: '120' });
    expect(haversineMeters(hq, m1.position)).toBeLessThan(700);
    expect(career.actions.some((a) => a.type === 'INCIDENT_SPAWN' || a.ref === m1.id)).toBe(false);
    // The ETA the player sees already honours the cap.
    const option = engine.dispatchOptions(career, m1.id).options[0]!;
    expect(option.etaSeconds).toBeLessThanOrEqual(Math.ceil(20 / SPEED));

    const o1 = w.play(1);
    expect(o1).toMatchObject({ result: 'SUCCESS', stars: 3, netCredits: '120', xp: '10' });
    expect(o1.costs.every((c) => c.amount === '0')).toBe(true);
    expect(career.summary.firstShift).toMatchObject({ mission: 2, completed: 1, guided: true });
    expect(Date.parse(career.summary.firstShift!.nextCallAt!) - w.now()).toBeLessThanOrEqual(
      (8 * 1000) / SPEED,
    );
    // One call at a time: the normal generator stays off.
    expect(career.actions.some((a) => a.type === 'INCIDENT_SPAWN')).toBe(false);
    engine.ackOutcome(career, o1.incidentId);
    expect(career.summary.tutorial.step).toBe('OUTCOME'); // stays there through mission 2

    // ── mission 2: technical rescue, chosen by hand
    expect(w.until(() => !!w.open(2))).toBe(true);
    // The engine came home before the call rang (the way home is timed on the next call, as the server).
    expect(career.vehicles.every((v) => v.status === 'AVAILABLE')).toBe(true);
    const m2 = w.open(2)!;
    expect(m2).toMatchObject({ templateCode: 'TECH_FALLEN_TREE', isTutorial: false, expiresAt: null });
    expect(career.summary.firstShift).toMatchObject({ mission: 2, nextCallAt: null });
    // Never lost: no expiry, no escalation, even if the player waits.
    w.advance(30 * 60_000, 1000);
    expect(w.open(2)).toMatchObject({ status: 'PENDING_RESPONSE', severity: 1 });
    w.play(2, [career.vehicles[0]!.id]);

    // ── mission 3: two vehicles — the bonus pays the second one, bought in the lesson
    expect(w.until(() => !!w.open(3))).toBe(true);
    expect(career.vehicles.every((v) => v.status === 'AVAILABLE')).toBe(true);
    const m3 = w.open(3)!;
    expect(m3).toMatchObject({ templateCode: 'FIRE_VEHICLE', severity: 3 });
    expect(career.summary.tutorial.step).toBe('BUY_VEHICLE');
    expect(Number(career.summary.credits)).toBeGreaterThanOrEqual(800);
    const bought = engine.buyVehicle(career, {
      vehicleTypeCode: 'FIRE_APS',
      facilityId: career.facilities[0]!.id,
    });
    expect(career.summary.tutorial.completed).toBe(false); // the purchase no longer ends the tutorial
    expect(Date.parse(bought.busyUntil!) - w.now()).toBe((FIRST_SHIFT_DELIVERY_SECONDS * 1000) / SPEED);
    expect(w.until(() => career.vehicles.find((v) => v.id === bought.id)!.status === 'AVAILABLE')).toBe(true);
    // Both engines leave together with the starter roster (two drivers, at most min + 1 aboard): no crew block.
    const options = engine.dispatchOptions(career, m3.id);
    expect(options.options.filter((o) => o.dispatchable)).toHaveLength(2);
    expect(options.recommendedVehicleIds).toHaveLength(2);
    const o3 = w.play(3);
    expect(o3).toMatchObject({ netCredits: '180', xp: '15' });
    const returning = career.vehicles.filter((v) => v.status === 'RETURNING');
    expect(returning).toHaveLength(2);
    expect(Math.min(...returning.map((v) => Date.parse(v.busyUntil!) - w.now()))).toBeGreaterThanOrEqual(
      (MISSION_3_MIN_RETURN_SECONDS * 1000) / SPEED - 200,
    );

    // ── mission 4: born 3 s later, while the engines are still on their way home → redirect
    expect(w.until(() => !!w.open(4), (3 * 1000) / SPEED + 300)).toBe(true);
    const m4 = w.open(4)!;
    expect(m4.templateCode).toBe('FIRE_CHIMNEY');
    const homeward = career.vehicles.find((v) => v.status === 'RETURNING')!;
    const redirected = chainOf(engine).chain(career, homeward.id, m4.id, {});
    expect(redirected).toMatchObject({ mode: 'REDIRECTED' });
    const before = w.now();
    expect(w.until(() => career.vehicles.find((v) => v.id === homeward.id)!.status === 'ON_SCENE')).toBe(
      true,
    );
    expect(w.now() - before).toBeLessThanOrEqual((30 * 1000) / SPEED + 250);
    expect(w.until(() => career.pendingOutcomes.some((o) => o.incidentId === m4.id))).toBe(true);
    expect(career.summary.tutorial.completed).toBe(true); // the guided part ends with mission 4
    expect(career.summary.firstShift).toMatchObject({ completed: 4, guided: false });

    // ── mission 5: free, then the shift is over
    expect(w.until(() => !!w.open(5))).toBe(true);
    expect(career.vehicles.every((v) => v.status === 'AVAILABLE')).toBe(true);
    expect(['TECH_ELEVATOR', 'TECH_WATER_LEAK']).toContain(w.open(5)!.templateCode);
    w.play(5);
    expect(career.summary.firstShift).toBeNull();
    expect(career.summary.level).toBeGreaterThanOrEqual(2);
    expect(Number(career.summary.xp)).toBeGreaterThanOrEqual(xpThreshold(2));
    expect(
      w.events
        .filter((e) => e.type === 'incident.created')
        .map((e) => (e.payload as { incident: IncidentDto }).incident.firstShift?.mission),
    ).toEqual([1, 2, 3, 4, 5]);

    // ── the normal generator, gentle for a quarter of an hour: close and light
    expect(career.actions.some((a) => a.type === 'INCIDENT_SPAWN')).toBe(true);
    const spawned: IncidentDto[] = [];
    w.until(
      () => {
        for (const i of career.incidents)
          if (!i.firstShift && !spawned.some((s) => s.id === i.id)) spawned.push(i);
        return spawned.length >= 3;
      },
      (GENTLE_PERIOD.seconds * 1000) / SPEED / 2,
    );
    expect(spawned.length).toBeGreaterThan(0);
    for (const i of spawned) {
      expect(i.severity).toBeLessThanOrEqual(GENTLE_PERIOD.maxSeverity);
      expect(haversineMeters(hq, i.position)).toBeLessThanOrEqual(GENTLE_PERIOD.maxDistanceMeters);
      expect(i.expiresAt).not.toBeNull(); // normal calls again
    }
  });

  it('skipping the tutorial keeps the pace: same calls, no bubbles, the bonus paid at once', async () => {
    const w = await world({ skipTutorial: true });
    const { career } = w;
    expect(career.summary.tutorial.completed).toBe(true);
    expect(career.summary.firstShift).toMatchObject({ mission: 1, guided: false });
    expect(
      career.ledger.some((l) => l.entryType === 'MILESTONE' && l.amount === String(TUTORIAL_BONUS)),
    ).toBe(true);
    w.play(1);
    expect(w.until(() => !!w.open(2))).toBe(true);
    expect(career.actions.some((a) => a.type === 'INCIDENT_SPAWN')).toBe(false);
    w.play(2);
    expect(w.until(() => !!w.open(3))).toBe(true);
    // The bonus is never paid twice (mission 3 would pay it otherwise).
    expect(career.ledger.filter((l) => l.amount === String(TUTORIAL_BONUS))).toHaveLength(1);
  });

  it('measures it for the admin: first call, missions reached, guided or not', async () => {
    const w = await world();
    w.play(1);
    const report = firstShiftReport(Object.values(w.engine.state.careers), w.now(), 14, (ms) =>
      new Date(ms).toISOString(),
    );
    expect(AdminFirstShiftDto.parse(report)).toMatchObject({
      careers: 1,
      medianFirstCallSeconds: 0,
      finished: 0,
      reachedSixthCall: 0,
      skippedTutorial: 0,
    });
    expect(report.completedByMission.map((m) => m.completed)).toEqual([1, 0, 0, 0, 0]);
    expect(report.recent[0]).toMatchObject({ completed: 1, guided: true, laterCalls: 0 });
  });

  it('times the way home on the next call', () => {
    expect(firstShiftReturnSeconds(1, 40)).toBe(6);
    expect(firstShiftReturnSeconds(2, 40)).toBe(8);
    expect(firstShiftReturnSeconds(2, 5)).toBe(5);
    expect(firstShiftReturnSeconds(3, 10)).toBe(45);
    expect(firstShiftReturnSeconds(4, 40)).toBe(13);
    expect(firstShiftReturnSeconds(5, 40)).toBe(40);
  });

  it('compresses preparation and trip proportionally under the cap', () => {
    expect(arrivalFactor(20, 60, 140)).toBeCloseTo(0.1);
    expect(arrivalFactor(30, 10, 15)).toBe(1);
    expect(arrivalFactor(undefined, 60, 140)).toBe(1);
    expect(FIRST_SHIFT_MISSIONS.map((m) => m.arrivalCapSeconds)).toEqual([20, 25, 30, 30, 30]);
    expect(missionRule(3)!.nextCallSeconds).toBe(3);
  });
});
