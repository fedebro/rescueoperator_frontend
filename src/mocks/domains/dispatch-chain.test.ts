import { describe, expect, it } from 'vitest';
import { ChainVehicleResult, DispatchOptionsResult, VehicleDto, type RealtimeEnvelope } from '@/contracts';
import { MockEngine, MockError, memoryStorage } from '../engine';
import { installDomains } from './index';
import { autonomyOf } from './autonomy';
import { logisticsState } from './logistics';
import { chainOf, chainState } from './dispatch-chain';
import { personnelDomain } from './personnel';
import { waterQa } from './water';

/**
 * Mission chaining of the mock (analisi/note-agenti/invio-mezzi-ui.md): the `chain` block of the dispatch options (current
 * mission, stock short, estimate), the redirect from the way home — also back to the incident it was recalled from —, the
 * queue slot that fires by itself and the reasons that turn a redirect into a queue.
 */

async function world(level = 6) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 11;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  // domain QA helpers attach in a microtask (installQa runs after the domains)
  await Promise.resolve();
  engine.qa.createReadyCareer({
    email: 'chain@example.com',
    directorName: 'Dir Chain',
    level,
    credits: 9000,
  });
  const career = engine.qa.career();
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      // keep the player "present": the core stops spawning and the away logic kicks in otherwise
      career.lastSeenAt = now;
      engine.process();
    }
  };
  const until = (done: () => boolean, budgetMs = 1_800_000, step = 250): boolean => {
    for (let t = 0; t < budgetMs && !done(); t += step) advance(step, step);
    return done();
  };
  const addEngines = (count: number): string[] => {
    const ids = engine.qa.addVehicles('FIRE_APS', count);
    engine.qa.staffAll();
    return ids;
  };
  /** A small fire a few streets away: stops the random spawns first, so nothing else interferes. */
  const spawn = (templateCode = 'FIRE_TRASH_BIN', severity = 1): string => {
    engine.cancelActions(career, (a) => a.type === 'INCIDENT_SPAWN');
    return engine.spawnIncident(career, templateCode, false, { severity }).id;
  };
  const vehicle = (id: string) => career.vehicles.find((v) => v.id === id)!;
  const incident = (id: string) => career.incidents.find((i) => i.id === id);
  const options = (incidentId: string) =>
    DispatchOptionsResult.parse(engine.dispatchOptions(career, incidentId)).options;
  const optionOf = (incidentId: string, vehicleId: string) =>
    options(incidentId).find((o) => o.vehicleId === vehicleId)!;
  /** Sends `vehicleId` to `incidentId` and runs until it is on the scene. */
  const sendAndArrive = (vehicleId: string, incidentId: string) => {
    engine.dispatch(career, incidentId, [vehicleId]);
    expect(until(() => vehicle(vehicleId).status === 'ON_SCENE')).toBe(true);
  };
  return {
    engine,
    events,
    career,
    advance,
    until,
    addEngines,
    spawn,
    vehicle,
    incident,
    options,
    optionOf,
    sendAndArrive,
    now: () => now,
    chain: chainOf(engine),
    autonomy: autonomyOf(engine),
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** A vehicle of the fleet on its way home from `incidentId`, recalled while on the scene. */
const recalledFrom = (w: World, vehicleId: string, incidentId: string) => {
  w.sendAndArrive(vehicleId, incidentId);
  w.engine.recall(w.career, vehicleId);
  expect(w.vehicle(vehicleId).status).toBe('RETURNING');
};

describe('chain block of the dispatch options', () => {
  it('describes a unit heading to another call: where it is, when it would be free and arrive', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.engine.dispatch(w.career, first, [a!]);
    expect(w.until(() => w.vehicle(a!).status === 'EN_ROUTE')).toBe(true);

    const chain = w.optionOf(second, a!).chain!;
    expect(chain).toMatchObject({
      vehicleStatus: 'EN_ROUTE',
      redirectEligible: false,
      blockedReason: 'VEHICLE_NOT_RETURNING',
      queueable: true,
      currentIncidentId: first,
      stockLow: [],
      queuedIncidentId: null,
    });
    expect(chain.estimate).toMatchObject({ basis: 'WORK_END', approximate: true, afterExpiry: false });
    const freeAt = Date.parse(chain.estimate!.freeAt!);
    // free = arrive + the work + the way home: later than now; arrive here = free + the preparation and the trip of the option
    expect(freeAt).toBeGreaterThan(w.now());
    expect(Date.parse(chain.estimate!.arriveAt!)).toBe(freeAt + w.optionOf(second, a!).etaSeconds * 1000);
  });

  it('shows a vehicle on the scene (work end + way home) and one at the hospital (hand-off + way home)', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    const onScene = w.optionOf(second, a!).chain!;
    expect(onScene).toMatchObject({ vehicleStatus: 'ON_SCENE', currentIncidentId: first });
    expect(onScene.estimate).toMatchObject({ basis: 'WORK_END', approximate: true });

    w.engine.recall(w.career, a!);
    // the way home is planned: the vehicle is RETURNING, and its estimate is exact (the planned arrival)
    const returning = w.optionOf(second, a!).chain!;
    expect(returning.estimate).toMatchObject({ basis: 'RETURNING', approximate: false });
    expect(returning.estimate!.freeAt).toBe(w.vehicle(a!).busyUntil);
    expect(returning.availableAt).toBe(w.vehicle(a!).busyUntil);
  });

  it('has no block for a unit still assigned to this very call, and one for the unit called back from it', async () => {
    const w = await world();
    const [a, b] = w.addEngines(2);
    const call = w.spawn();
    w.engine.dispatch(w.career, call, [a!, b!]);
    expect(w.until(() => w.vehicle(a!).status === 'ON_SCENE' && w.vehicle(b!).status === 'ON_SCENE')).toBe(
      true,
    );
    w.engine.recall(w.career, b!);

    expect(w.optionOf(call, a!).chain).toBeUndefined();
    const back = w.optionOf(call, b!).chain!;
    expect(back).toMatchObject({
      vehicleStatus: 'RETURNING',
      currentIncidentId: call,
      redirectEligible: true,
      blockedReason: null,
    });
    // still listed as "not available" among the options, but not hidden (the old mock dropped it)
    expect(w.optionOf(call, b!)).toMatchObject({
      dispatchable: false,
      blockedReason: 'VEHICLE_NOT_AVAILABLE',
    });
  });

  it('flags a unit that would arrive after the call expires', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    // the unattended call expires in two real seconds: the unit is busy for far longer
    w.engine.patchIncident(w.career, second, { expiresAt: new Date(w.now() + 2000).toISOString() });
    const estimate = w.optionOf(second, a!).chain!.estimate!;
    expect(estimate.incidentExpiresAt).not.toBeNull();
    expect(estimate.afterExpiry).toBe(true);
  });

  it('keeps a unit resupplying at base queue-only, free at the end of its stop', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const call = w.spawn();
    w.engine.patchVehicle(w.career, a!, {
      status: 'RESTOCKING',
      busyUntil: new Date(w.now() + 60_000).toISOString(),
    });
    const chain = w.optionOf(call, a!).chain!;
    expect(chain).toMatchObject({
      vehicleStatus: 'RESTOCKING',
      redirectEligible: false,
      blockedReason: 'VEHICLE_RESTOCKING',
      currentIncidentId: null,
    });
    expect(chain.estimate).toMatchObject({ basis: 'RESTOCKING', approximate: false });
    expect(chain.estimate!.freeAt).toBe(w.vehicle(a!).busyUntil);
  });
});

