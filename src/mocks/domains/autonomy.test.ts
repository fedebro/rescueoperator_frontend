import { describe, expect, it } from 'vitest';
import {
  DispatchOptionsResult,
  LedgerEntryDto,
  ResupplyVehicleResult,
  VehicleDto,
  type RealtimeEnvelope,
} from '@/contracts';
import { AUTONOMY as K, ITEM_TYPES, VEHICLE_TYPES, xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { installQa } from '../qa';
import { installLogistics, logisticsState } from './logistics';
import { autonomyOf, installAutonomy } from './autonomy';
import {
  autonomySnapshot,
  averageMissionFuelKm,
  fuelProfileOf,
  fuelStationPremium,
  fuelThresholdKm,
  itemConditionMultiplier,
  itemThreshold,
  missionsLeftEstimate,
  partialUnits,
  profileOf,
  resupplyDecision,
  resupplySeconds,
} from './autonomy-math';

const APS = VEHICLE_TYPES.find((t) => t.code === 'FIRE_APS')!;
const ALL_ON = { stock: true, fuel: true };

function world(opts: { level?: number; credits?: number; random?: () => number } = {}) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 42;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: opts.random ?? (() => (seed = (seed * 16807) % 2147483647) / 2147483647),
  });
  installLogistics(engine);
  installAutonomy(engine);
  installQa(engine);
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      engine.process();
    }
  };
  /** Advances until `done()` (or the budget runs out). */
  const until = (done: () => boolean, budgetMs = 900_000, step = 250) => {
    for (let t = 0; t < budgetMs && !done(); t += step) {
      now += step;
      engine.process();
    }
    return done();
  };
  const ch = engine.requestOtp('fuel@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Fuel',
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
  if (opts.credits !== undefined)
    engine.credit(career, opts.credits - Number(career.summary.credits), 'ADMIN_ADJUSTMENT');
  const autonomy = autonomyOf(engine);
  const vehicle = () => career.vehicles[0]!;
  const base = () => career.facilities[0]!.position;
  /** A spawn `km` east of the station (the mock route is at least the straight line). */
  const farAway = (km: number): [number, number] => [base()[0] + km / 82, base()[1]];
  return { engine, events, advance, until, career, autonomy, vehicle, base, farAway, now: () => now };
}

