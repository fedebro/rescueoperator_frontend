import type { VehicleAutonomyDto } from '@/contracts';
import type { AutonomyKnobs, MockVehicleType, RawItemConsumption } from '../data/catalog';

/**
 * Vehicle autonomy — the pure maths of the mock (D-22 [U] "Autonomia + carburante", D-67 [C]). A line-by-line port of the
 * backend's `src/modules/inventory/autonomy.math.ts` (analisi/note-agenti/autonomy-fuel.md §2): the same single resupply
 * rule, thresholds, multipliers and estimate, so the in-browser demo and the e2e suite behave like the server. No state here.
 */

export interface MockItemType {
  code: string;
  requiredLevel: number;
  consumption: RawItemConsumption;
}

/** One item a vehicle type carries at a given career level (capacity resolved per vehicle type). */
export interface CarriedItem {
  code: string;
  capacity: number;
  missionNeed: number;
  averageUse: number;
  loadSecondsPerUnit: number;
  affectedCapability: string;
  missingMultiplier: number;
  autoRestock: boolean;
}

/**
 * `KM` = a road / water tank in game km. `MIN` = an aircraft's flight endurance (phase 3, air-endurance.md): every "km" of
 * this module (`rangeKm`, `fuelKmOf`, thresholds, plans) is then REAL minutes of flight, exactly like the backend.
 */
export type FuelUnit = 'KM' | 'MIN';

export interface FuelProfile {
  unit: FuelUnit;
  rangeKm: number;
  /** Km of autonomy burnt per (game) minute on scene: pump, ladder, crane, generator, lighting. For an aircraft: minutes of
   * flight burnt per minute over the scene (1 = hovering / circling throughout, 0.4 = mostly landed). */
  perMinuteOnScene: number;
}

export interface AutonomyProfile {
  stockUnlocked: boolean;
  fuelUnlocked: boolean;
  items: CarriedItem[];
  fuel: FuelProfile | null;
}

/** What is on board right now. A missing item means "standard load" = full capacity (backend migration 023). */
export interface AutonomyState {
  stock: Record<string, number>;
  /** 0..1 share of a full tank. */
  fuelRatio: number;
}

export interface AutonomyGates {
  /** `inventory` feature flag. */
  stock: boolean;
  /** `vehicle_fuel` feature flag. */
  fuel: boolean;
}

type VehicleTypeLike = Pick<MockVehicleType, 'caps' | 'autonomy' | 'movement'> &
  Partial<Pick<MockVehicleType, 'airSpeedKmh'>>;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const round1 = (value: number): number => Math.round(value * 10) / 10;

export function capacityOf(item: MockItemType, type: Pick<MockVehicleType, 'autonomy'> | undefined): number {
  return type?.autonomy.onboardCapacity[item.code] ?? item.consumption.onboardCapacity;
}

export function carriedItemsOf(
  type: VehicleTypeLike,
  items: readonly MockItemType[],
  level: number,
  knobs: Pick<AutonomyKnobs, 'stockFromLevel'>,
): CarriedItem[] {
  if (level < knobs.stockFromLevel) return [];
  return items
    .filter(
      (i) =>
        i.requiredLevel <= level &&
        (type.caps[i.consumption.carriedByCapability] ?? 0) >= i.consumption.minCapabilityValue,
    )
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((i) => ({
      code: i.code,
      capacity: capacityOf(i, type),
      missionNeed: i.consumption.missionNeed,
      averageUse: i.consumption.averageUsePerMission,
      loadSecondsPerUnit: i.consumption.loadSecondsPerUnit,
      affectedCapability: i.consumption.affectedCapability,
      missingMultiplier: i.consumption.missingMultiplier,
      autoRestock: i.consumption.autoRestockOnReturn,
    }));
}

/** Aircraft: minutes of flight (`enduranceMinutes`); the rest: km. `null` for a type without either (foot teams). */
export function fuelProfileOf(type: VehicleTypeLike | undefined): FuelProfile | null {
  if (!type) return null;
  if (type.movement === 'AIR') {
    const endurance = type.autonomy.enduranceMinutes ?? null;
    if (endurance === null || endurance <= 0) return null;
    return { unit: 'MIN', rangeKm: endurance, perMinuteOnScene: type.autonomy.fuelPerMinuteOnScene };
  }
  const range = type.autonomy.fuelRangeKm ?? null;
  if (range === null || range <= 0) return null;
  return { unit: 'KM', rangeKm: range, perMinuteOnScene: type.autonomy.fuelPerMinuteOnScene };
}