describe('redirect from the way home', () => {
  it('sends a unit that finished a call straight to another one — its crew rides on, the old leg is closed', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    w.engine.recall(w.career, a!);
    const crewBefore = [...personnelDomain(w.engine).state(w.career).crews[a!]!];

    const result = ChainVehicleResult.parse(w.chain.chain(w.career, a!, second));
    expect(result.mode).toBe('REDIRECTED');
    expect(result.vehicle.status).toBe('EN_ROUTE');
    expect(result.vehicle.incidentId).toBe(second);
    expect(result.incident?.id).toBe(second);
    expect(result.incident?.assignedVehicleIds).toContain(a);
    // no PREPARING, no trip to base: it leaves from where it was, on a new leg
    expect(w.vehicle(a!).movement?.purpose).toBe('TO_INCIDENT');
    expect(chainState(w.career).returnFrom[a!]).toBeUndefined();
    // the crew stays aboard: still on mission, now for the new call
    const ops = personnelDomain(w.engine).state(w.career);
    expect(ops.crews[a!]).toEqual(crewBefore);
    expect(ops.people.filter((p) => crewBefore.includes(p.id)).every((p) => p.status === 'ON_MISSION')).toBe(
      true,
    );
    expect(ops.missions[a!]).toBe(w.incident(second)!.severity);
    // …and it gets there and works
    expect(w.until(() => w.vehicle(a!).status === 'ON_SCENE')).toBe(true);
    expect(w.vehicle(a!).incidentId).toBe(second);
    // a redirect is recorded as such (it has no free undo)
    expect(w.career.dispatches!.at(-1)).toMatchObject({ origin: 'REDIRECT', cancellableUntil: null });
  });

  it('sends a recalled unit back to the very same call (a mistake is not for the player to wait out)', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const call = w.spawn();
    recalledFrom(w, a!, call);
    expect(w.chain.returningFrom(w.career, a!)).toBe(call);
    expect(w.incident(call)!.assignedVehicleIds).not.toContain(a);

    const result = w.chain.chain(w.career, a!, call);
    expect(result.mode).toBe('REDIRECTED');
    expect(w.vehicle(a!)).toMatchObject({ status: 'EN_ROUTE', incidentId: call });
    expect(w.incident(call)!.assignedVehicleIds).toContain(a);
    expect(w.until(() => w.vehicle(a!).status === 'ON_SCENE')).toBe(true);
  });

  it('is never a redirect for a unit still heading to, working at or carrying away from that call', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const call = w.spawn();
    w.engine.dispatch(w.career, call, [a!]);
    expect(() => w.chain.chain(w.career, a!, call)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR', status: 400 }),
    );
  });

  it('refuses a free vehicle (dispatch it) and a call that cannot receive vehicles', async () => {
    const w = await world();
    const [a, b] = w.addEngines(2);
    const first = w.spawn();
    const second = w.spawn();
    expect(() => w.chain.chain(w.career, a!, first)).toThrowError(
      expect.objectContaining({ code: 'VEHICLE_NOT_CHAINABLE', status: 409 }),
    );
    w.sendAndArrive(b!, first);
    // a call in its medical tail with nobody left to look after is over for new vehicles
    w.engine.patchIncident(w.career, second, { status: 'RESOLVING' });
    expect(() => w.chain.chain(w.career, b!, second)).toThrowError(
      expect.objectContaining({ code: 'INCIDENT_NOT_DISPATCHABLE', status: 409 }),
    );
    // gone for good: not found, like the plain dispatch
    w.engine.close(w.career, w.incident(second)!, 'CANCELLED', w.now());
    expect(() => w.chain.chain(w.career, b!, second)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND', status: 404 }),
    );
    expect(() => w.chain.chain(w.career, 'veh_nope', first)).toThrowError(MockError);
  });

  it('does not block on short stock: it goes with what it has, and says what is short', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    w.engine.recall(w.career, a!);
    // the foam is nearly gone — a stop at base would reload it, but a redirect does not wait for it
    const item = w.autonomy.profileOf(w.career, w.vehicle(a!)).items[0]!;
    w.autonomy.setAutonomy(w.career, a!, { stock: { [item.code]: 0 } });

    const chain = w.optionOf(second, a!).chain!;
    expect(chain.stockLow).toContain(item.code);
    expect(chain).toMatchObject({ redirectEligible: true, blockedReason: null });
    expect(w.chain.chain(w.career, a!, second).mode).toBe('REDIRECTED');
  });

  it('queues instead when the crew is too tired, and says why', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    w.engine.recall(w.career, a!);
    (w.engine.qa as unknown as { tireAll: (value: number) => void }).tireAll(100);

    const chain = w.optionOf(second, a!).chain!;
    expect(chain).toMatchObject({ redirectEligible: false, blockedReason: 'CREW_EXHAUSTED' });
    // nobody of the crew can go on: not even the minimum is left
    expect(chain.crew!.available).toBeLessThan(chain.crew!.min);
    const result = w.chain.chain(w.career, a!, second);
    expect(result.mode).toBe('QUEUED');
    expect(w.vehicle(a!).status).toBe('RETURNING');
  });

  it('queues instead for a vehicle out of service and an overdue service', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    w.engine.recall(w.career, a!);
    expect(w.optionOf(second, a!).chain).toMatchObject({ redirectEligible: true });

    // a service long overdue: back to base first
    const care =
      logisticsState(w.career).care[a!] ??
      (logisticsState(w.career).care[a!] = {
        wear: 0,
        km: 0,
        missions: 0,
        kmAtService: 0,
        missionsAtService: 0,
        history: [],
      });
    care.km = 1_000_000;
    expect(w.optionOf(second, a!).chain).toMatchObject({
      redirectEligible: false,
      blockedReason: 'MAINTENANCE_DUE',
    });
    care.km = 0;

    w.engine.patchVehicle(w.career, a!, { health: 0 });
    expect(w.optionOf(second, a!).chain).toMatchObject({
      redirectEligible: false,
      blockedReason: 'VEHICLE_INOPERABLE',
    });
    w.engine.patchVehicle(w.career, a!, { health: 80 });
    expect(w.optionOf(second, a!).chain!.redirectEligible).toBe(true);
  });

  it('refuels at a filling station first when the tank cannot cover there and back', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    w.sendAndArrive(a!, first);
    w.engine.recall(w.career, a!);
    // a call far away, a nearly empty tank: not enough there and back, a pump on the way solves it
    const far = (
      w.engine.qa as unknown as { spawnAway: (t: string, s: number, km: number) => string }
    ).spawnAway('FIRE_TRASH_BIN', 1, 12);
    w.autonomy.setAutonomy(w.career, a!, { fuel: 0.12 });
    const chain = w.optionOf(far, a!).chain!;
    expect(chain).toMatchObject({ redirectEligible: true, blockedReason: null });
    expect(chain.fuelStop!.extraSeconds).toBeGreaterThan(0);
    expect(Number(chain.fuelStop!.premium)).toBeGreaterThan(0);
    const credits = Number(w.career.summary.credits);
    expect(w.chain.chain(w.career, a!, far).mode).toBe('REDIRECTED');
    // full tank (the stop is paid with the premium) and the stop is in the new leg
    expect(w.autonomy.stateOf(w.career, a!).fuelRatio).toBeGreaterThan(0.9);
    expect(Number(w.career.summary.credits)).toBeLessThan(credits);
  });
});