describe('autonomy maths (a port of the backend rule)', () => {
  const profile3 = profileOf(APS, ITEM_TYPES, 3, K, ALL_ON);

  it('reads the catalog: what a pumper carries, its tank and the thresholds', () => {
    expect(profile3.items.map((i) => [i.code, i.capacity])).toEqual([
      ['ABSORBENT', 16],
      ['EXTRICATION_KIT', 3],
      ['FOAM', 45],
    ]);
    expect(profile3.fuel).toEqual({ unit: 'KM', rangeKm: 120, perMinuteOnScene: 1 });
    const foam = profile3.items.find((i) => i.code === 'FOAM')!;
    // max(35 % of 45 = 15.75, one mission's need 15)
    expect(itemThreshold(foam, K)).toBeCloseTo(15.75);
    // one average mission = 14 km × (1 + 1.1) / 2 + 3 min × 1 km/min = 17.7 km < 25 % of 120 = 30
    expect(averageMissionFuelKm(profile3.fuel!, K)).toBeCloseTo(17.7);
    expect(fuelThresholdKm(profile3.fuel!, K)).toBe(30);
    // Aircraft carry minutes of flight (phase 3, air-endurance.md: helicopter 30, plane 36); foot teams nothing.
    expect(fuelProfileOf(VEHICLE_TYPES.find((t) => t.code === 'FIRE_HELI'))).toEqual({
      unit: 'MIN',
      rangeKm: 30,
      perMinuteOnScene: 0.6,
    });
    expect(fuelProfileOf(VEHICLE_TYPES.find((t) => t.code === 'AIB_PLANE'))?.rangeKm).toBe(36);
    expect(fuelProfileOf(VEHICLE_TYPES.find((t) => t.code === 'ALP_TEAM'))).toBeNull();
    // A foam tender carries far more foam than a pumper (catalog override).
    const foamTender = profileOf(
      VEHICLE_TYPES.find((t) => t.code === 'FIRE_FOAM'),
      ITEM_TYPES,
      3,
      K,
      ALL_ON,
    );
    expect(foamTender.items.find((i) => i.code === 'FOAM')!.capacity).toBe(200);
  });

  it('unlocks gradually: nothing at level 1, stock from level 2, fuel from level 3 (and behind the feature flags)', () => {
    const at = (level: number, gates = ALL_ON) => profileOf(APS, ITEM_TYPES, level, K, gates);
    expect(at(1)).toMatchObject({ stockUnlocked: false, fuelUnlocked: false, items: [], fuel: null });
    expect(at(2)).toMatchObject({ stockUnlocked: true, fuelUnlocked: false, fuel: null });
    expect(at(2).items.length).toBeGreaterThan(0);
    expect(at(3)).toMatchObject({ stockUnlocked: true, fuelUnlocked: true });
    expect(at(3, { stock: true, fuel: false }).fuel).toBeNull();
    expect(at(3, { stock: false, fuel: true }).items).toEqual([]);
  });

  it('THE single rule: an item stops the vehicle only if the shelf can refill it; fuel always can', () => {
    const shelf = { FOAM: 100, ABSORBENT: 30, EXTRICATION_KIT: 5 };
    const full = { stock: {}, fuelRatio: 1 };
    expect(resupplyDecision(profile3, full, shelf, K)).toBeNull();
    const lowFoam = { stock: { FOAM: 10 }, fuelRatio: 1 };
    expect(resupplyDecision(profile3, lowFoam, shelf, K)).toMatchObject({
      loads: [{ itemCode: 'FOAM', units: 35 }],
      reasons: ['ITEM:FOAM'],
    });
    // Empty shelf: no useless stop (the bug the old `wouldNeedRestock` had).
    expect(resupplyDecision(profile3, lowFoam, { FOAM: 0 }, K)).toBeNull();
    const lowFuel = { stock: {}, fuelRatio: 0.2 };
    const plan = resupplyDecision(profile3, lowFuel, {}, K)!;
    expect(plan.reasons).toEqual(['FUEL']);
    expect(plan.fuelKm).toBe(96);
    // 20 s + 96 km × 0.2 s
    expect(plan.seconds).toBe(Math.round(20 + 96 * 0.2));
    // A forced (manual) request tops up whatever is missing, even above the thresholds.
    expect(
      resupplyDecision(profile3, { stock: { FOAM: 40 }, fuelRatio: 0.9 }, shelf, K, { forced: true }),
    ).toMatchObject({
      reasons: ['MANUAL'],
      loads: [{ itemCode: 'FOAM', units: 5 }],
    });
    // Longest stop capped at 150 s, 10 % faster per STORAGE level (max 50 %).
    expect(resupplySeconds(profile3, [{ itemCode: 'FOAM', units: 1000 }], 0, K, 0)).toBe(150);
    expect(resupplySeconds(profile3, [{ itemCode: 'FOAM', units: 1000 }], 0, K, 2)).toBe(120);
    expect(resupplySeconds(profile3, [{ itemCode: 'FOAM', units: 1000 }], 0, K, 9)).toBe(75);
  });

  it('estimates the missions left (min over fuel and items) and serves the backend DTO', () => {
    const shelf = { FOAM: 100, ABSORBENT: 30, EXTRICATION_KIT: 5 };
    // FOAM: ⌊(45 − 15.75) / 4.5⌋ + 1 = 7 · fuel: ⌊(120 − 30) / 17.7⌋ + 1 = 6
    expect(missionsLeftEstimate(profile3, { stock: {}, fuelRatio: 1 }, K)).toBe(6);
    expect(missionsLeftEstimate(profile3, { stock: { FOAM: 14 }, fuelRatio: 1 }, K)).toBe(0);
    expect(
      missionsLeftEstimate(profileOf(APS, ITEM_TYPES, 1, K, ALL_ON), { stock: {}, fuelRatio: 1 }, K),
    ).toBeNull();
    const dto = autonomySnapshot(profile3, { stock: { FOAM: 43 }, fuelRatio: 0.1 }, shelf, K, false);
    expect(VehicleDto.shape.autonomy.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({
      unlocked: { stock: true, fuel: true },
      fuel: { km: 12, rangeKm: 120, ratio: 0.1, reserve: true, low: true },
      missionsLeftEstimate: 0,
      needsResupply: true,
      resupplyRequested: false,
    });
    expect(dto.items.find((i) => i.itemCode === 'FOAM')).toEqual({
      itemCode: 'FOAM',
      quantity: 43,
      capacity: 45,
      low: false,
    });
  });

  it('scales consumption with the conditions, capped; partial units never vanish; fuel-station premium', () => {
    expect(itemConditionMultiplier({ night: true, weather: 'STORM', meanCoverage: null }, K)).toBeCloseTo(
      1.5,
    );
    expect(itemConditionMultiplier({ night: false, weather: null, meanCoverage: 0.25 }, K)).toBeCloseTo(1.3);
    expect(itemConditionMultiplier({ night: true, weather: 'STORM', meanCoverage: 0.25 }, K)).toBe(1.8);
    expect(partialUnits(3, 0.5, 4)).toBe(1);
    expect(partialUnits(20, 0.5, 1)).toBe(10);
    expect(partialUnits(0, 0.5, 1)).toBe(0);
    expect(fuelStationPremium(50, 1.2, K)).toBe(6);
  });
});

describe('autonomy in the mock world', () => {
  it('serves `VehicleDto.autonomy` on the snapshot, gated by level, and tells the fleet at the level-up', () => {
    const w = world();
    const snap = w.engine.snapshot(w.career).vehicles[0]!;
    expect(VehicleDto.parse(snap).autonomy).toMatchObject({
      unlocked: { stock: false, fuel: false },
      fuel: null,
      items: [],
      missionsLeftEstimate: null,
      needsResupply: false,
    });
    w.engine.awardXp(w.career, xpThreshold(3) - Number(w.career.summary.xp));
    const update = [...w.events]
      .reverse()
      .find((e) => e.type === 'vehicle.updated' && 'vehicles' in e.payload)!;
    const [v] = (update.payload as { vehicles: VehicleDto[] }).vehicles;
    expect(v!.autonomy).toMatchObject({ unlocked: { stock: true, fuel: true }, fuel: { km: 120, ratio: 1 } });
    expect(v!.autonomy!.missionsLeftEstimate).toBe(6);
  });

  it('burns fuel per km (sirens out, plain back) and per minute of pump on scene, then comes home ready', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    expect(w.until(() => w.vehicle().status === 'RETURNING')).toBe(true);
    const out = w.career.legs.at(-1)!.distanceMeters;
    const back = w.vehicle().movement!.distanceMeters;
    expect(w.until(() => w.vehicle().status === 'AVAILABLE')).toBe(true);
    const burnt = 120 - w.vehicle().autonomy!.fuel!.km;
    expect(burnt).toBeGreaterThan((out * 1.1 + back) / 1000 - 0.1);
    // + the pump on scene: 1 km per game minute (a trash-bin fire is short).
    expect(burnt).toBeLessThan((out * 1.1 + back) / 1000 + 5);
    // Above every threshold: no stop, AVAILABLE — and chainable — at once.
    const returned = w.events.filter((e) => e.type === 'vehicle.returned').at(-1)!;
    expect((returned.payload.vehicle as VehicleDto).status).toBe('AVAILABLE');
    expect((returned.payload.vehicle as VehicleDto).autonomy!.unlocked.fuel).toBe(true);
  });

  it('under 25 % of the tank it stops at base (RESTOCKING, duration ∝ what is reloaded), then is full again', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    expect(w.until(() => w.vehicle().status === 'EN_ROUTE')).toBe(true);
    w.autonomy.setAutonomy(w.career, w.vehicle().id, { fuel: 0.2 });
    expect(w.until(() => w.vehicle().status === 'RESTOCKING')).toBe(true);
    const stop = w.vehicle();
    expect(stop.autonomy!.fuel).toMatchObject({ ratio: 1, reserve: false, low: false });
    const seconds = (Date.parse(stop.busyUntil!) - w.now()) / 1000;
    // 20 s + ~100 km × 0.2 s, never above the 150 s cap
    expect(seconds).toBeGreaterThan(35);
    expect(seconds).toBeLessThanOrEqual(150);
    const returned = w.events.filter((e) => e.type === 'vehicle.returned').at(-1)!;
    expect((returned.payload.vehicle as VehicleDto).status).toBe('RESTOCKING');
    expect(w.until(() => w.vehicle().status === 'AVAILABLE', 200_000)).toBe(true);
    expect(w.vehicle().busyUntil).toBeNull();
    expect(w.events.at(-1)!.type).toBe('vehicle.updated');
  });

  it('flags the reserve and reloads before leaving: the seconds are in the ETA and in the departure', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    const full = w.engine.dispatchOptions(w.career, incident.id).options[0]!;
    expect(full.autonomy).toMatchObject({ enoughFuel: true, resupplyBeforeDepartureSeconds: 0 });
    expect(full.warnings).not.toContain('RESUPPLY_BEFORE_DEPARTURE');
    w.autonomy.setAutonomy(w.career, w.vehicle().id, { fuel: 0.1 });
    expect(w.vehicle().autonomy!.fuel).toMatchObject({ reserve: true, low: true });
    expect(w.vehicle().autonomy!.needsResupply).toBe(true);
    const result = DispatchOptionsResult.parse(w.engine.dispatchOptions(w.career, incident.id));
    const option = result.options[0]!;
    expect(option.warnings).toContain('RESUPPLY_BEFORE_DEPARTURE');
    expect(option.autonomy!.resupplyBeforeDepartureSeconds).toBeGreaterThan(0);
    expect(option.etaSeconds).toBe(full.etaSeconds + option.autonomy!.resupplyBeforeDepartureSeconds);
    // Reloading before leaving is not a reason to skip the vehicle: it is still recommended.
    expect(result.recommendedVehicleIds).toContain(w.vehicle().id);
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    expect(w.vehicle().autonomy!.fuel!.ratio).toBe(1);
    const prep = APS.preparationSeconds;
    const depart = w.career.actions.find((a) => a.type === 'VEHICLE_DEPART' && a.ref === w.vehicle().id)!;
    expect(depart.dueAt - w.now()).toBe((prep + option.autonomy!.resupplyBeforeDepartureSeconds) * 1000);
    expect(w.career.timelines[incident.id]!.map((e) => e.type)).toContain('vehicle.resupplied');
  });

  it('never recommends a vehicle that cannot make it there and back, but keeps it selectable', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, {
      severity: 1,
      position: w.farAway(70),
    });
    const result = DispatchOptionsResult.parse(w.engine.dispatchOptions(w.career, incident.id));
    const option = result.options[0]!;
    expect(option.dispatchable).toBe(true);
    expect(option.warnings).toContain('FUEL_RANGE_INSUFFICIENT');
    expect(option.autonomy).toMatchObject({ enoughFuel: false, fuelKm: 120 });
    expect(option.autonomy!.fuelNeededKm!).toBeGreaterThan(120);
    expect(result.recommendedVehicleIds).toEqual([]);
    expect(() => w.engine.dispatch(w.career, incident.id, [w.vehicle().id])).not.toThrow();
  });

  it('marks the last mission before a resupply', () => {
    const w = world({ level: 3 });
    w.autonomy.setAutonomy(w.career, w.vehicle().id, { stock: { FOAM: 20 } });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_VEHICLE', false, { severity: 3 });
    const option = w.engine.dispatchOptions(w.career, incident.id).options[0]!;
    expect(option.warnings).toContain('LAST_MISSION_BEFORE_RESUPPLY');
    expect(option.autonomy!.lastMissionBeforeResupply).toBe(true);
    expect(option.warnings).not.toContain('RESUPPLY_BEFORE_DEPARTURE');
  });

  it('after a far mission in reserve it refuels at a filling station on the way (premium, ledger FUEL) instead of stopping', () => {
    const w = world({ level: 3, credits: 500 });
    w.autonomy.setAutonomy(w.career, w.vehicle().id, { fuel: 0.45 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, {
      severity: 1,
      position: w.farAway(13),
    });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    expect(w.until(() => w.vehicle().status === 'RETURNING')).toBe(true);
    const fuel = w.career.ledger.find((l) => l.entryType === 'FUEL')!;
    expect(LedgerEntryDto.parse(fuel).description).toMatchObject({ key: 'ledger.FUEL' });
    expect(Number(fuel.amount)).toBeLessThan(0);
    expect(fuel.description.params).toMatchObject({ callSign: w.vehicle().callSign });
    expect(w.career.timelines[incident.id]!.map((e) => e.type)).toContain('vehicle.refuel_stop');
    expect(w.until(() => w.vehicle().status !== 'RETURNING')).toBe(true);
    // Refuelled on the way: home with plenty of fuel, no stop at base.
    expect(w.vehicle().status).toBe('AVAILABLE');
    expect(w.vehicle().autonomy!.fuel!.low).toBe(false);
  });

  it('manual "return to resupply": at base, on the way home, already resupplying, busy', () => {
    const w = world({ level: 3 });
    const id = w.vehicle().id;
    const parse = (r: unknown) => ResupplyVehicleResult.parse(r);
    expect(parse(w.autonomy.requestResupply(w.career, id)).mode).toBe('ALREADY_FULL');
    w.autonomy.setAutonomy(w.career, id, { fuel: 0.8, stock: { FOAM: 30 } });
    const started = parse(w.autonomy.requestResupply(w.career, id));
    expect(started).toMatchObject({ mode: 'RESTOCKING', vehicle: { status: 'RESTOCKING' } });
    expect(started.until).toBe(w.vehicle().busyUntil);
    expect(w.events.at(-1)).toMatchObject({ type: 'vehicle.updated', payload: { resupply: 'RESTOCKING' } });
    expect(parse(w.autonomy.requestResupply(w.career, id)).mode).toBe('ALREADY_RESUPPLYING');
    expect(w.until(() => w.vehicle().status === 'AVAILABLE', 200_000)).toBe(true);
    expect(w.vehicle().autonomy!.items.find((i) => i.itemCode === 'FOAM')!.quantity).toBe(45);

    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    w.engine.dispatch(w.career, incident.id, [id]);
    expect(w.until(() => w.vehicle().status === 'ON_SCENE')).toBe(true);
    expect(() => w.autonomy.requestResupply(w.career, id)).toThrowError(MockError);
    expect(w.until(() => w.vehicle().status === 'RETURNING')).toBe(true);
    const scheduled = parse(w.autonomy.requestResupply(w.career, id));
    expect(scheduled).toMatchObject({ mode: 'SCHEDULED_ON_RETURN', until: null });
    expect(scheduled.vehicle.autonomy!.resupplyRequested).toBe(true);
    // Once home the pending request forces a top-up, whatever the thresholds say.
    expect(w.until(() => w.vehicle().status !== 'RETURNING')).toBe(true);
    expect(w.vehicle().status).toBe('RESTOCKING');
    expect(w.vehicle().autonomy!.resupplyRequested).toBe(false);
  });

  it('a failed mission still used part of the material; a cancelled one nothing', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_VEHICLE', false, { severity: 3 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    expect(w.until(() => w.vehicle().status === 'ON_SCENE')).toBe(true);
    w.engine.close(w.career, w.career.incidents[0]!, 'FAILED', w.now());
    const foam = w.vehicle().autonomy!.items.find((i) => i.itemCode === 'FOAM')!.quantity;
    // half of base 5 + 5 × 3 = 20 (× the conditions), never all of it
    expect(45 - foam).toBeGreaterThanOrEqual(10);
    expect(45 - foam).toBeLessThan(20 * 1.8);
    expect(logisticsState(w.career).stock[w.vehicle().facilityId]!.FOAM!.quantity).toBe(100);
  });

  it('exposes QA helpers to set and read a vehicle autonomy', () => {
    const w = world({ level: 3 });
    const qa = w.engine.qa as unknown as {
      setAutonomy: (id: string | null, patch: Record<string, unknown>) => string;
      autonomy: (id?: string | null) => VehicleDto['autonomy'];
    };
    w.engine.state.currentSession = { email: 'fuel@example.com', sessionId: 's' };
    expect(qa.setAutonomy(null, { fuel: 0.12, stock: { FOAM: 3 } })).toBe(w.vehicle().id);
    expect(qa.autonomy()).toMatchObject({
      fuel: { reserve: true },
      needsResupply: true,
      missionsLeftEstimate: 0,
    });
    expect(qa.autonomy()!.items.find((i) => i.itemCode === 'FOAM')).toMatchObject({ quantity: 3, low: true });
  });
});