export function profileOf(
  type: VehicleTypeLike | undefined,
  items: readonly MockItemType[],
  level: number,
  knobs: AutonomyKnobs,
  gates: AutonomyGates,
): AutonomyProfile {
  const stockUnlocked = gates.stock && level >= knobs.stockFromLevel;
  const fuelUnlocked = gates.fuel && level >= knobs.fuelFromLevel;
  return {
    stockUnlocked,
    fuelUnlocked,
    items: stockUnlocked && type ? carriedItemsOf(type, items, level, knobs) : [],
    fuel: fuelUnlocked ? fuelProfileOf(type) : null,
  };
}

/* ───────────── state readers ───────────── */

export const quantityOf = (item: CarriedItem, state: AutonomyState): number =>
  clamp(Math.round(state.stock[item.code] ?? item.capacity), 0, item.capacity);
export const fuelKmOf = (fuel: FuelProfile, state: AutonomyState): number =>
  fuel.rangeKm * clamp(state.fuelRatio, 0, 1);

/** "Under 35 % of its capacity or under one mission's need" (never above the capacity itself). */
export function itemThreshold(item: CarriedItem, knobs: Pick<AutonomyKnobs, 'itemResupplyRatio'>): number {
  return Math.min(item.capacity, Math.max(knobs.itemResupplyRatio * item.capacity, item.missionNeed));
}

/** Fuel of one average mission: out with sirens, back without, plus the average time on scene. */
export function averageMissionFuelKm(
  fuel: FuelProfile,
  knobs: Pick<AutonomyKnobs, 'averageMissionKm' | 'averageOnSceneMinutes' | 'fuelConditions'> &
    Partial<Pick<AutonomyKnobs, 'flight'>>,
): number {
  if (fuel.unit === 'MIN' && knobs.flight)
    return 2 * knobs.flight.averageLegMinutes + knobs.flight.averageOnSceneMinutes * fuel.perMinuteOnScene;
  return (
    (knobs.averageMissionKm * (1 + knobs.fuelConditions.siren)) / 2 +
    knobs.averageOnSceneMinutes * fuel.perMinuteOnScene
  );
}

/** "Under 25 % of the range or under one average mission". */
export function fuelThresholdKm(fuel: FuelProfile, knobs: AutonomyKnobs): number {
  return Math.min(
    fuel.rangeKm,
    Math.max(knobs.fuelResupplyRatio * fuel.rangeKm, averageMissionFuelKm(fuel, knobs)),
  );
}

export interface ResupplyNeed {
  lowItems: string[];
  fuelLow: boolean;
  low: boolean;
}

export function resupplyNeed(
  profile: AutonomyProfile,
  state: AutonomyState,
  knobs: AutonomyKnobs,
): ResupplyNeed {
  const lowItems = profile.items
    .filter((item) => quantityOf(item, state) < itemThreshold(item, knobs))
    .map((item) => item.code);
  const fuelLow =
    profile.fuel !== null && fuelKmOf(profile.fuel, state) < fuelThresholdKm(profile.fuel, knobs) - 1e-9;
  return { lowItems, fuelLow, low: lowItems.length > 0 || fuelLow };
}

/* ───────────── THE single resupply rule ───────────── */

export interface ResupplyLoad {
  itemCode: string;
  units: number;
}

export interface ResupplyPlan {
  loads: ResupplyLoad[];
  fuelKm: number;
  /** Game seconds of the stop. */
  seconds: number;
  /** `ITEM:<code>`, `FUEL`, `MANUAL`, `TRIP`. */
  reasons: string[];
}

export interface ResupplyOptions {
  forced?: boolean;
  forcedReason?: 'MANUAL' | 'TRIP';
  storageLevel?: number;
}

/**
 * THE resupply rule: a stop happens when an item is under its threshold AND the facility shelf can refill it, or the fuel
 * is under its threshold (fuel at base is always available). The stop reloads everything it can. `null` = no stop.
 */