describe('the queue', () => {
  it('queueOnly never redirects: the unit goes home, resupplies and leaves by itself', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    recalledFrom(w, a!, first);

    const result = ChainVehicleResult.parse(w.chain.chain(w.career, a!, second, { queueOnly: true }));
    expect(result.mode).toBe('QUEUED');
    expect(result.queue?.incidentId).toBe(second);
    expect(w.vehicle(a!).status).toBe('RETURNING');
    expect(w.optionOf(second, a!).chain!.queuedIncidentId).toBe(second);

    // back at base, the slot fires through the normal dispatch (no free undo: origin QUEUE)
    expect(
      w.until(
        () =>
          ['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(w.vehicle(a!).status) && !!w.vehicle(a!).incidentId,
      ),
    ).toBe(true);
    expect(w.vehicle(a!).incidentId).toBe(second);
    expect(w.career.dispatches!.at(-1)).toMatchObject({ origin: 'QUEUE', cancellableUntil: null });
    expect(chainState(w.career).queue[a!]).toBeUndefined();
  });

  it('keeps ONE slot per vehicle: a new one replaces it, and a cancel is idempotent', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    const third = w.spawn();
    w.sendAndArrive(a!, first);

    expect(w.chain.chain(w.career, a!, second).mode).toBe('QUEUED');
    expect(w.optionOf(third, a!).chain!.queuedIncidentId).toBe(second);
    expect(w.chain.chain(w.career, a!, third).mode).toBe('QUEUED');
    expect(Object.keys(chainState(w.career).queue)).toEqual([a]);
    expect(chainState(w.career).queue[a!]!.incidentId).toBe(third);

    expect(w.chain.cancelQueue(w.career, a!).id).toBe(a);
    expect(chainState(w.career).queue[a!]).toBeUndefined();
    expect(w.chain.cancelQueue(w.career, a!).id).toBe(a);
    // a queue cancelled never fires
    w.engine.recall(w.career, a!);
    w.until(() => w.vehicle(a!).status === 'AVAILABLE');
    expect(w.vehicle(a!).incidentId).toBeNull();
  });

  it('clears a slot whose call is gone, with a notification, instead of leaving the unit idle', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    w.chain.chain(w.career, a!, second);
    // the queued call goes away before the unit is free
    w.engine.close(w.career, w.incident(second)!, 'CANCELLED', w.now());
    w.engine.recall(w.career, a!);
    expect(w.until(() => w.vehicle(a!).status === 'AVAILABLE')).toBe(true);

    expect(chainState(w.career).queue[a!]).toBeUndefined();
    expect(w.vehicle(a!).incidentId).toBeNull();
    expect(w.career.notifications.some((n) => n.title.key === 'notification.QUEUE_CLEARED.title')).toBe(true);
    expect(
      w.events.some(
        (e) => e.type === 'vehicle.updated' && (e.payload as { queueCleared?: boolean }).queueCleared,
      ),
    ).toBe(true);
  });

  it('a queued unit that is still busy keeps its slot (a stale trigger never consumes it)', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    w.sendAndArrive(a!, first);
    w.chain.chain(w.career, a!, second);
    w.advance(2000);
    expect(chainState(w.career).queue[a!]?.incidentId).toBe(second);
  });
});

