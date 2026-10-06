import type { FacilityFamily, ServiceFamily } from '@/contracts';
import generated from './generated/catalog.json';

/**
 * Adapter over the bundled copy of the real game catalog (`pnpm gen:mock-catalog`, source:
 * ../rescue-control-backend/catalog). Codes, icon keys, i18n keys, prices, levels, capabilities and requirements are
 * the real ones; only TIME is compressed so the standalone demo stays snappy:
 *  - managerial timers (delivery, construction, courses, onboarding, maintenance, supplies, external units) × MANAGERIAL_SCALE
 *  - on-scene work: workUnits × WORK_SCALE, clamped.
 */
export const MANAGERIAL_SCALE = 0.1;
const WORK_SCALE = 0.04;
const managerial = (seconds: number) => Math.max(10, Math.round(seconds * MANAGERIAL_SCALE));

type Level = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
interface RawBand {
  severity: [number, number];
  minLevel?: number;
  requirements: { capability: string; level: Level; threshold: number; family: ServiceFamily }[];
  workUnits: number;
  patients?: {
    count: { n: number; weight: number }[];
    profiles: { profile: string; weight: number }[];
  };
  ung?: { type: string; probability: number }[];
}
interface Raw {
  version: string;
  i18nHash: string;
  families: {
    code: ServiceFamily;
    color: string;
    icon: string;
    playerManaged: boolean;
    requiredLevel: number;
    territoryUnlock: unknown;
  }[];
  capabilities: { code: string; group: string; icon: string; shoreSide: boolean }[];
  vehicleTypes: {
    code: string;
    family: ServiceFamily;
    domain: 'GROUND' | 'AIR' | 'WATER';
    capabilities: Record<string, number>;
    tags: string[];
    price: number;
    requiredLevel: number;
    capacityPoints: number;
    crew: {
      min: number;
      optimal: number;
      requiredRoles?: { role: string; count: number }[];
      requiredQualifications?: { qualification: string; count: number }[];
    };
    speedFactor: number;
    sirenFactor: number;
    airSpeedKmh: number | null;
    /** Boats (water scene, D-68): cruise speed on the water, km/h; null for every other vehicle. */
    waterSpeedKmh: number | null;
    preparationSeconds: number;
    deliverySeconds: number;
    patientCapacity: number;
    baseFailureRate: number;
    maintenance: {
      intervalKm: number;
      intervalMissions: number;
      routineCost: number;
      routineSeconds: number;
      wearPerKm: number;
      wearPerMission: number;
    };
    compatibleFacilityTypes: string[];
    icon: string;
    movement: 'ROAD' | 'ROAD_TRAILER' | 'AIR';
    mobilityProfile: string;
    costPerKm: number;
    /** Resolved by `gen:mock-catalog` like the backend loader: own range, else the mobility profile's (null = no fuel). */
    autonomy: RawVehicleAutonomy;
  }[];
  facilityTypes: {
    code: string;
    family: FacilityFamily;
    chain: string;
    tier: number;
    domains: ('GROUND' | 'AIR' | 'WATER')[];
    baseCapacity: Record<string, number>;
    upgradeCaps: Record<string, number>;
    price: number;
    requiredLevel: number;
    setupSeconds: number;
    promotion: {
      to: string;
      cost: number;
      buildSeconds: number;
      requiredUpgradeLevels: Record<string, number>;
    } | null;
    effects: Record<string, unknown>[];
    icon: string;
  }[];
  upgrades: {
    code: string;
    capacityKind: string | null;
    capacityPerLevel: number;
    requiredLevel: number;
    baseCost: number;
    costGrowth: number;
    baseBuildSeconds: number;
    buildGrowth: number;
    maxLevel: number;
    icon: string;
  }[];
  ungUnitTypes: {
    code: string;
    icon: string;
    arrival: { baseSeconds: number; spreadSeconds: number };
    work: { minSeconds: number; maxSeconds: number };
    keepsRoadClosed: boolean;
  }[];
  itemTypes: {
    code: string;
    family: ServiceFamily;
    requiredLevel: number;
    unitPrice: number;
    packSize: number;
    deliverySeconds: number;
    starterStock: number;
    lowStockThreshold: number;
    icon: string;
    consumption: RawItemConsumption;
  }[];
  roles: {
    code: string;
    family: ServiceFamily | 'SHARED';
    specialist: boolean;
    requiredLevel: number;
    hireCost: number;
    costPerPeriod: number;
    onboardingSeconds: number;
    startingQualifications: string[];
    quickHire: boolean;
    icon: string;
  }[];
  qualifications: { code: string; families: string[]; roles: string[]; tier: string; icon: string }[];
  courses: {
    code: string;
    grants: string;
    tier: string;
    durationSeconds: number;
    cost: number;
    requiredLevel: number;
    prerequisites: { qualifications: string[]; roles: string[]; trainingRoomLevel: number };
  }[];
  patientProfiles: {
    code: string;
    category: string;
    triage: string;
    stability: {
      initialMin: number;
      initialMax: number;
      decayPerMinuteUntreated: number;
      decayPerMinuteTreated: number;
      decayPerMinuteInTransport: number;
    };
    treatment: { capability: string; level: Level; threshold: number }[];
    transport: { probability: number };
    hospital: { required: string; preferred: string | null };
  }[];
  hospitalCapabilities: { code: string; icon: string }[];
  incidentTemplates: {
    code: string;
    category: string;
    group: string;
    primaryFamily: ServiceFamily;
    families: ServiceFamily[];
    requiredLevel: number;
    tutorial: boolean;
    rarity: string | null;
    weight: number;
    expirySeconds: number;
    reward: { baseCredits: number; baseXp: number; complexity: number };
    consumables?: { item: string; base: number; perSeverity: number }[];
    icon: string;
    severity: { min: number; max: number; distribution: Record<string, number> };
    /** `placement: WATER_EDGE` = a water template: it spawns on the water bodies listed in `water.bodies` only. */
    location: { placement: string; water: { bodies: WaterBodyType[]; urban: string } | null } | null;
    bands: RawBand[];
  }[];
  maxLevel: number;
  ranks: { code: string; fromLevel: number; toLevel: number }[];
  levels: {
    level: number;
    xpToNext: number;
    cumulativeXp: number;
    stipendBase: number;
    levelUpCredits: number;
    maxActiveIncidents: number;
  }[];
  features: { feature: string; requiredLevel: number }[];
  milestones: {
    code: string;
    order: number;
    phase: string;
    trigger: { type: string; count?: number; level?: number; family?: string };
    rewardCredits: number;
    rewardXp: number;
  }[];
  starterPackage: {
    credits: number;
    personnel: { role: string; count: number; qualifications: string[] }[];
    tutorial: { incidentTemplate: string; severity: number; completionCredits: number; completionXp: number };
  };
  economy: {
    startingCredits: number;
    stipend: {
      periodSeconds: number;
      offlineCapPeriods: number;
      coverageSteps: { below: number; factor: number }[];
      reputationFactor: { atZero: number; atHundred: number };
      coverageThresholdMinutes: Record<string, number>;
      familyWeights: Record<string, number>;
    };
    creditPackages: { code: string; priceEurCents: number; credits: number; order: number }[];
    rewardedAds: { credits: number; dailyLimit: number; cooldownSeconds: number };
    referral: {
      inviterBonus: number;
      inviteeBonus: number;
      requiredActivatedReferrals: number;
      activation: { resolvedIncidents: number; distinctDays: number };
    };
    speedup: { creditsPerMinute: Record<string, number>; minimumCost: number; freeBelowSeconds: number };
    maintenance: {
      healthBands: { band: string; from: number }[];
      routineHealthRestore: number;
      repair: { costShareOfPrice: number; seconds: number; healthAfter: number };
      recovery: { cost: number; baseSeconds: number };
      emergencyFreeRepair: { balanceBelow: number; secondsMultiplier: number };
    };
    medical: { hospitalHandoffSeconds: number };
    autonomy: AutonomyKnobs;
    /** `economy.yaml → resolution`: only the per-dispatch limit of a normal call is read by the mock. */
    resolution: { maxVehiclesPerDispatch: number };
  };
  /** `major-incidents.yaml` (D-24 / D-69): the generator settings and the scenarios. */
  majorIncidents: { settings: MajorSettings; scenarios: MajorScenario[] };
}