export function resupplyDecision(
  profile: AutonomyProfile,
  state: AutonomyState,
  shelf: Readonly<Record<string, number>>,
  knobs: AutonomyKnobs,
  options: ResupplyOptions = {},
): ResupplyPlan | null {
  const need = resupplyNeed(profile, state, knobs);
  const byCode = new Map(profile.items.map((item) => [item.code, item]));
  const fixable = need.lowItems.filter(
    (code) => (byCode.get(code)?.autoRestock || options.forced) && (shelf[code] ?? 0) > 0,
  );
  if (!options.forced && fixable.length === 0 && !need.fuelLow) return null;
  const loads = profile.items
    .filter((item) => item.autoRestock || options.forced)
    .map((item) => ({
      itemCode: item.code,
      units: Math.max(
        0,
        Math.min(item.capacity - quantityOf(item, state), Math.floor(shelf[item.code] ?? 0)),
      ),
    }))
    .filter((load) => load.units > 0);
  const fuelKm = profile.fuel ? Math.max(0, profile.fuel.rangeKm - fuelKmOf(profile.fuel, state)) : 0;
  if (loads.length === 0 && fuelKm < 0.05) return null;
  const reasons = [
    ...fixable.map((code) => `ITEM:${code}`),
    ...(need.fuelLow ? ['FUEL'] : []),
    ...(options.forced ? [options.forcedReason ?? 'MANUAL'] : []),
  ];
  return {
    loads,
    fuelKm: round1(fuelKm),
    seconds: resupplySeconds(profile, loads, fuelKm, knobs, options.storageLevel ?? 0),
    reasons,
  };
}

/** Duration of a stop: base + Σ units × load time + km × s/km, capped, minus the STORAGE bonus. */
export function resupplySeconds(
  profile: AutonomyProfile,
  loads: readonly ResupplyLoad[],
  fuelKm: number,
  knobs: AutonomyKnobs,
  storageLevel: number,
): number {
  const r = knobs.resupply;
  const perItem = loads.reduce(
    (sum, load) =>
      sum + load.units * (profile.items.find((i) => i.code === load.itemCode)?.loadSecondsPerUnit ?? 0),
    0,
  );
  // An aircraft refuels at its own base by the minute of flight put back (`flight.refuelSecondsPerMinute`).
  const perFuelUnit =
    profile.fuel?.unit === 'MIN' ? (knobs.flight?.refuelSecondsPerMinute ?? 3) : r.secondsPerFuelKm;
  const raw = Math.min(r.maxSeconds, r.baseSeconds + perItem + fuelKm * perFuelUnit);
  const bonus = Math.min(r.maxStorageSpeedBonus, Math.max(0, storageLevel) * r.storageSpeedBonusPerLevel);
  return Math.max(1, Math.round(raw * (1 - bonus)));
}

/** State after a stop: every load on board, full tank. */
export function afterResupply(
  profile: AutonomyProfile,
  state: AutonomyState,
  plan: Pick<ResupplyPlan, 'loads'>,
): AutonomyState {
  const stock = { ...state.stock };
  for (const item of profile.items)
    stock[item.code] =
      quantityOf(item, state) + (plan.loads.find((l) => l.itemCode === item.code)?.units ?? 0);
  return { stock, fuelRatio: profile.fuel ? 1 : state.fuelRatio };
}

/** Average missions left before the rule stops the vehicle (min over fuel and items); `null` = nothing tracked. */
export function missionsLeftEstimate(
  profile: AutonomyProfile,
  state: AutonomyState,
  knobs: AutonomyKnobs,
): number | null {
  const counts: number[] = [];
  for (const item of profile.items) {
    const q = quantityOf(item, state);
    const t = itemThreshold(item, knobs);
    counts.push(q < t ? 0 : Math.floor((q - t) / Math.max(0.05, item.averageUse)) + 1);
  }
  if (profile.fuel) {
    const km = fuelKmOf(profile.fuel, state);
    const t = fuelThresholdKm(profile.fuel, knobs);
    counts.push(
      km < t ? 0 : Math.floor((km - t) / Math.max(0.1, averageMissionFuelKm(profile.fuel, knobs))) + 1,
    );
  }
  return counts.length === 0 ? null : Math.min(...counts);
}

/** The DTO the backend's view enricher serves on every vehicle (`VehicleDto.autonomy`). */
export function autonomySnapshot(
  profile: AutonomyProfile,
  state: AutonomyState,
  shelf: Readonly<Record<string, number>>,
  knobs: AutonomyKnobs,
  resupplyRequested: boolean,
): VehicleAutonomyDto {
  const fuel = profile.fuel;
  const km = fuel ? fuelKmOf(fuel, state) : 0;
  return {
    unlocked: { stock: profile.stockUnlocked, fuel: profile.fuelUnlocked },
    fuel: fuel
      ? {
          km: round1(km),
          rangeKm: fuel.rangeKm,
          ratio: Math.round((km / fuel.rangeKm) * 1000) / 1000,
          reserve: km < knobs.fuelReserveRatio * fuel.rangeKm,
          low: km < fuelThresholdKm(fuel, knobs),
          ...(fuel.unit === 'MIN' ? { unit: 'MIN' as const } : {}),
        }
      : null,
    items: profile.items.map((item) => {
      const quantity = quantityOf(item, state);
      return {
        itemCode: item.code,
        quantity,
        capacity: item.capacity,
        low: quantity < itemThreshold(item, knobs),
      };
    }),
    missionsLeftEstimate: missionsLeftEstimate(profile, state, knobs),
    needsResupply: resupplyDecision(profile, state, shelf, knobs) !== null,
    resupplyRequested,
  };
}