describe('what the call itself refuses, and where a returning vehicle comes from', () => {
  it('a boat on its way home from a call: queued for a water call, no `chain` at all for a call on land', async () => {
    const w = await world(9);
    const [boat] = w.engine.qa.addVehicles('FIRE_BOAT', 1);
    w.engine.qa.staffAll();
    const land = w.spawn();
    const water = waterQa(w.engine).spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    // on its way home from somewhere: on the water or on its trailer, it is queued and sent from its base
    w.engine.patchVehicle(w.career, boat!, { status: 'RETURNING' });
    expect(w.optionOf(water, boat!).chain).toMatchObject({
      redirectEligible: false,
      blockedReason: 'BOAT_NEEDS_BASE',
    });
    // a boat is never sent to a street fire: the call refuses it, so there is nothing to queue (the server sends no chain)
    const refused = w.optionOf(land, boat!);
    expect(refused.blockedReason).toBe('VEHICLE_DOMAIN_MISMATCH');
    expect(refused.chain).toBeUndefined();
  });

  it('the vehicle says where it comes from while it returns (`returningFromIncidentId`), nowhere else', async () => {
    const w = await world();
    const [a] = w.addEngines(1);
    const first = w.spawn();
    const second = w.spawn();
    expect(VehicleDto.parse(w.vehicle(a!)).returningFromIncidentId).toBeNull();
    w.sendAndArrive(a!, first);
    expect(w.vehicle(a!).returningFromIncidentId).toBeNull();
    w.engine.recall(w.career, a!);
    expect(VehicleDto.parse(w.vehicle(a!))).toMatchObject({
      status: 'RETURNING',
      incidentId: null,
      returningFromIncidentId: first,
    });
    // it is on the snapshot the client reads, and on the events too
    expect(w.engine.snapshot(w.career).vehicles.find((v) => v.id === a)!.returningFromIncidentId).toBe(first);
    expect(
      w.events.some(
        (e) =>
          e.type === 'vehicle.returning' &&
          (e.payload.vehicle as { returningFromIncidentId?: string }).returningFromIncidentId === first,
      ),
    ).toBe(true);
    // sent again: it is bound to an incident, the field is gone
    w.chain.chain(w.career, a!, second);
    expect(w.vehicle(a!)).toMatchObject({
      status: 'EN_ROUTE',
      incidentId: second,
      returningFromIncidentId: null,
    });
    w.engine.recall(w.career, a!);
    expect(w.vehicle(a!).returningFromIncidentId).toBe(second);
    // home again: free, nowhere "from"
    expect(w.until(() => w.vehicle(a!).status === 'AVAILABLE')).toBe(true);
    expect(w.vehicle(a!).returningFromIncidentId).toBeNull();
  });
});