/** `vehicleTypes[].autonomy` (D-22): tank in game km, km burnt per real minute of pump/ladder work, capacity overrides. */
export interface RawVehicleAutonomy {
  fuelRangeKm: number | null;
  /** Aircraft (flight endurance, phase 3): a full tank in REAL minutes of flight; null for every other vehicle. */
  enduranceMinutes?: number | null;
  fuelPerMinuteOnScene: number;
  onboardCapacity: Record<string, number>;
}
/** `itemTypes[].consumption` (D-22): what a vehicle carries on board and when the single resupply rule reloads it. */
export interface RawItemConsumption {
  carriedByCapability: string;
  minCapabilityValue: number;
  onboardCapacity: number;
  missionNeed: number;
  averageUsePerMission: number;
  loadSecondsPerUnit: number;
  affectedCapability: string;
  missingMultiplier: number;
  autoRestockOnReturn: boolean;
}
/** `economy.yaml → autonomy` (the backend's `config.depth.autonomy`): thresholds, multipliers, stop timing, fuel stations. */
export interface AutonomyKnobs {
  stockFromLevel: number;
  fuelFromLevel: number;
  itemResupplyRatio: number;
  fuelResupplyRatio: number;
  fuelReserveRatio: number;
  averageMissionKm: number;
  averageOnSceneMinutes: number;
  partialConsumptionShare: number;
  itemConditions: {
    night: number;
    weather: Record<string, number>;
    lowCoverage: [number, number];
    cap: number;
  };
  fuelConditions: { siren: number; snow: number; offroad: number };
  resupply: {
    baseSeconds: number;
    secondsPerFuelKm: number;
    maxSeconds: number;
    storageSpeedBonusPerLevel: number;
    maxStorageSpeedBonus: number;
  };
  fuelStations: {
    enabled: boolean;
    searchRadiusKm: number;
    stopSeconds: number;
    premiumShare: number;
    farReturnKm: number;
  };
  /** Phase 3 — flight endurance of helicopters and the AIB plane (REAL minutes of flight, air-endurance.md). */
  flight: {
    averageLegMinutes: number;
    averageOnSceneMinutes: number;
    minOnSceneMinutes: number;
    perScoopMinutes: number;
    refuelSecondsPerMinute: number;
    resumeAfterRefuel: boolean;
  };
}
/** `major-incidents.yaml → settings` (the backend's `config.majorIncidents`). Durations are REAL seconds / minutes. */
export interface MajorSettings {
  minLevel: number;
  intervalMinutes: [number, number];
  firstIntervalMinutes: [number, number];
  checkIntervalSeconds: number;
  minOperationalVehicles: number;
  sizing: {
    fleetShare: [number, number];
    minVehicles: number;
    maxVehicles: number;
    mainShare: number;
    maxScale: number;
    workScaleExponent: number;
    boostedBandChance: number;
    phaseShares: Record<'ALARM' | 'CONTAINMENT' | 'RESCUE' | 'SECURING', number>;
    maxSubsPerPhase: number;
    subDistanceShare: [number, number];
  };
  phases: {
    containmentAfterSeconds: number;
    rescueFromProgress: number;
    securingFromProgress: number;
    tickMaxSeconds: number;
  };
  growth: {
    firstCheckSeconds: number;
    everySeconds: number;
    coverageBelow: number;
    maxLevel: number;
    radiusStep: number;
  };
  incidents: { mainExpiryMultiplier: number; subExpiryMultiplier: number };
  spawnSlowdown: number;
  maxVehiclesPerDispatch: number;
  reinforcements: {
    arrival: {
      baseSeconds: number;
      spreadSeconds: number;
      nightMultiplier: number;
      weather: Record<string, number>;
    };
    priorityArrivalMultiplier: number;
    rewardPenalty: number;
    minGapShare: number;
  };
  reward: {
    sizeExponent: number;
    credits: { base: number; perLevel: number };
    xp: { base: number; perLevel: number };
    weights: { coverage: number; timeliness: number; subIncidents: number };
    responseTargetSeconds: number;
    successFrom: number;
    goldFrom: number;
    failureShare: number;
    reputation: { successWeight: number; partialWeight: number; failureWeight: number };
  };
}
export interface MajorScenario {
  code: string;
  primaryFamily: ServiceFamily;
  mainTemplates: { template: string; fromLevel: number }[];
  weight: number;
  conditions: Partial<
    Record<'weather' | 'season' | 'hourBand' | 'weekday' | 'dayPhase', Record<string, number>>
  >;
  onlyWhen: { weather?: string[]; events?: string[]; minTemperatureC?: number } | null;
  phases: Partial<
    Record<'ALARM' | 'CONTAINMENT' | 'RESCUE' | 'SECURING', { template: string; weight: number }[]>
  >;
  growth: { template: string; weight: number }[];
  areaRadiusMeters: number;
  icon: string;
  /** Alliance-scale scenario (operations, 07 §6): never drawn as a personal major. */
  alliance: { durationMinutes: number } | null;
}
/** Water body kinds of the geodata (sea, lake / reservoir, river / canal). */
export type WaterBodyType = 'SEA' | 'LAKE' | 'RIVER';
export const RAW = generated as unknown as Raw;
export const CATALOG_VERSION = RAW.version;
export const CATALOG_I18N_HASH = RAW.i18nHash;