describe('flight endurance (aircraft, air-endurance.md)', () => {
  const heliOf = (w: ReturnType<typeof world>) =>
    w.engine.addVehicle(w.career, 'FIRE_HELI', w.career.facilities[0]!.id, true);
  const find = (w: ReturnType<typeof world>, id: string) => w.career.vehicles.find((v) => v.id === id)!;
  /** A call whose work outlasts the aircraft's endurance (the tests are about the flight, not the job). */
  const longJob = (w: ReturnType<typeof world>) => {
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, {
      severity: 1,
      position: w.farAway(6),
    });
    w.engine.patchIncident(w.career, incident.id, {
      work: { ...incident.work, total: 1_000_000, remaining: 1_000_000 },
    });
    return incident;
  };

  it('an aircraft option counts minutes: what the trip needs, how long it can stay; beyond its endurance, blocked', () => {
    const w = world({ level: 3 });
    const heli = heliOf(w);
    const near = w.engine.spawnIncident(w.career, 'TECH_FALLEN_TREE', false, {
      severity: 2,
      position: w.farAway(6),
    });
    const result = DispatchOptionsResult.parse(w.engine.dispatchOptions(w.career, near.id));
    const option = result.options.find((o) => o.vehicleId === heli.id)!;
    expect(option.dispatchable).toBe(true);
    expect(option.autonomy).toMatchObject({ fuelUnit: 'MIN', fuelKm: 30, enoughFuel: true });
    // There and back take a few minutes of its 30, the reserve is never flown into; over the scene it burns 0.6 of a
    // flight minute per minute (FIRE_HELI `fuelPerMinuteOnScene`).
    const perMinute = VEHICLE_TYPES.find((t) => t.code === 'FIRE_HELI')!.autonomy.fuelPerMinuteOnScene;
    expect(option.autonomy!.onSceneMinutes!).toBeGreaterThan(10);
    expect(option.autonomy!.onSceneMinutes!).toBeLessThan((30 * (1 - K.fuelReserveRatio)) / perMinute);

    // The flight legs are compressed like every trip (×0.25): only a call far beyond the map is out of reach.
    const far = w.engine.spawnIncident(w.career, 'TECH_FALLEN_TREE', false, {
      severity: 2,
      position: w.farAway(250),
    });
    const blocked = DispatchOptionsResult.parse(w.engine.dispatchOptions(w.career, far.id));
    const tooFar = blocked.options.find((o) => o.vehicleId === heli.id)!;
    expect(tooFar).toMatchObject({ dispatchable: false, blockedReason: 'ENDURANCE_INSUFFICIENT' });
    expect(tooFar.autonomy!.fuelNeededKm!).toBeGreaterThan(30);
    expect(blocked.recommendedVehicleIds).not.toContain(heli.id);
  });

  it('over the scene it turns back at bingo, refuels at base, then flies back to the call on its own', () => {
    const w = world({ level: 3 });
    const heli = heliOf(w);
    const incident = longJob(w);
    w.engine.dispatch(w.career, incident.id, [heli.id]);
    expect(w.until(() => find(w, heli.id).status === 'ON_SCENE')).toBe(true);
    // A few minutes left: the way home + the reserve is all it has.
    w.autonomy.setAutonomy(w.career, heli.id, { fuel: 0.16 });
    expect(w.until(() => find(w, heli.id).status === 'RETURNING', 60_000)).toBe(true);
    const bingo = w.events.find((e) => e.type === 'vehicle.updated' && e.payload.bingo === true);
    expect(bingo?.payload).toMatchObject({ queued: true, queuedIncidentId: incident.id });
    expect(w.career.timelines[incident.id]!.map((e) => e.type)).toContain('vehicle.bingo_fuel');
    // Home, refuelled, and back to the call through the normal dispatch.
    expect(
      w.until(
        () => find(w, heli.id).incidentId === incident.id && find(w, heli.id).status !== 'RETURNING',
        1_800_000,
        1000,
      ),
    ).toBe(true);
    expect(find(w, heli.id).autonomy!.fuel!.ratio).toBe(1);
  });

  it('with a full tank it stays over the scene until its own bingo, never into the reserve', () => {
    const w = world({ level: 3 });
    const heli = heliOf(w);
    const incident = longJob(w);
    w.engine.dispatch(w.career, incident.id, [heli.id]);
    expect(w.until(() => find(w, heli.id).status === 'ON_SCENE')).toBe(true);
    const arrivedAt = w.now();
    expect(w.until(() => find(w, heli.id).status === 'RETURNING', 3_600_000, 1000)).toBe(true);
    const minutesOver = (w.now() - arrivedAt) / 60_000;
    expect(minutesOver).toBeGreaterThan(10);
    expect(minutesOver).toBeLessThan(50);
    expect(w.career.timelines[incident.id]!.map((e) => e.type)).toContain('vehicle.bingo_fuel');
    expect(find(w, heli.id).autonomy!.fuel!.reserve).toBe(false);
  });
});