/* ───────────── consumption multipliers ───────────── */

export interface ItemConditions {
  night: boolean;
  weather: string | null;
  /** Mean REQUIRED coverage over the time on scene, null when nobody worked there. */
  meanCoverage: number | null;
}

/** Night ×1.2 · extreme heat ×1.15 · adverse weather ×1.1–1.25 · long intervention for low coverage ×1.1–1.3, capped. */
export function itemConditionMultiplier(
  ctx: ItemConditions,
  knobs: Pick<AutonomyKnobs, 'itemConditions'>,
): number {
  const k = knobs.itemConditions;
  let multiplier = (ctx.night ? k.night : 1) * (ctx.weather ? (k.weather[ctx.weather] ?? 1) : 1);
  if (ctx.meanCoverage !== null && ctx.meanCoverage < 1) {
    const depth = clamp((1 - ctx.meanCoverage) / 0.75, 0, 1);
    multiplier *= k.lowCoverage[0] + (k.lowCoverage[1] - k.lowCoverage[0]) * depth;
  }
  return Math.min(k.cap, multiplier);
}

/** Template needs × multiplier, rounded per item (quantities stay whole units). */
export function scaleNeeds(
  needs: Readonly<Record<string, number>>,
  multiplier: number,
): Record<string, number> {
  const scaled: Record<string, number> = {};
  for (const [code, need] of Object.entries(needs)) {
    const value = Math.round(need * multiplier);
    if (value > 0) scaled[code] = value;
  }
  return scaled;
}

/** A partial consumption share (FAILED / EXPIRED / left early), never rounded away to nothing. */
export function partialUnits(need: number, share: number, carriers: number): number {
  if (need <= 0 || share <= 0) return 0;
  return Math.max(1, Math.round((need * share) / Math.max(1, carriers)));
}

export interface FuelEnvironment {
  snow: boolean;
  offroad: boolean;
}

export function fuelEnvironmentOf(input: {
  terrain: string | null;
  category: string | null;
  weather: string | null;
}): FuelEnvironment {
  return {
    snow: input.weather === 'SNOW' || input.terrain === 'SNOW',
    offroad: input.terrain === 'OFFROAD' || input.terrain === 'MOUNTAIN' || input.category === 'WILDFIRE',
  };
}

export function fuelEnvironmentMultiplier(
  env: FuelEnvironment,
  knobs: Pick<AutonomyKnobs, 'fuelConditions'>,
): number {
  return (env.snow ? knobs.fuelConditions.snow : 1) * (env.offroad ? knobs.fuelConditions.offroad : 1);
}

export interface FuelLegs {
  /** Driven with sirens: the outbound leg and the hospital transport. */
  sirenMeters: number;
  /** Driven without: return, a detour to a fuel station. */
  plainMeters: number;
  /** Game minutes on scene. */
  onSceneMinutes: number;
}

export function legsFuelKm(
  legs: FuelLegs,
  fuel: FuelProfile,
  env: FuelEnvironment,
  knobs: Pick<AutonomyKnobs, 'fuelConditions'>,
): number {
  const km =
    (Math.max(0, legs.sirenMeters) * knobs.fuelConditions.siren + Math.max(0, legs.plainMeters)) / 1000;
  return (
    km * fuelEnvironmentMultiplier(env, knobs) + Math.max(0, legs.onSceneMinutes) * fuel.perMinuteOnScene
  );
}

/** Fuel a trip to an incident needs: there with sirens, back without, plus the on-scene estimate. */
export function tripFuelKm(
  outboundMeters: number,
  returnMeters: number,
  onSceneMinutes: number,
  fuel: FuelProfile,
  env: FuelEnvironment,
  knobs: Pick<AutonomyKnobs, 'fuelConditions'>,
): number {
  return legsFuelKm(
    { sirenMeters: outboundMeters, plainMeters: returnMeters, onSceneMinutes },
    fuel,
    env,
    knobs,
  );
}