export interface MockVehicleType {
  code: string;
  family: ServiceFamily;
  domain: 'GROUND' | 'AIR' | 'WATER';
  movement: 'ROAD' | 'ROAD_TRAILER' | 'AIR';
  airSpeedKmh: number | null;
  /** Boats: km/h on the water (straight water legs, D-68). */
  waterSpeedKmh: number | null;
  price: number;
  requiredLevel: number;
  capacityPoints: number;
  crewMin: number;
  crewOptimal: number;
  requiredRoles: { role: string; count: number }[];
  requiredQualifications: { qualification: string; count: number }[];
  speedFactor: number;
  sirenFactor: number;
  preparationSeconds: number;
  deliverySeconds: number;
  patientCapacity: number;
  baseFailureRate: number;
  maintenance: Raw['vehicleTypes'][number]['maintenance'];
  compatibleFacilityTypes: string[];
  tags: string[];
  caps: Record<string, number>;
  icon: string;
  costPerKm: number;
  autonomy: RawVehicleAutonomy;
  /** `ROAD_HEAVY`, `HELICOPTER`, `AIRPLANE`… (the take-off of an aircraft depends on it). */
  mobilityProfile: string;
}
/** 45 managed vehicle types. */
export const VEHICLE_TYPES: MockVehicleType[] = RAW.vehicleTypes.map((v) => ({
  code: v.code,
  family: v.family,
  domain: v.domain,
  movement: v.movement,
  airSpeedKmh: v.airSpeedKmh,
  waterSpeedKmh: v.waterSpeedKmh ?? null,
  price: v.price,
  requiredLevel: v.requiredLevel,
  capacityPoints: v.capacityPoints,
  crewMin: v.crew.min,
  crewOptimal: v.crew.optimal,
  requiredRoles: v.crew.requiredRoles ?? [],
  requiredQualifications: v.crew.requiredQualifications ?? [],
  speedFactor: v.speedFactor,
  sirenFactor: v.sirenFactor,
  preparationSeconds: Math.max(8, Math.round(v.preparationSeconds * 0.2)),
  deliverySeconds: managerial(v.deliverySeconds),
  patientCapacity: v.patientCapacity,
  baseFailureRate: v.baseFailureRate,
  maintenance: { ...v.maintenance, routineSeconds: managerial(v.maintenance.routineSeconds) },
  compatibleFacilityTypes: v.compatibleFacilityTypes,
  tags: v.tags,
  caps: v.capabilities,
  icon: v.icon,
  costPerKm: v.costPerKm ?? 0,
  autonomy: v.autonomy ?? { fuelRangeKm: null, fuelPerMinuteOnScene: 0, onboardCapacity: {} },
  mobilityProfile: v.mobilityProfile,
}));

