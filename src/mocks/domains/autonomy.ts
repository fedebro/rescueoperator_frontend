import type { IncidentDto, MovementDto, ResupplyVehicleResult, VehicleDto } from '@/contracts';
import { haversineMeters, type LngLat } from '@/lib/geo';
import { AUTONOMY as K, INCIDENT_TEMPLATES, ITEM_TYPES, VEHICLE_TYPES } from '../data/catalog';
import { MockError, iso, text, type MockCareer, type MockEngine } from '../engine';
import type { QaHelpers } from '../qa';
import { domainState } from './index';
import { logisticsOf } from './logistics';

/** Metres of a movement that burn fuel: a boat only on its water segments — the trailer tows it on the road (D-68). */
const fuelMetersOf = (m: MovementDto | null | undefined): number =>
  !m
    ? 0
    : m.segments
      ? m.segments.filter((s) => s.mode === 'WATER').reduce((sum, s) => sum + s.distanceMeters, 0)
      : m.distanceMeters;
import {
  afterFuel,
  afterResupply,
  flightMinutes,
  flightNeeds,
  fuelEnvironmentOf,
  fuelKmOf,
  fuelStationPremium,
  itemConditionMultiplier,
  legsFuelKm,
  onSceneEnduranceMinutes,
  partialUnits,
  profileOf,
  quantityOf,
  reserveOf,
  resupplyDecision,
  resupplyNeed,
  resupplySeconds,
  round1,
  scaleNeeds,
  takeoffMinutesOf,
  tripFuelKm,
  autonomySnapshot,
  type AutonomyGates,
  type AutonomyProfile,
  type AutonomyState,
  type FlightTrip,
  type FuelEnvironment,
  type ResupplyPlan,
} from './autonomy-math';

/**
 * Vehicle autonomy of the mock (D-22 [U] "Autonomia + carburante", D-67 [C]) — the in-browser counterpart of the backend's
 * `AutonomyService` (analisi/note-agenti/autonomy-fuel.md): every vehicle carries its own stock and a tank in game km; a
 * mission consumes items (template needs × night / weather / low-coverage) and fuel (km × siren / snow / off-road +
 * pump minutes on scene); after a mission the SINGLE resupply rule decides between AVAILABLE at once and a RESTOCKING stop
 * (items + fuel together, duration ∝ what is reloaded). Also: reload before departure, the "last mission" / reserve flags of
 * the dispatch screen, a fuel-station stop on a far way home in reserve (premium, ledger `FUEL`), the manual "return to
 * resupply" command and the gradual unlock (stock from level 2, fuel from level 3). Time is the engine's game time.
 */

interface Pending {
  /** Driven with sirens since the last odometer point (outbound, hospital transport). */
  sirenMeters: number;
  /** Driven without (the way home). */
  plainMeters: number;
  /** Game minutes worked on scene. */
  onSceneMinutes: number;
  /** Aircraft (unit MIN): REAL minutes flown since the last charge (take-off, legs, transport, the flight home). */
  flightMinutes?: number;
}
interface MissionContext {
  incidentId: string;
  templateCode: string;
  severity: number;
  category: string;
  position: LngLat;
  tutorial: boolean;
  /** The template consumption already came out of this vehicle (resolved or partial). */
  consumed: boolean;
}
export interface VehicleAutonomyState {
  /** Units on board per item; a missing item = standard load (full capacity), like the backend's missing row. */
  stock: Record<string, number>;
  /** 0..1 share of a full tank. */
  fuelRatio: number;
  resupplyRequested: boolean;
  pending: Pending;
  onSceneSince: number | null;
  mission: MissionContext | null;
  /**
   * What the reload before departure changed (the free undo of a dispatch gives it back exactly: the units on the shelf, the
   * fuel as it was — no "instant full tank" with dispatch + undo).
   */
  departureReload?: {
    facilityId: string;
    stock: Record<string, number>;
    fuelRatio: number;
    loads: { itemCode: string; units: number }[];
  } | null;
  /** Aircraft turned back at "bingo": the incident it goes back to once refuelled (`flight.resumeAfterRefuel`). */
  resume?: { incidentId: string } | null;
}
interface AutonomyDomainState {
  vehicles: Record<string, VehicleAutonomyState>;
  /** Incidents whose on-board shortage already slowed the work (applied once). */
  penalised: Record<string, true>;
}

const autonomyState = (career: MockCareer): AutonomyDomainState =>
  domainState<AutonomyDomainState>(career, 'autonomy', () => ({ vehicles: {}, penalised: {} }));

const EMPTY_PENDING = (): Pending => ({
  sirenMeters: 0,
  plainMeters: 0,
  onSceneMinutes: 0,
  flightMinutes: 0,
});
/** Incident statuses an aircraft may still go back to after refuelling. */
const RESUMABLE = new Set(['PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE']);
/** Top-up tolerance of an aircraft at base: never a refuel of a few seconds for a trip that almost fits (air-endurance §2). */
const AIR_TOPUP_TOLERANCE = 0.05;
/** A pump sits roughly this far along the way home (the mock has no filling-station POIs: the stop is "on the way"). */
const FUEL_STOP_AT = 0.4;
/** Work added to an incident (share of its total) when the vehicles arrive without the items it needs. */
const SHORTAGE_WORK_PENALTY = 0.25;
/** Hospital transport length from the straight line (the medical domain does not keep the leg). */
const ROAD_FACTOR = 1.3;

export interface AutonomyDomain {
  stateOf(career: MockCareer, vehicleId: string): VehicleAutonomyState;
  profileOf(career: MockCareer, vehicle: VehicleDto): AutonomyProfile;
  /** ★POST /vehicles/:id/resupply */
  requestResupply(
    career: MockCareer,
    vehicleId: string,
  ): { mode: ResupplyVehicleResult['mode']; vehicle: VehicleDto; until: string | null };
  /** QA: puts a vehicle's fuel (ratio 0..1) and/or onboard stock where a test needs it. */
  setAutonomy(
    career: MockCareer,
    vehicleId: string,
    patch: { fuel?: number; stock?: Record<string, number>; requested?: boolean },
  ): VehicleDto;
}