/** State after burning `km` (never below an empty tank: a vehicle never stops on the road, D-31). */
export function afterFuel(fuel: FuelProfile, state: AutonomyState, km: number): AutonomyState {
  return { ...state, fuelRatio: clamp(state.fuelRatio - Math.max(0, km) / fuel.rangeKm, 0, 1) };
}

/** Premium of a fuel-station refill: share × refilled km × the vehicle's costPerKm, whole credits. */
export function fuelStationPremium(
  refilledKm: number,
  costPerKm: number,
  knobs: Pick<AutonomyKnobs, 'fuelStations'>,
): number {
  return Math.max(
    0,
    Math.round(knobs.fuelStations.premiumShare * Math.max(0, refilledKm) * Math.max(0, costPerKm)),
  );
}

/* ───────────── flight endurance (phase 3, the backend's autonomy.math.ts flight functions) ───────────── */

/**
 * Taxi + take-off of an aircraft before its flight leg, REAL minutes (the backend's `depth.airOps` defaults: a helicopter
 * 200 m at 25 km/h + 40 s ≈ 1.15 min, the plane 800 m + 40 s ≈ 2.59 min). The mock has no taxi phase: added to the outbound.
 */
export const TAKEOFF_MINUTES: Record<'HELICOPTER' | 'AIRPLANE', number> = {
  HELICOPTER: 1.15,
  AIRPLANE: 2.59,
};
export const takeoffMinutesOf = (mobilityProfile: string | undefined): number =>
  mobilityProfile === 'AIRPLANE' ? TAKEOFF_MINUTES.AIRPLANE : TAKEOFF_MINUTES.HELICOPTER;

/** Minutes of a straight flight: distance / air speed × the travel compression (0.25, D-63) — REAL minutes. */
export function flightMinutes(meters: number, airSpeedKmh: number, travelCompression = 0.25): number {
  if (meters <= 0 || airSpeedKmh <= 0) return 0;
  return ((meters / ((airSpeedKmh * 1000) / 3600)) * travelCompression) / 60;
}

/** The reserve an aircraft never flies into (`fuelReserveRatio` × endurance). */
export const reserveOf = (
  fuel: Pick<FuelProfile, 'rangeKm'>,
  knobs: Pick<AutonomyKnobs, 'fuelReserveRatio'>,
) => knobs.fuelReserveRatio * fuel.rangeKm;

export interface FlightTrip {
  /** Taxi + take-off + the flight to the scene. */
  outboundMinutes: number;
  /** The flight home from the scene. */
  backMinutes: number;
}
export interface FlightNeeds {
  /** There and back with the reserve intact: below it the aircraft cannot be sent at all (ENDURANCE_INSUFFICIENT). */
  reachAndReturn: number;
  /** + the minimal time over the scene: below it the option is flagged (FUEL_RANGE_INSUFFICIENT), still selectable. */
  minimum: number;
  /** + the expected time over the scene (capped at a full tank): what a refuel before departure tops up to. */
  expected: number;
}

export function flightNeeds(
  trip: FlightTrip,
  fuel: FuelProfile,
  knobs: Pick<AutonomyKnobs, 'fuelReserveRatio' | 'flight'>,
  expectedOnSceneMinutes: number,
): FlightNeeds {
  const legs = Math.max(0, trip.outboundMinutes) + Math.max(0, trip.backMinutes);
  const reserve = reserveOf(fuel, knobs);
  const rate = Math.max(0, fuel.perMinuteOnScene);
  return {
    reachAndReturn: legs + reserve,
    minimum: legs + knobs.flight.minOnSceneMinutes * rate + reserve,
    expected: Math.min(fuel.rangeKm, legs + Math.max(0, expectedOnSceneMinutes) * rate + reserve),
  };
}

/** Minutes an aircraft can stay over the scene with `leftMinutes` on arrival before it must turn back ("bingo"). */
export function onSceneEnduranceMinutes(
  leftMinutes: number,
  homeMinutes: number,
  fuel: FuelProfile,
  knobs: Pick<AutonomyKnobs, 'fuelReserveRatio'>,
): number | null {
  if (fuel.perMinuteOnScene <= 0) return null;
  return Math.max(0, leftMinutes - Math.max(0, homeMinutes) - reserveOf(fuel, knobs)) / fuel.perMinuteOnScene;
}