export const CAPABILITIES = RAW.capabilities;
/** Capabilities a land unit delivers from the meeting point of a water incident (catalog `shoreSide`, D-68). */
export const SHORE_CAPABILITIES: ReadonlySet<string> = new Set(
  CAPABILITIES.filter((c) => c.shoreSide).map((c) => c.code),
);

export const FAMILIES = RAW.families.map((f) => ({
  code: f.code,
  color: f.color,
  icon: f.icon,
  playerManaged: f.playerManaged,
  requiredLevel: f.requiredLevel,
}));
/**
 * WILDFIRE / ALPINE open at 10 and 14 "according to the territory" (analisi/05 §4). Pescara is coastal with pine woods and no
 * high ground inside the municipality → WILDFIRE first. The catalog DTO carries the resolved level per career.
 */
export const resolvedFamilyLevel = (code: ServiceFamily): number =>
  code === 'WILDFIRE'
    ? 10
    : code === 'ALPINE'
      ? 14
      : (FAMILIES.find((f) => f.code === code)?.requiredLevel ?? 1);

export interface MockFacilityType {
  code: string;
  family: FacilityFamily;
  chain: string;
  tier: number;
  price: number;
  requiredLevel: number;
  domains: ('GROUND' | 'AIR' | 'WATER')[];
  baseCapacity: Record<string, number>;
  upgradeCaps: Record<string, number>;
  setupSeconds: number;
  promotion: {
    to: string;
    cost: number;
    buildSeconds: number;
    requiredUpgradeLevels: Record<string, number>;
  } | null;
  effects: Record<string, unknown>[];
  icon: string;
}
/** 20 facility types in 5 chains + the shared coordination centre. */
export const FACILITY_TYPES: MockFacilityType[] = RAW.facilityTypes.map((f) => ({
  ...f,
  setupSeconds: managerial(f.setupSeconds),
  promotion: f.promotion ? { ...f.promotion, buildSeconds: managerial(f.promotion.buildSeconds) } : null,
}));