const domains = new WeakMap<MockEngine, AutonomyDomain>();
export function autonomyOf(engine: MockEngine): AutonomyDomain {
  const domain = domains.get(engine);
  if (!domain) throw new Error('autonomy domain not installed');
  return domain;
}

export function installAutonomy(engine: MockEngine): void {
  const typeOf = (typeCode: string) => VEHICLE_TYPES.find((t) => t.code === typeCode);
  const logistics = () => logisticsOf(engine);

  /* ───────────── state & profile ───────────── */
  const stateOf = (career: MockCareer, vehicleId: string): VehicleAutonomyState => {
    const st = autonomyState(career);
    return (st.vehicles[vehicleId] ??= {
      stock: {},
      fuelRatio: 1,
      resupplyRequested: false,
      pending: EMPTY_PENDING(),
      onSceneSince: null,
      mission: null,
    });
  };
  const gates = (): AutonomyGates => ({
    stock: engine.state.featureFlags.inventory !== false,
    fuel: engine.state.featureFlags.vehicle_fuel !== false,
  });
  const profileFor = (career: MockCareer, vehicle: Pick<VehicleDto, 'typeCode'>): AutonomyProfile =>
    profileOf(typeOf(vehicle.typeCode), ITEM_TYPES, career.summary.level, K, gates());
  const tracked = (profile: AutonomyProfile) => profile.stockUnlocked || profile.fuel !== null;
  const asState = (s: VehicleAutonomyState): AutonomyState => ({ stock: s.stock, fuelRatio: s.fuelRatio });
  const storageLevel = (career: MockCareer, facilityId: string): number =>
    career.facilities.find((f) => f.id === facilityId)?.upgrades.find((u) => u.code === 'STORAGE')?.level ??
    0;
  const shelfOf = (career: MockCareer, facilityId: string) => logistics().shelf(career, facilityId);

  /** Snow / off-road around a scene (the mock has no terrain: a MOUNTAIN incident counts as mountain terrain). */
  const environmentOf = (career: MockCareer, mission: MissionContext | null): FuelEnvironment =>
    fuelEnvironmentOf({
      terrain: mission?.category === 'MOUNTAIN' ? 'MOUNTAIN' : null,
      category: mission?.category ?? null,
      weather: engine.world(career).weather.code,
    });
  const missionOf = (incident: IncidentDto): MissionContext => ({
    incidentId: incident.id,
    templateCode: incident.templateCode,
    severity: incident.severity,
    category: incident.category,
    position: incident.position,
    tutorial: incident.isTutorial,
    consumed: false,
  });
  const templateNeeds = (templateCode: string, severity: number): Record<string, number> => {
    const needs: Record<string, number> = {};
    for (const c of INCIDENT_TEMPLATES.find((t) => t.code === templateCode)?.consumables ?? [])
      needs[c.item] = (needs[c.item] ?? 0) + Math.round(c.base + c.perSeverity * severity);
    return needs;
  };
  const itemMultiplier = (career: MockCareer, incident: Pick<IncidentDto, 'coverageRatio'>): number => {
    const world = engine.world(career);
    return itemConditionMultiplier(
      {
        night: world.dayPhase === 'NIGHT',
        weather: world.weather.code,
        meanCoverage: incident.coverageRatio,
      },
      K,
    );
  };

  /** Re-reads the vehicle through the view hook (the DTO carries its autonomy block). */
  const refresh = (career: MockCareer, vehicleId: string): VehicleDto | null =>
    engine.patchVehicle(career, vehicleId, {});

  /* ───────────── read model: `VehicleDto.autonomy` on every way out ───────────── */
  engine.hooks.vehicleView.push((career, vehicle) => {
    const s = stateOf(career, vehicle.id);
    const autonomy = autonomySnapshot(
      profileFor(career, vehicle),
      asState(s),
      shelfOf(career, vehicle.facilityId),
      K,
      s.resupplyRequested,
    );
    return { ...vehicle, autonomy };
  });

  /* ───────────── fuel ───────────── */
  /** Charges what was driven / worked since the last odometer point (the backend's `chargeRow`): tutorial missions are free. */
  const charge = (career: MockCareer, vehicle: VehicleDto, pending: Pending): number => {
    const s = stateOf(career, vehicle.id);
    const profile = profileFor(career, vehicle);
    if (!profile.fuel || s.mission?.tutorial) return 0;
    // An aircraft burns minutes of flight: every flown minute, and its on-scene rate over the scene (hovering = 1).
    const amount =
      profile.fuel.unit === 'MIN'
        ? Math.max(0, pending.flightMinutes ?? 0) +
          Math.max(0, pending.onSceneMinutes) * profile.fuel.perMinuteOnScene
        : legsFuelKm(pending, profile.fuel, environmentOf(career, s.mission), K);
    s.fuelRatio = afterFuel(profile.fuel, asState(s), amount).fuelRatio;
    return amount;
  };

  /* ───────────── flight endurance (phase 3) ───────────── */
  const isAircraft = (vehicle: Pick<VehicleDto, 'typeCode'>): boolean =>
    typeOf(vehicle.typeCode)?.movement === 'AIR';
  /** REAL minutes of a straight flight of this aircraft (the mock flies straight at `airSpeedKmh`, × 0.25 like D-63). */
  const flyMinutes = (typeCode: string, meters: number): number =>
    flightMinutes(meters, typeOf(typeCode)?.airSpeedKmh ?? 200);
  const tripOf = (typeCode: string, meters: number): FlightTrip => ({
    outboundMinutes: takeoffMinutesOf(typeOf(typeCode)?.mobilityProfile) + flyMinutes(typeCode, meters),
    backMinutes: flyMinutes(typeCode, meters),
  });
  const homeOf = (career: MockCareer, vehicle: VehicleDto) =>
    career.facilities.find((f) => f.id === vehicle.facilityId)?.position ?? vehicle.position;

  /**
   * "Bingo": over the scene the aircraft turns back when the endurance left is the flight home + the reserve. Armed at every
   * arrival (and whenever QA moves its fuel): an `AIR_BINGO` action at that instant.
   */
  const armBingo = (career: MockCareer, vehicle: VehicleDto, at: number): void => {
    engine.cancelActions(career, (a) => a.type === 'AIR_BINGO' && a.ref === vehicle.id);
    const profile = profileFor(career, vehicle);
    if (profile.fuel?.unit !== 'MIN' || vehicle.status !== 'ON_SCENE') return;
    const s = stateOf(career, vehicle.id);
    if (s.mission?.tutorial) return;
    const left = fuelKmOf(profile.fuel, asState(s));
    const home = flyMinutes(vehicle.typeCode, haversineMeters(vehicle.position, homeOf(career, vehicle)));
    const minutes = onSceneEnduranceMinutes(left, home, profile.fuel, K);
    if (minutes === null) return;
    career.actions.push({
      id: engine.id('act'),
      type: 'AIR_BINGO',
      dueAt: at + engine.dur(minutes * 60),
      ref: vehicle.id,
    });
  };

  engine.registerExecutor('AIR_BINGO', (career, action) => {
    const vehicle = career.vehicles.find((v) => v.id === action.ref);
    if (!vehicle || vehicle.status !== 'ON_SCENE' || !vehicle.incidentId) return;
    const incident = career.incidents.find((i) => i.id === vehicle.incidentId);
    if (!incident) return;
    const at = action.dueAt;
    // Rotation (`flight.resumeAfterRefuel`): it goes home, refuels, then flies back on its own if the call is still open.
    const resume = K.flight.resumeAfterRefuel && !incident.isTutorial;
    stateOf(career, vehicle.id).resume = resume ? { incidentId: incident.id } : null;
    const returning = engine.sendHome(career, vehicle, at, engine.destinationOf(vehicle, incident));
    engine.log(
      career,
      incident.id,
      'vehicle.bingo_fuel',
      text(resume ? 'timeline.vehicle_bingo_fuel_resume' : 'timeline.vehicle_bingo_fuel', {
        callSign: vehicle.callSign,
      }),
      at,
      vehicle.id,
    );
    const next = engine.recompute(career, incident.id, at);
    engine.emit(career, 'vehicle.updated', {
      vehicle: career.vehicles.find((v) => v.id === vehicle.id) ?? returning,
      bingo: true,
      ...(resume ? { queued: true, queuedIncidentId: incident.id } : {}),
    });
    if (next) engine.emit(career, 'incident.updated', { incident: next });
  });

  /** Back and refuelled: an aircraft turned back at bingo flies back through the normal dispatch (which re-checks all). */
  engine.registerExecutor('AIR_RESUME', (career, action) => {
    const s = stateOf(career, action.ref);
    const target = s.resume;
    s.resume = null;
    const vehicle = career.vehicles.find((v) => v.id === action.ref);
    if (!target || !vehicle || vehicle.status !== 'AVAILABLE') return;
    const incident = career.incidents.find((i) => i.id === target.incidentId && RESUMABLE.has(i.status));
    const cleared = () =>
      engine.notify(career, {
        category: 'FLEET',
        priority: 'INFO',
        title: text('notification.QUEUE_CLEARED.title'),
        body: text('notification.QUEUE_CLEARED.body', { callSign: vehicle.callSign }),
        action: { kind: 'OPEN_VEHICLE', targetId: vehicle.id },
      });
    if (!incident) {
      cleared();
      return;
    }
    try {
      engine.dispatch(career, incident.id, [vehicle.id], 'QUEUE');
    } catch {
      cleared();
    }
  });
  const scheduleResume = (career: MockCareer, vehicleId: string, at: number): void => {
    if (!stateOf(career, vehicleId).resume) return;
    career.actions.push({ id: engine.id('act'), type: 'AIR_RESUME', dueAt: at, ref: vehicleId });
  };

  /** At base: the single rule's stop, or — when THIS trip needs more fuel than is on board — a full top-up. */
  const departurePlan = (
    profile: AutonomyProfile,
    state: AutonomyState,
    shelf: Record<string, number>,
    fuelNeeded: number | null,
    storage: number,
    tolerance = 0,
  ): ResupplyPlan | null => {
    const rule = resupplyDecision(profile, state, shelf, K, { storageLevel: storage });
    if (rule) return rule;
    if (profile.fuel && fuelNeeded !== null && fuelKmOf(profile.fuel, state) + 1e-6 + tolerance < fuelNeeded)
      return resupplyDecision(profile, state, shelf, K, {
        forced: true,
        forcedReason: 'TRIP',
        storageLevel: storage,
      });
    return null;
  };

  /** Shelf → vehicle (capped by what the shelf really holds), full tank. `null` when nothing moved. */
  const applyPlan = (
    career: MockCareer,
    vehicle: VehicleDto,
    profile: AutonomyProfile,
    plan: ResupplyPlan,
  ): { loads: { itemCode: string; units: number }[]; fuelKm: number } | null => {
    const s = stateOf(career, vehicle.id);
    const loads = logistics().loadOntoVehicle(career, vehicle.facilityId, plan.loads);
    for (const load of loads) {
      const item = profile.items.find((i) => i.code === load.itemCode);
      if (item) s.stock[load.itemCode] = Math.min(item.capacity, quantityOf(item, asState(s)) + load.units);
    }
    const fuelKm = profile.fuel ? plan.fuelKm : 0;
    if (fuelKm > 0) s.fuelRatio = 1;
    if (loads.length === 0 && fuelKm <= 0) return null;
    return { loads, fuelKm };
  };

  const rememberStop = (
    career: MockCareer,
    vehicleId: string,
    applied: { loads: { units: number }[]; fuelKm: number },
    at: number,
  ): void => {
    const units = applied.loads.reduce((sum, l) => sum + l.units, 0);
    if (units > 0)
      logistics().remember(
        career,
        vehicleId,
        'RESTOCKED',
        text('logistics.history.RESTOCKED', { units }),
        at,
      );
    else if (applied.fuelKm > 0)
      logistics().remember(
        career,
        vehicleId,
        'REFUELED',
        text('logistics.history.REFUELED', { km: Math.round(applied.fuelKm) }),
        at,
      );
  };

  /**
   * The vehicle is home and AVAILABLE: THE single rule decides whether it reloads now (RESTOCKING) or stays AVAILABLE —
   * and ready for the next call — at once. A pending manual request forces a top-up. Returns true when a stop started.
   */
  const stopAtBase = (career: MockCareer, vehicleId: string, at: number): boolean => {
    const vehicle = career.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle || vehicle.status !== 'AVAILABLE') return false;
    const s = stateOf(career, vehicleId);
    const forced = s.resupplyRequested;
    const profile = profileFor(career, vehicle);
    const storage = storageLevel(career, vehicle.facilityId);
    const plan = tracked(profile)
      ? resupplyDecision(profile, asState(s), shelfOf(career, vehicle.facilityId), K, {
          forced,
          forcedReason: 'MANUAL',
          storageLevel: storage,
        })
      : null;
    s.resupplyRequested = false;
    if (!plan) return false;
    const applied = applyPlan(career, vehicle, profile, plan);
    if (!applied) return false;
    const seconds = resupplySeconds(profile, applied.loads, applied.fuelKm, K, storage);
    const until = at + engine.dur(seconds);
    engine.patchVehicle(career, vehicleId, { status: 'RESTOCKING', busyUntil: iso(until) });
    engine.cancelActions(career, (a) => a.type === 'RESTOCK_COMPLETE' && a.ref === vehicleId);
    career.actions.push({ id: engine.id('act'), type: 'RESTOCK_COMPLETE', dueAt: until, ref: vehicleId });
    rememberStop(career, vehicleId, applied, at);
    return true;
  };

  engine.registerExecutor('RESTOCK_COMPLETE', (career, action) => {
    const vehicle = career.vehicles.find((v) => v.id === action.ref);
    if (!vehicle || vehicle.status !== 'RESTOCKING') return;
    const ready = engine.patchVehicle(career, vehicle.id, { status: 'AVAILABLE', busyUntil: null })!;
    engine.emit(career, 'vehicle.updated', { vehicle: ready });
    scheduleResume(career, vehicle.id, action.dueAt);
  });

  /* ───────────── consumption ───────────── */
  /** Takes `needs` from the stock ON BOARD of `vehicles`, greedy in dispatch order, each capped by what it carries. */
  const consume = (career: MockCareer, vehicles: VehicleDto[], needs: Record<string, number>): void => {
    for (const [code, need] of Object.entries(needs)) {
      let left = Math.round(need);
      for (const v of vehicles) {
        if (left <= 0) break;
        const item = profileFor(career, v).items.find((i) => i.code === code);
        if (!item) continue;
        const s = stateOf(career, v.id);
        const onboard = quantityOf(item, asState(s));
        const take = Math.min(left, onboard);
        if (take <= 0) continue;
        s.stock[code] = onboard - take;
        left -= take;
      }
    }
  };

  /** A vehicle that worked on scene leaves an incident that is not being resolved: it still used part of its material. */
  const consumePartial = (career: MockCareer, vehicle: VehicleDto, carriers: number): void => {
    const s = stateOf(career, vehicle.id);
    const mission = s.mission;
    if (!mission || mission.consumed || mission.tutorial) return;
    mission.consumed = true;
    const needs = scaleNeeds(
      templateNeeds(mission.templateCode, mission.severity),
      itemMultiplier(career, { coverageRatio: 1 }),
    );
    const profile = profileFor(career, vehicle);
    for (const [code, need] of Object.entries(needs)) {
      const item = profile.items.find((i) => i.code === code);
      if (!item) continue;
      const onboard = quantityOf(item, asState(s));
      const take = Math.min(partialUnits(need, K.partialConsumptionShare, carriers), onboard);
      if (take > 0) s.stock[code] = onboard - take;
    }
  };

  engine.hooks.workDone.push((career, incident) => {
    if (incident.isTutorial) return;
    const needs = scaleNeeds(
      templateNeeds(incident.templateCode, incident.severity),
      itemMultiplier(career, incident),
    );
    const order = career.legs.filter((l) => l.incidentId === incident.id).map((l) => l.vehicleId);
    const committed = career.vehicles
      .filter((v) => v.incidentId === incident.id)
      .sort((a, b) => {
        const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
        return rank(a.id) - rank(b.id);
      });
    consume(career, committed, needs);
    for (const v of committed) {
      const mission = stateOf(career, v.id).mission;
      if (mission?.incidentId === incident.id) mission.consumed = true;
      refresh(career, v.id);
    }
  });

  engine.hooks.incidentClosed.push((career, incident, status) => {
    delete autonomyState(career).penalised[incident.id];
    if (status !== 'FAILED' && status !== 'EXPIRED') return;
    const worked = career.legs.filter((l) => l.incidentId === incident.id && l.arrivedAt !== null);
    for (const leg of worked) {
      const v = career.vehicles.find((x) => x.id === leg.vehicleId);
      if (!v) continue;
      consumePartial(career, v, worked.length);
      refresh(career, v.id);
    }
  });

  /* ───────────── dispatch: preview, reload before departure ───────────── */
  engine.hooks.dispatchOption.push((career, vehicle, option, incident) => {
    if (vehicle.status !== 'AVAILABLE') return option;
    const profile = profileFor(career, vehicle);
    if (!profile.stockUnlocked && !profile.fuelUnlocked) return option;
    const s = stateOf(career, vehicle.id);
    const state = asState(s);
    const env = environmentOf(career, missionOf(incident));
    const onSceneMinutes = Math.max(0, incident.work.remaining) / 60;
    // An aircraft (unit MIN): minutes of flight for there + back + the minimal time over the scene + the reserve.
    const air = profile.fuel?.unit === 'MIN' ? profile.fuel : null;
    const trip = air ? tripOf(vehicle.typeCode, option.distanceMeters) : null;
    const flightNeed = air && trip ? flightNeeds(trip, air, K, onSceneMinutes) : null;
    // A boat burns fuel on the water only (its option says how many of the metres are on the water).
    const meters = option.boatRoute ? option.boatRoute.waterMeters : option.distanceMeters;
    const fuelNeeded = flightNeed
      ? flightNeed.minimum
      : profile.fuel
        ? tripFuelKm(meters, meters, onSceneMinutes, profile.fuel, env, K)
        : null;
    const fuelNow = profile.fuel ? fuelKmOf(profile.fuel, state) : null;
    // A road vehicle refuels for there + back; an aircraft for what this trip is expected to take (long ones leave full).
    const plan = departurePlan(
      profile,
      state,
      shelfOf(career, vehicle.facilityId),
      flightNeed ? flightNeed.expected : fuelNeeded,
      storageLevel(career, vehicle.facilityId),
      air ? AIR_TOPUP_TOLERANCE * air.rangeKm : 0,
    );
    const leaving = plan ? afterResupply(profile, state, plan) : state;
    const fuelLeaving = profile.fuel ? fuelKmOf(profile.fuel, leaving) : null;
    const enoughFuel = fuelNeeded === null || fuelLeaving === null || fuelLeaving + 1e-6 >= fuelNeeded;
    // Not even there and back with the reserve intact, full tank included: not dispatchable at all.
    const enduranceBlocked =
      flightNeed !== null && fuelLeaving !== null && fuelLeaving + 1e-6 < flightNeed.reachAndReturn;
    const warnings = [...option.warnings];
    for (const item of profile.items) {
      const quantity = quantityOf(item, leaving);
      if (quantity <= 0) warnings.push(`STOCK_MISSING:${item.code}`);
      else if (quantity < item.missionNeed) warnings.push(`STOCK_LOW:${item.code}`);
    }
    if (plan) warnings.push('RESUPPLY_BEFORE_DEPARTURE');
    // Always at base in the mock (no patrols): not even a full tank covers it.
    if (!enoughFuel) warnings.push('FUEL_RANGE_INSUFFICIENT');
    const needs = templateNeeds(incident.templateCode, incident.severity);
    // An aircraft flies its expected mission or, sooner, until its reserve (then it turns back): never into the reserve.
    const burnt =
      flightNeed && air && fuelLeaving !== null
        ? Math.max(0, Math.min(fuelLeaving, flightNeed.expected) - reserveOf(air, K))
        : fuelNeeded;
    const after = profile.fuel && burnt !== null ? afterFuel(profile.fuel, leaving, burnt) : leaving;
    const afterStock = { ...after.stock };
    for (const item of profile.items)
      afterStock[item.code] = Math.max(0, quantityOf(item, leaving) - (needs[item.code] ?? 0));
    const lastMission =
      enoughFuel && resupplyNeed(profile, { stock: afterStock, fuelRatio: after.fuelRatio }, K).low;
    if (lastMission) warnings.push('LAST_MISSION_BEFORE_RESUPPLY');
    // The option's times are real seconds (game seconds / speed), like its ETA.
    const reloadSeconds = plan ? Math.round(plan.seconds / engine.speed) : 0;
    const onSceneFor =
      air && trip && fuelLeaving !== null
        ? onSceneEnduranceMinutes(fuelLeaving - trip.outboundMinutes, trip.backMinutes, air, K)
        : null;
    return {
      ...option,
      etaSeconds: option.etaSeconds + reloadSeconds,
      warnings,
      ...(enduranceBlocked && option.dispatchable
        ? { dispatchable: false, blockedReason: 'ENDURANCE_INSUFFICIENT' }
        : {}),
      notRecommended: option.notRecommended || !enoughFuel || enduranceBlocked,
      autonomy: {
        fuelNeededKm: fuelNeeded === null ? null : round1(fuelNeeded),
        fuelKm: fuelNow === null ? null : round1(fuelNow),
        enoughFuel,
        resupplyBeforeDepartureSeconds: reloadSeconds,
        lastMissionBeforeResupply: lastMission,
        ...(profile.fuel ? { fuelUnit: profile.fuel.unit } : {}),
        ...(air ? { onSceneMinutes: onSceneFor === null ? null : round1(onSceneFor) } : {}),
      },
    };
  });

  /** The free undo of a dispatch gives back the reload before departure: units back on the shelf, the fuel as it was. */
  engine.hooks.dispatchCancelled.push((career, vehicles) => {
    for (const vehicle of vehicles) {
      const s = stateOf(career, vehicle.id);
      const saved = s.departureReload;
      if (saved) {
        s.stock = { ...saved.stock };
        s.fuelRatio = saved.fuelRatio;
        if (saved.loads.length > 0) logistics().unloadFromVehicle(career, saved.facilityId, saved.loads);
      }
      s.departureReload = null;
      s.mission = null;
      s.pending = EMPTY_PENDING();
      s.onSceneSince = null;
      refresh(career, vehicle.id);
    }
  });

  engine.hooks.departureDelay.push((career, vehicle, incident, at) => {
    const s = stateOf(career, vehicle.id);
    s.mission = missionOf(incident);
    s.pending = EMPTY_PENDING();
    s.onSceneSince = null;
    s.resume = null;
    // What the free undo of this dispatch would give back (the reload below, if any).
    s.departureReload = {
      facilityId: vehicle.facilityId,
      stock: { ...s.stock },
      fuelRatio: s.fuelRatio,
      loads: [],
    };
    const profile = profileFor(career, vehicle);
    if (!tracked(profile)) return 0;
    // The same deterministic leg the departure is about to take (a boat: its water metres only).
    const planned = engine.legFor(career, vehicle, incident);
    const outbound = planned.fuelMeters ?? planned.distanceMeters;
    const onScene = Math.max(0, incident.work.remaining) / 60;
    const air = profile.fuel?.unit === 'MIN' ? profile.fuel : null;
    const fuelNeeded = air
      ? flightNeeds(tripOf(vehicle.typeCode, planned.distanceMeters), air, K, onScene).expected
      : profile.fuel
        ? tripFuelKm(outbound, outbound, onScene, profile.fuel, environmentOf(career, s.mission), K)
        : null;
    const storage = storageLevel(career, vehicle.facilityId);
    const plan = departurePlan(
      profile,
      asState(s),
      shelfOf(career, vehicle.facilityId),
      fuelNeeded,
      storage,
      air ? AIR_TOPUP_TOLERANCE * air.rangeKm : 0,
    );
    if (!plan) return 0;
    const applied = applyPlan(career, vehicle, profile, plan);
    if (!applied) return 0;
    s.departureReload.loads = applied.loads;
    engine.log(
      career,
      incident.id,
      'vehicle.resupplied',
      text('timeline.vehicle_resupply_before_departure', { callSign: vehicle.callSign }),
      at,
      vehicle.id,
    );
    rememberStop(career, vehicle.id, applied, at);
    return resupplySeconds(profile, applied.loads, applied.fuelKm, K, storage);
  });

  /* ───────────── on scene, on the way home ───────────── */
  engine.hooks.vehicleArrived.push((career, vehicle, incident, at) => {
    const s = stateOf(career, vehicle.id);
    s.departureReload = null;
    if (s.mission?.incidentId !== incident.id) s.mission = missionOf(incident);
    const leg = [...career.legs]
      .reverse()
      .find((l) => l.vehicleId === vehicle.id && l.incidentId === incident.id);
    s.onSceneSince = at;
    if (isAircraft(vehicle)) {
      // An aircraft's gauge drops during the mission: the take-off and the flight out are charged at the arrival, then the
      // "bingo" instant is armed from what is left.
      s.pending.flightMinutes =
        (s.pending.flightMinutes ?? 0) + tripOf(vehicle.typeCode, leg?.distanceMeters ?? 0).outboundMinutes;
      charge(career, vehicle, { ...s.pending, onSceneMinutes: 0 });
      s.pending = EMPTY_PENDING();
      armBingo(career, { ...vehicle, status: 'ON_SCENE' }, at);
    } else s.pending.sirenMeters += leg?.fuelMeters ?? leg?.distanceMeters ?? 0;
    // Arriving without an item the incident needs (nothing on board, nothing on the shelf before leaving): the work takes
    // longer, once per incident — the mock's stand-in for the backend's `affectedCapability × missingMultiplier`.
    const st = autonomyState(career);
    if (st.penalised[incident.id] || incident.isTutorial) return;
    const needs = templateNeeds(incident.templateCode, incident.severity);
    const carried = profileFor(career, vehicle).items.filter((i) => (needs[i.code] ?? 0) > 0);
    if (carried.length === 0) return;
    const missing = carried.filter((i) => quantityOf(i, asState(s)) <= 0).length;
    if (missing === 0) return;
    st.penalised[incident.id] = true;
    const live = career.incidents.find((i) => i.id === incident.id) ?? incident;
    const extra = live.work.total * SHORTAGE_WORK_PENALTY * (missing / carried.length);
    engine.patchIncident(career, incident.id, {
      work: { ...live.work, total: live.work.total + extra, remaining: live.work.remaining + extra },
    });
  });

  engine.hooks.vehicleSentHome.push((career, before, after, at) => {
    const s = stateOf(career, before.id);
    engine.cancelActions(career, (a) => a.type === 'AIR_BINGO' && a.ref === before.id);
    if (isAircraft(before)) {
      // Minutes of flight: the share of the outbound actually flown, the time over the scene, a hospital leg, the way home.
      if (before.status === 'EN_ROUTE' && before.movement) {
        const depart = Date.parse(before.movement.departAt);
        const arrive = Date.parse(before.movement.arriveAt);
        const share = Math.min(1, Math.max(0, (at - depart) / Math.max(1, arrive - depart)));
        s.pending.flightMinutes =
          (s.pending.flightMinutes ?? 0) +
          tripOf(before.typeCode, before.movement.distanceMeters).outboundMinutes * share;
      }
      if (before.status === 'ON_SCENE' && s.onSceneSince !== null) {
        s.pending.onSceneMinutes += (Math.max(0, at - s.onSceneSince) * engine.speed) / 60_000;
        s.onSceneSince = null;
      }
      if ((before.status === 'AT_HOSPITAL' || before.status === 'TRANSPORTING') && s.mission)
        s.pending.flightMinutes =
          (s.pending.flightMinutes ?? 0) +
          flyMinutes(before.typeCode, haversineMeters(s.mission.position, before.position));
      s.pending.flightMinutes =
        (s.pending.flightMinutes ?? 0) + flyMinutes(before.typeCode, after.movement?.distanceMeters ?? 0);
      refresh(career, before.id);
      return;
    }
    if (before.status === 'EN_ROUTE' && before.movement) {
      // Recalled (or the incident closed) on the way: only the share of the outbound leg actually driven.
      const depart = Date.parse(before.movement.departAt);
      const arrive = Date.parse(before.movement.arriveAt);
      const share = Math.min(1, Math.max(0, (at - depart) / Math.max(1, arrive - depart)));
      s.pending.sirenMeters += fuelMetersOf(before.movement) * share;
    }
    if (before.status === 'ON_SCENE' && s.onSceneSince !== null) {
      s.pending.onSceneMinutes += (Math.max(0, at - s.onSceneSince) * engine.speed) / 60_000;
      s.onSceneSince = null;
      // Leaving the scene of an incident still open and not resolving (a recall): part of the material was used.
      const incident = career.incidents.find((i) => i.id === before.incidentId);
      if (incident && incident.status !== 'RESOLVING') {
        const carriers = career.legs.filter(
          (l) => l.incidentId === incident.id && l.arrivedAt !== null,
        ).length;
        consumePartial(career, before, carriers);
      }
    }
    if ((before.status === 'AT_HOSPITAL' || before.status === 'TRANSPORTING') && s.mission)
      s.pending.sirenMeters += haversineMeters(s.mission.position, before.position) * ROAD_FACTOR;
    const returnMeters = fuelMetersOf(after.movement);
    s.pending.plainMeters += returnMeters;
    planFuelStop(career, after, returnMeters, at);
    refresh(career, before.id);
  });

  /**
   * "After a far mission, in reserve" (phase 2): would this vehicle, once home, stop ONLY to refuel? Then it refuels at a
   * filling station on the way (+stopSeconds, premium share × refilled km × costPerKm, ledger FUEL) and skips the stop.
   */
  const planFuelStop = (
    career: MockCareer,
    returning: VehicleDto,
    returnMeters: number,
    at: number,
  ): void => {
    const s = stateOf(career, returning.id);
    const profile = profileFor(career, returning);
    const movement = returning.movement;
    // No filling stations in the sky: an aircraft refuels only at its own base.
    if (!profile.fuel || profile.fuel.unit !== 'KM' || !movement || s.mission?.tutorial) return;
    if (!K.fuelStations.enabled || !gates().fuel || returnMeters < K.fuelStations.farReturnKm * 1000) return;
    const env = environmentOf(career, s.mission);
    const home = afterFuel(profile.fuel, asState(s), legsFuelKm(s.pending, profile.fuel, env, K));
    if (!resupplyNeed({ ...profile, items: [] }, home, K).fuelLow) return;
    // Items that would force a stop at base anyway: no point refuelling on the way.
    if (resupplyDecision(profile, { ...home, fuelRatio: 1 }, shelfOf(career, returning.facilityId), K))
      return;
    // Everything up to the pump is charged now; the rest of the way home at the arrival.
    const rest = returnMeters * (1 - FUEL_STOP_AT);
    charge(career, returning, { ...s.pending, plainMeters: s.pending.plainMeters - rest });
    const atPump = fuelKmOf(profile.fuel, asState(s));
    const refilledKm = round1(profile.fuel.rangeKm - atPump);
    s.fuelRatio = 1;
    s.pending = { sirenMeters: 0, plainMeters: rest, onSceneMinutes: 0 };
    const premium = fuelStationPremium(refilledKm, typeOf(returning.typeCode)?.costPerKm ?? 0, K);
    // Never below a zero balance (D-31): an unaffordable premium is simply skipped.
    if (premium > 0 && Number(career.summary.credits) >= premium)
      engine.credit(
        career,
        -premium,
        'FUEL',
        false,
        text('ledger.FUEL', { refilledKm, callSign: returning.callSign }),
      );
    const extra = engine.dur(K.fuelStations.stopSeconds);
    const arriveAt = Date.parse(movement.arriveAt) + extra;
    engine.cancelActions(career, (a) => a.type === 'VEHICLE_RETURNED' && a.ref === returning.id);
    career.actions.push({
      id: engine.id('act'),
      type: 'VEHICLE_RETURNED',
      dueAt: arriveAt,
      ref: returning.id,
    });
    engine.patchVehicle(career, returning.id, {
      busyUntil: iso(arriveAt),
      movement: { ...movement, arriveAt: iso(arriveAt) },
    });
    if (s.mission)
      engine.log(
        career,
        s.mission.incidentId,
        'vehicle.refuel_stop',
        text('timeline.vehicle_refuel_stop', { callSign: returning.callSign }),
        at,
        returning.id,
      );
    logistics().remember(
      career,
      returning.id,
      'REFUELED_ON_THE_WAY',
      text('logistics.history.REFUELED_ON_THE_WAY', { km: Math.round(refilledKm) }),
      at,
    );
  };

  engine.hooks.vehicleReturned.push((career, vehicle, _leg, at) => {
    const s = stateOf(career, vehicle.id);
    if (at === undefined) {
      // Towed home after a breakdown: the fuel was charged where it broke down, and no stop follows the workshop.
      s.pending = EMPTY_PENDING();
      s.onSceneSince = null;
      s.mission = null;
      return;
    }
    charge(career, vehicle, s.pending);
    s.pending = EMPTY_PENDING();
    s.onSceneSince = null;
    s.mission = null;
    if (!stopAtBase(career, vehicle.id, at)) {
      refresh(career, vehicle.id);
      // Nothing to reload (rare after a bingo): an aircraft turned back flies out again at once.
      scheduleResume(career, vehicle.id, at);
    }
  });

  engine.hooks.vehicleBrokeDown.push((career, before, at) => {
    const s = stateOf(career, before.id);
    const m = before.movement;
    engine.cancelActions(career, (a) => a.type === 'AIR_BINGO' && a.ref === before.id);
    s.resume = null;
    if (m && isAircraft(before)) {
      const depart = Date.parse(m.departAt);
      const arrive = Date.parse(m.arriveAt);
      const share = Math.min(1, Math.max(0, (at - depart) / Math.max(1, arrive - depart)));
      s.pending.flightMinutes =
        (s.pending.flightMinutes ?? 0) + flyMinutes(before.typeCode, m.distanceMeters) * share;
    } else if (m) {
      // Only the share of the leg actually driven burnt fuel (the tow home is not its own engine).
      const depart = Date.parse(m.departAt);
      const arrive = Date.parse(m.arriveAt);
      const share = Math.min(1, Math.max(0, (at - depart) / Math.max(1, arrive - depart)));
      if (m.purpose === 'TO_INCIDENT') s.pending.sirenMeters += fuelMetersOf(m) * share;
      else if (m.purpose === 'TO_BASE') s.pending.plainMeters -= fuelMetersOf(m) * (1 - share);
    }
    if (before.status === 'ON_SCENE' && s.onSceneSince !== null)
      s.pending.onSceneMinutes += (Math.max(0, at - s.onSceneSince) * engine.speed) / 60_000;
    charge(career, before, {
      ...s.pending,
      plainMeters: Math.max(0, s.pending.plainMeters),
    });
    s.pending = EMPTY_PENDING();
    s.onSceneSince = null;
  });

  /* ───────────── gradual unlock: the fleet learns it at the level-up ───────────── */
  engine.hooks.levelReached.push((career) => {
    if (career.vehicles.length === 0) return;
    career.vehicles = career.vehicles.map((v) => engine.view(career, v));
    engine.emit(career, 'vehicle.updated', { vehicles: career.vehicles });
  });

  /* ───────────── manual "return to resupply" ───────────── */
  const requestResupply: AutonomyDomain['requestResupply'] = (career, vehicleId) => {
    const vehicle = career.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
    const s = stateOf(career, vehicleId);
    const now = engine.now();
    let mode: ResupplyVehicleResult['mode'];
    let until: string | null = null;
    if (vehicle.status === 'RESTOCKING') {
      mode = 'ALREADY_RESUPPLYING';
      until = vehicle.busyUntil;
    } else if (vehicle.status === 'RETURNING') {
      s.resupplyRequested = true;
      mode = 'SCHEDULED_ON_RETURN';
    } else if (vehicle.status === 'AVAILABLE') {
      s.resupplyRequested = true;
      const started = stopAtBase(career, vehicleId, now);
      mode = started ? 'RESTOCKING' : 'ALREADY_FULL';
      until = started ? (career.vehicles.find((v) => v.id === vehicleId)?.busyUntil ?? null) : null;
    } else {
      throw new MockError(
        409,
        'VEHICLE_NOT_AVAILABLE',
        'This vehicle is busy: it can resupply once it is back',
        {
          vehicles: [{ id: vehicleId, status: vehicle.status }],
        },
      );
    }
    const dto = refresh(career, vehicleId)!;
    if (mode !== 'ALREADY_FULL' && mode !== 'ALREADY_RESUPPLYING')
      engine.emit(career, 'vehicle.updated', { vehicle: dto, resupply: mode });
    engine.save();
    return { mode, vehicle: dto, until };
  };

  const setAutonomy: AutonomyDomain['setAutonomy'] = (career, vehicleId, patch) => {
    const vehicle = career.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
    const s = stateOf(career, vehicleId);
    const now = engine.now();
    if (isAircraft(vehicle) && vehicle.status === 'ON_SCENE' && s.onSceneSince !== null) {
      // Over the scene: settle what it burnt so far before the new level applies.
      s.pending.onSceneMinutes += (Math.max(0, now - s.onSceneSince) * engine.speed) / 60_000;
      charge(career, vehicle, { ...s.pending, flightMinutes: s.pending.flightMinutes ?? 0 });
      s.pending = EMPTY_PENDING();
      s.onSceneSince = now;
    }
    if (patch.fuel !== undefined) s.fuelRatio = Math.min(1, Math.max(0, patch.fuel));
    if (patch.stock)
      for (const [code, units] of Object.entries(patch.stock)) s.stock[code] = Math.max(0, units);
    if (patch.requested !== undefined) s.resupplyRequested = patch.requested;
    // A new level of flight endurance moves the "bingo" instant of an aircraft over the scene.
    if (isAircraft(vehicle) && vehicle.status === 'ON_SCENE') armBingo(career, vehicle, now);
    const dto = refresh(career, vehicleId)!;
    engine.emit(career, 'vehicle.updated', { vehicle: dto });
    engine.save();
    return dto;
  };

  const domain: AutonomyDomain = {
    stateOf,
    profileOf: profileFor,
    requestResupply,
    setAutonomy,
  };
  domains.set(engine, domain);

  /* ───────────── QA helpers ───────────── */
  const pick = (vehicleId: string | null | undefined): string => {
    const career = engine.qa.career();
    const id = vehicleId ?? career.vehicles[0]?.id;
    if (!id) throw new MockError(404, 'NOT_FOUND', 'No vehicle');
    return id;
  };
  const helpers = {
    /**
     * Puts a vehicle's autonomy where a test needs it (default: the first vehicle): `fuel` = share of a full tank (0..1),
     * `stock` = units on board per item code, `requested` = a manual resupply pending.
     */
    setAutonomy: (
      vehicleId: string | null,
      patch: { fuel?: number; stock?: Record<string, number>; requested?: boolean },
    ) => setAutonomy(engine.qa.career(), pick(vehicleId), patch).id,
    /** The autonomy block of a vehicle as the client sees it (default: the first vehicle). */
    autonomy: (vehicleId?: string | null) => {
      const career = engine.qa.career();
      const id = pick(vehicleId);
      return (
        engine.view(
          career,
          career.vehicles.find((v) => v.id === id)!,
        ).autonomy ?? null
      );
    },
    /**
     * Spawns an incident `km` east of the headquarters, beyond the municipality — to reach the range limit of a tank
     * ("Autonomia insufficiente") or a far way home in reserve (a stop at a filling station).
     */
    spawnAway: (templateCode: string, severity: number, km: number) => {
      const career = engine.qa.career();
      const [lng, lat] = career.facilities[0]!.position;
      const incident = engine.spawnIncident(career, templateCode, false, {
        severity,
        position: [lng + km / 82, lat],
      });
      engine.save();
      return incident.id;
    },
  };
  const attach = () => Object.assign(engine.qa, helpers as unknown as Partial<QaHelpers>);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}
