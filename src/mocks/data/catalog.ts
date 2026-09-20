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
  capabilities: { code: string; group: string; icon: string }[];
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
  };
}
export const RAW = generated as unknown as Raw;
export const CATALOG_VERSION = RAW.version;
export const CATALOG_I18N_HASH = RAW.i18nHash;

export interface MockVehicleType {
  code: string;
  family: ServiceFamily;
  domain: 'GROUND' | 'AIR' | 'WATER';
  movement: 'ROAD' | 'ROAD_TRAILER' | 'AIR';
  airSpeedKmh: number | null;
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
}
/** 41 managed vehicle types. */
export const VEHICLE_TYPES: MockVehicleType[] = RAW.vehicleTypes.map((v) => ({
  code: v.code,
  family: v.family,
  domain: v.domain,
  movement: v.movement,
  airSpeedKmh: v.airSpeedKmh,
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
}));

export const CAPABILITIES = RAW.capabilities;

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