export interface MockUpgradeType {
  code: string;
  domain: string;
  delta: number;
  basePrice: number;
  costGrowth: number;
  maxLevel: number;
  requiredLevel: number;
  buildSeconds: number;
  buildGrowth: number;
  icon: string;
}
export const UPGRADE_TYPES: MockUpgradeType[] = RAW.upgrades.map((u) => ({
  code: u.code,
  // TRAINING_ROOM adds training slots instead of capacity points.
  domain: u.capacityKind ?? 'TRAINING',
  delta: u.capacityKind ? u.capacityPerLevel : 2,
  basePrice: u.baseCost,
  costGrowth: u.costGrowth,
  maxLevel: u.maxLevel,
  requiredLevel: u.requiredLevel,
  buildSeconds: managerial(u.baseBuildSeconds),
  buildGrowth: u.buildGrowth,
  icon: u.icon,
}));
/** n-th upgrade price = base × growth^(n−1) (analisi/05 §6). */
export const upgradePrice = (u: MockUpgradeType, nextLevel: number): number =>
  Math.round(u.basePrice * u.costGrowth ** (nextLevel - 1));
export const upgradeBuildSeconds = (u: MockUpgradeType, nextLevel: number): number =>
  Math.round(u.buildSeconds * u.buildGrowth ** (nextLevel - 1));

export interface MockTemplateBand {
  severity: [number, number];
  minLevel: number;
  requirements: { capability: string; level: Level; threshold: number; family: ServiceFamily }[];
  workSeconds: number;
  patients: RawBand['patients'] | null;
  ung: { type: string; probability: number }[];
}
export interface MockIncidentTemplate {
  code: string;
  category: string;
  group: string;
  primaryFamily: ServiceFamily;
  families: ServiceFamily[];
  minLevel: number;
  tutorial: boolean;
  rarity: string | null;
  weight: number;
  severity: [number, number];
  distribution: Record<string, number>;
  bands: MockTemplateBand[];
  baseReward: number;
  baseXp: number;
  complexity: number;
  consumables: { item: string; base: number; perSeverity: number }[];
  icon: string;
  /** Water templates (`placement: WATER_EDGE`): the water bodies they may spawn on; null for every land template. */
  water: { bodies: WaterBodyType[] } | null;
}
const RARITY_WEIGHT: Record<string, number> = { COMMON: 1, UNCOMMON: 0.45, RARE: 0.15, EPIC: 0.04 };
/** 45 incident templates (12 FIRE / 8 EMS / 8 POLICE / 5 WILDFIRE / 5 ALPINE / 7 multi-service). */
export const INCIDENT_TEMPLATES: MockIncidentTemplate[] = RAW.incidentTemplates.map((t) => ({
  code: t.code,
  category: t.category,
  group: t.group,
  primaryFamily: t.primaryFamily,
  families: t.families,
  minLevel: t.requiredLevel,
  tutorial: t.tutorial,
  rarity: t.rarity,
  weight: t.weight * (RARITY_WEIGHT[t.rarity ?? 'COMMON'] ?? 1),
  severity: [t.severity.min, t.severity.max],
  distribution: t.severity.distribution,
  bands: t.bands.map((b) => ({
    severity: b.severity,
    minLevel: b.minLevel ?? t.requiredLevel,
    requirements: b.requirements,
    workSeconds: Math.min(160, Math.max(25, Math.round(b.workUnits * WORK_SCALE))),
    patients: b.patients ?? null,
    ung: b.ung ?? [],
  })),
  baseReward: t.reward.baseCredits,
  baseXp: t.reward.baseXp,
  complexity: t.reward.complexity,
  consumables: t.consumables ?? [],
  icon: t.icon,
  water:
    t.location?.placement === 'WATER_EDGE'
      ? { bodies: t.location.water?.bodies ?? ['SEA', 'LAKE', 'RIVER'] }
      : null,
}));
export const TUTORIAL_TEMPLATE = RAW.starterPackage.tutorial.incidentTemplate;
export const bandFor = (t: MockIncidentTemplate, severity: number): MockTemplateBand =>
  t.bands.find((b) => severity >= b.severity[0] && severity <= b.severity[1]) ?? t.bands.at(-1)!;

export const UNG_TYPES = RAW.ungUnitTypes.map((u) => ({
  code: u.code,
  icon: u.icon,
  keepsRoadClosed: u.keepsRoadClosed,
  arrivalSeconds: managerial(u.arrival.baseSeconds),
  workSeconds: managerial((u.work.minSeconds + u.work.maxSeconds) / 2),
}));
export const ITEM_TYPES = RAW.itemTypes.map((i) => ({
  ...i,
  deliverySeconds: managerial(i.deliverySeconds),
}));
export const ROLES = RAW.roles.map((r) => ({ ...r, onboardingSeconds: managerial(r.onboardingSeconds) }));
export const QUALIFICATIONS = RAW.qualifications;
export const COURSES = RAW.courses.map((c) => ({ ...c, durationSeconds: managerial(c.durationSeconds) }));
export const PATIENT_PROFILES = RAW.patientProfiles;
export const MILESTONES = RAW.milestones;
export const FEATURES = RAW.features;
export const RANKS = RAW.ranks;
export const LEVELS = RAW.levels;
export const ECONOMY = RAW.economy;
/** Vehicle autonomy knobs (D-22 / D-67), the same numbers the backend's single resupply rule uses. */
export const AUTONOMY: AutonomyKnobs = RAW.economy.autonomy;
/** How many vehicles ONE dispatch command may send to a normal call (`resolution.maxVehiclesPerDispatch`, 12). */
export const MAX_VEHICLES_PER_DISPATCH = RAW.economy.resolution?.maxVehiclesPerDispatch ?? 12;
/** Major incidents (D-24 / D-69): the real generator settings and the 14 scenarios of the catalog. */
export const MAJOR_SETTINGS: MajorSettings = RAW.majorIncidents.settings;
export const MAJOR_SCENARIOS: MajorScenario[] = RAW.majorIncidents.scenarios;
export const PERSONNEL_PARAMS = RAW.starterPackage.personnel;

/** Cumulative XP required to REACH `level` (level 1 = 0) — table `levels.yaml`, never a formula in code. */
export function xpThreshold(level: number): number {
  const row = LEVELS.find((l) => l.level === level);
  if (row) return row.cumulativeXp;
  const last = LEVELS.at(-1)!;
  return last.cumulativeXp + last.xpToNext * Math.max(1, level - last.level);
}
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < RAW.maxLevel && xpThreshold(level + 1) <= xp) level++;
  return level;
}
export const levelRow = (level: number) => LEVELS.find((l) => l.level === level) ?? LEVELS.at(-1)!;
export const rankFor = (level: number) =>
  RANKS.find((r) => level >= r.fromLevel && level <= r.toLevel) ?? RANKS.at(-1)!;
