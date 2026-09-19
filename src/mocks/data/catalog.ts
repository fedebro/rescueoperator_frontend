import type { FacilityFamily, ServiceFamily } from '@/contracts';

type Caps = Record<string, number>;
export interface MockVehicleType {
  code: string;
  family: ServiceFamily;
  domain: 'GROUND' | 'AIR' | 'WATER';
  price: number;
  requiredLevel: number;
  capacityPoints: number;
  crewMin: number;
  crewOptimal: number;
  speedFactor: number;
  deliverySeconds: number;
  caps: Caps;
  icon: string;
}

const v = (
  code: string,
  family: ServiceFamily,
  icon: string,
  price: number,
  requiredLevel: number,
  caps: Caps,
  extra: Partial<MockVehicleType> = {},
): MockVehicleType => ({
  code,
  family,
  icon,
  price,
  requiredLevel,
  caps,
  domain: 'GROUND',
  capacityPoints: 2,
  crewMin: 2,
  crewOptimal: 3,
  speedFactor: 1,
  deliverySeconds: 90,
  ...extra,
});

/** 41 managed vehicle types (analisi/07). Numbers are mock balancing values. */
export const VEHICLE_TYPES: MockVehicleType[] = [
  v(
    'FIRE_APS',
    'FIRE',
    'engine',
    900,
    1,
    { FIRE_SUPPRESSION: 75, EXTRICATION: 70, TECHNICAL_RESCUE: 65, WATER_SUPPLY: 45 },
    { crewMin: 3, crewOptimal: 5 },
  ),
  v(
    'FIRE_4X4',
    'FIRE',
    'pickup',
    600,
    1,
    { FIRE_SUPPRESSION: 35, OFFROAD_ACCESS: 70, TECHNICAL_RESCUE: 30 },
    { capacityPoints: 1, speedFactor: 1.1, deliverySeconds: 60 },
  ),
  v('FIRE_ABP', 'FIRE', 'tanker', 1400, 2, { WATER_SUPPLY: 100, FIRE_SUPPRESSION: 40 }),
  v(
    'FIRE_AS',
    'FIRE',
    'ladder',
    3200,
    4,
    { HEIGHT_ACCESS: 100, FIRE_SUPPRESSION: 35 },
    { capacityPoints: 3 },
  ),
  v(
    'FIRE_AG',
    'FIRE',
    'crane',
    3800,
    5,
    { HEAVY_RESCUE: 90, EXTRICATION: 40 },
    { capacityPoints: 3, speedFactor: 0.85 },
  ),
  v('FIRE_SAF', 'FIRE', 'van', 2600, 5, { TECHNICAL_RESCUE: 100, WATER_RESCUE: 50, HEIGHT_ACCESS: 40 }),
  v('FIRE_FOAM', 'FIRE', 'tanker', 4200, 7, { FIRE_SUPPRESSION: 90, HAZMAT: 35 }, { capacityPoints: 3 }),
  v('FIRE_AIR', 'FIRE', 'truck', 2400, 6, { LOGISTICS: 80, FIRE_SUPPRESSION: 10 }),
  v('FIRE_NBCR', 'FIRE', 'truck', 6500, 9, { HAZMAT: 100, TECHNICAL_RESCUE: 30 }, { capacityPoints: 3 }),
  v(
    'FIRE_USAR',
    'FIRE',
    'truck',
    9000,
    12,
    { HEAVY_RESCUE: 100, TECHNICAL_RESCUE: 80, K9_SEARCH: 30 },
    { capacityPoints: 4, speedFactor: 0.85 },
  ),
  v('FIRE_DIVERS', 'FIRE', 'van', 5200, 10, { WATER_RESCUE: 100 }),
  v('FIRE_BOAT', 'FIRE', 'boat', 4800, 10, { WATER_RESCUE: 85 }, { domain: 'WATER', capacityPoints: 2 }),
  v('FIRE_UCL', 'FIRE', 'command', 5500, 11, { COMMAND: 100, LOGISTICS: 40 }),
  v(
    'FIRE_HELI',
    'FIRE',
    'helicopter',
    22000,
    18,
    { AIR_SUPPORT: 90, HEIGHT_ACCESS: 60, WATER_RESCUE: 50 },
    { domain: 'AIR', capacityPoints: 4, speedFactor: 3 },
  ),

  v(
    'EMS_MSB',
    'EMS',
    'ambulance',
    700,
    3,
    { MEDICAL_BASIC: 80, PATIENT_TRANSPORT: 100 },
    { crewMin: 2, crewOptimal: 3 },
  ),
  v('EMS_MSI', 'EMS', 'ambulance', 1500, 4, {
    MEDICAL_BASIC: 90,
    MEDICAL_ADVANCED: 50,
    PATIENT_TRANSPORT: 100,
  }),
  v('EMS_MSA', 'EMS', 'ambulance', 3000, 6, {
    MEDICAL_BASIC: 100,
    MEDICAL_ADVANCED: 100,
    PATIENT_TRANSPORT: 100,
  }),
  v(
    'EMS_AUTOMEDICA',
    'EMS',
    'car',
    2200,
    5,
    { MEDICAL_ADVANCED: 100, MEDICAL_BASIC: 60 },
    { capacityPoints: 1, speedFactor: 1.2 },
  ),
  v('EMS_PEDIATRIC', 'EMS', 'ambulance', 4200, 9, { MEDICAL_ADVANCED: 90, PATIENT_TRANSPORT: 100 }),
  v('EMS_MAXI', 'EMS', 'truck', 8000, 13, { MASS_CASUALTY: 100, LOGISTICS: 60 }, { capacityPoints: 4 }),
  v('EMS_PMA', 'EMS', 'truck', 9500, 15, { MASS_CASUALTY: 100, MEDICAL_ADVANCED: 80 }, { capacityPoints: 4 }),
  v(
    'EMS_HELI',
    'EMS',
    'helicopter',
    25000,
    17,
    { MEDICAL_ADVANCED: 100, PATIENT_TRANSPORT: 100, AIR_SUPPORT: 60 },
    { domain: 'AIR', capacityPoints: 4, speedFactor: 3 },
  ),

  v(
    'POL_PATROL',
    'POLICE',
    'car',
    650,
    6,
    { SCENE_SECURITY: 70, TRAFFIC_CONTROL: 50 },
    { capacityPoints: 1, speedFactor: 1.2 },
  ),
  v(
    'POL_MOTO',
    'POLICE',
    'motorcycle',
    500,
    6,
    { TRAFFIC_CONTROL: 70, SCENE_SECURITY: 30 },
    { capacityPoints: 1, crewMin: 1, crewOptimal: 1, speedFactor: 1.35 },
  ),
  v(
    'POL_TRAFFIC',
    'POLICE',
    'car',
    1200,
    7,
    { TRAFFIC_CONTROL: 100, INVESTIGATION: 40 },
    { capacityPoints: 1 },
  ),
  v('POL_VAN', 'POLICE', 'van', 2100, 8, { SCENE_SECURITY: 100 }),
  v('POL_K9', 'POLICE', 'van', 3000, 10, { K9_SEARCH: 100, SCENE_SECURITY: 40 }),
  v('POL_FORENSIC', 'POLICE', 'van', 3600, 11, { INVESTIGATION: 100 }),
  v('POL_EOD', 'POLICE', 'truck', 7500, 14, { EOD: 100, SCENE_SECURITY: 40 }, { capacityPoints: 3 }),
  v(
    'POL_TACTICAL',
    'POLICE',
    'truck',
    8500,
    15,
    { SCENE_SECURITY: 100, TECHNICAL_RESCUE: 30 },
    { capacityPoints: 3 },
  ),
  v(
    'POL_HELI',
    'POLICE',
    'helicopter',
    21000,
    19,
    { AIR_SUPPORT: 80, K9_SEARCH: 20, SCENE_SECURITY: 40 },
    { domain: 'AIR', capacityPoints: 4, speedFactor: 3 },
  ),

  v(
    'AIB_PICKUP',
    'WILDFIRE',
    'pickup',
    800,
    10,
    { WILDLAND_FIRE: 60, OFFROAD_ACCESS: 80 },
    { capacityPoints: 1 },
  ),
  v('AIB_TANKER', 'WILDFIRE', 'tanker', 2600, 11, {
    WILDLAND_FIRE: 90,
    WATER_SUPPLY: 80,
    OFFROAD_ACCESS: 50,
  }),
  v('AIB_COMMAND', 'WILDFIRE', 'command', 4800, 13, { COMMAND: 100 }),
  v(
    'AIB_HELI',
    'WILDFIRE',
    'helicopter',
    20000,
    16,
    { AIR_SUPPORT: 100, WILDLAND_FIRE: 80 },
    { domain: 'AIR', capacityPoints: 4, speedFactor: 3 },
  ),
  v(
    'AIB_PLANE',
    'WILDFIRE',
    'plane',
    25000,
    20,
    { AIR_SUPPORT: 100, WILDLAND_FIRE: 100 },
    { domain: 'AIR', capacityPoints: 6, speedFactor: 4 },
  ),

  v(
    'ALP_4X4',
    'ALPINE',
    'pickup',
    900,
    10,
    { MOUNTAIN_RESCUE: 60, OFFROAD_ACCESS: 90, MEDICAL_BASIC: 40 },
    { capacityPoints: 1 },
  ),
  v(
    'ALP_TEAM',
    'ALPINE',
    'team',
    700,
    10,
    { MOUNTAIN_RESCUE: 90, TECHNICAL_RESCUE: 50 },
    { capacityPoints: 1, speedFactor: 0.4, crewMin: 3, crewOptimal: 5 },
  ),
  v(
    'ALP_SNOW',
    'ALPINE',
    'snowmobile',
    1800,
    12,
    { MOUNTAIN_RESCUE: 70, OFFROAD_ACCESS: 100 },
    { capacityPoints: 1 },
  ),
  v('ALP_K9', 'ALPINE', 'van', 3200, 13, { K9_SEARCH: 100, MOUNTAIN_RESCUE: 50 }),
  v(
    'ALP_HELI',
    'ALPINE',
    'helicopter',
    23000,
    18,
    { MOUNTAIN_RESCUE: 100, AIR_SUPPORT: 80, PATIENT_TRANSPORT: 100 },
    { domain: 'AIR', capacityPoints: 4, speedFactor: 3 },
  ),
];

export const CAPABILITIES = [
  'FIRE_SUPPRESSION',
  'WATER_SUPPLY',
  'HEIGHT_ACCESS',
  'EXTRICATION',
  'TECHNICAL_RESCUE',
  'HEAVY_RESCUE',
  'HAZMAT',
  'WATER_RESCUE',
  'MEDICAL_BASIC',
  'MEDICAL_ADVANCED',
  'PATIENT_TRANSPORT',
  'MASS_CASUALTY',
  'SCENE_SECURITY',
  'TRAFFIC_CONTROL',
  'INVESTIGATION',
  'K9_SEARCH',
  'EOD',
  'WILDLAND_FIRE',
  'OFFROAD_ACCESS',
  'MOUNTAIN_RESCUE',
  'AIR_SUPPORT',
  'COMMAND',
  'LOGISTICS',
] as const;

export const FAMILIES: { code: ServiceFamily; color: string; requiredLevel: number }[] = [
  { code: 'FIRE', color: '#E5342B', requiredLevel: 1 },
  { code: 'EMS', color: '#2F7DF0', requiredLevel: 3 },
  { code: 'POLICE', color: '#2B4FB8', requiredLevel: 6 },
  { code: 'WILDFIRE', color: '#F08A1C', requiredLevel: 10 },
  { code: 'ALPINE', color: '#1F9D63', requiredLevel: 14 },
  { code: 'UNG', color: '#8492A6', requiredLevel: 1 },
];

export interface MockFacilityType {
  code: string;
  family: FacilityFamily;
  tier: number;
  price: number;
  requiredLevel: number;
  domains: ('GROUND' | 'AIR' | 'WATER')[];
  baseCapacity: Record<string, number>;
  icon: string;
}
const f = (
  code: string,
  family: FacilityFamily,
  tier: number,
  price: number,
  requiredLevel: number,
  ground: number,
  extra: Partial<MockFacilityType> = {},
): MockFacilityType => ({
  code,
  family,
  tier,
  price,
  requiredLevel,
  domains: ['GROUND'],
  icon: `facility_${family === 'SHARED' ? 'coordination' : family.toLowerCase()}`,
  baseCapacity: {
    GROUND: ground,
    PERSONNEL: ground * 4,
    STORAGE: 10 * tier,
    WORKSHOP: tier > 1 ? tier - 1 : 0,
  },
  ...extra,
});
/** 20 facility types in 5 chains + the shared coordination centre. */
export const FACILITY_TYPES: MockFacilityType[] = [
  f('FIRE_STATION_LOCAL', 'FIRE', 1, 6000, 1, 6),
  f('FIRE_DETACHMENT', 'FIRE', 2, 14000, 6, 10),
  f('FIRE_COMMAND', 'FIRE', 3, 32000, 12, 16),
  f('FIRE_SPECIAL_HUB', 'FIRE', 4, 70000, 18, 22, { domains: ['GROUND', 'AIR', 'WATER'] }),
  f('EMS_POST', 'EMS', 1, 5000, 3, 4),
  f('EMS_CENTER', 'EMS', 2, 12000, 7, 8),
  f('EMS_ADVANCED_CENTER', 'EMS', 3, 28000, 12, 12),
  f('EMS_HELI_BASE', 'EMS', 4, 60000, 17, 6, { domains: ['GROUND', 'AIR'] }),
  f('POLICE_POST', 'POLICE', 1, 5500, 6, 4),
  f('POLICE_STATION', 'POLICE', 2, 13000, 9, 8),
  f('POLICE_HQ', 'POLICE', 3, 30000, 13, 14),
  f('POLICE_SPECIAL_UNIT', 'POLICE', 4, 65000, 18, 12, { domains: ['GROUND', 'AIR'] }),
  f('AIB_OUTPOST', 'WILDFIRE', 1, 5000, 10, 4),
  f('AIB_BASE', 'WILDFIRE', 2, 12000, 12, 8),
  f('AIB_OPERATIONS_CENTER', 'WILDFIRE', 3, 27000, 15, 10),
  f('AIB_AIR_BASE', 'WILDFIRE', 4, 80000, 20, 6, { domains: ['GROUND', 'AIR'] }),
  f('ALPINE_STATION', 'ALPINE', 1, 5000, 10, 4),
  f('ALPINE_RESCUE_CENTER', 'ALPINE', 2, 12000, 13, 8),
  f('ALPINE_HELI_BASE', 'ALPINE', 3, 60000, 18, 6, { domains: ['GROUND', 'AIR'] }),
  f('COORDINATION_CENTER', 'SHARED', 1, 40000, 15, 2, { icon: 'facility_coordination' }),
];

export interface MockUpgradeType {
  code: string;
  domain: string;
  delta: number;
  basePrice: number;
  maxLevel: number;
  requiredLevel: number;
  buildSeconds: number;
}
export const UPGRADE_TYPES: MockUpgradeType[] = [
  {
    code: 'GARAGE',
    domain: 'GROUND',
    delta: 2,
    basePrice: 800,
    maxLevel: 5,
    requiredLevel: 1,
    buildSeconds: 120,
  },
  {
    code: 'QUARTERS',
    domain: 'PERSONNEL',
    delta: 6,
    basePrice: 500,
    maxLevel: 5,
    requiredLevel: 2,
    buildSeconds: 90,
  },
  {
    code: 'WORKSHOP',
    domain: 'WORKSHOP',
    delta: 1,
    basePrice: 1500,
    maxLevel: 3,
    requiredLevel: 4,
    buildSeconds: 180,
  },
  {
    code: 'STORAGE',
    domain: 'STORAGE',
    delta: 10,
    basePrice: 600,
    maxLevel: 4,
    requiredLevel: 3,
    buildSeconds: 90,
  },
  {
    code: 'HELIPAD',
    domain: 'AIR',
    delta: 4,
    basePrice: 12000,
    maxLevel: 1,
    requiredLevel: 16,
    buildSeconds: 600,
  },
];
/** n-th upgrade price = base × 1.45^(n−1) (analisi/05 §6). */
export const upgradePrice = (u: MockUpgradeType, nextLevel: number): number =>
  Math.round(u.basePrice * 1.45 ** (nextLevel - 1));

export interface MockIncidentTemplate {
  code: string;
  category: string;
  families: ServiceFamily[];
  minLevel: number;
  severity: [number, number];
  /** capability → [REQUIRED threshold at min severity, level] ; thresholds scale +12% per severity step */
  requirements: { capability: string; level: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL'; base: number }[];
  workSeconds: number;
  baseReward: number;
  baseXp: number;
  weight: number;
}
export const INCIDENT_TEMPLATES: MockIncidentTemplate[] = [
  {
    code: 'TRASH_FIRE',
    category: 'fire_minor',
    families: ['FIRE'],
    minLevel: 1,
    severity: [1, 2],
    requirements: [{ capability: 'FIRE_SUPPRESSION', level: 'REQUIRED', base: 30 }],
    workSeconds: 40,
    baseReward: 45,
    baseXp: 25,
    weight: 5,
  },
  {
    code: 'CAR_FIRE',
    category: 'fire_vehicle',
    families: ['FIRE'],
    minLevel: 1,
    severity: [2, 4],
    requirements: [
      { capability: 'FIRE_SUPPRESSION', level: 'REQUIRED', base: 55 },
      { capability: 'WATER_SUPPLY', level: 'RECOMMENDED', base: 40 },
    ],
    workSeconds: 60,
    baseReward: 80,
    baseXp: 40,
    weight: 4,
  },
  {
    code: 'APARTMENT_FIRE',
    category: 'fire_structure',
    families: ['FIRE'],
    minLevel: 2,
    severity: [4, 7],
    requirements: [
      { capability: 'FIRE_SUPPRESSION', level: 'REQUIRED', base: 90 },
      { capability: 'WATER_SUPPLY', level: 'REQUIRED', base: 50 },
      { capability: 'HEIGHT_ACCESS', level: 'RECOMMENDED', base: 60 },
    ],
    workSeconds: 110,
    baseReward: 190,
    baseXp: 80,
    weight: 2,
  },
  {
    code: 'ELEVATOR_RESCUE',
    category: 'technical',
    families: ['FIRE'],
    minLevel: 1,
    severity: [1, 3],
    requirements: [{ capability: 'TECHNICAL_RESCUE', level: 'REQUIRED', base: 40 }],
    workSeconds: 45,
    baseReward: 55,
    baseXp: 30,
    weight: 4,
  },
  {
    code: 'FALLEN_TREE',
    category: 'technical',
    families: ['FIRE'],
    minLevel: 1,
    severity: [1, 3],
    requirements: [{ capability: 'TECHNICAL_RESCUE', level: 'REQUIRED', base: 45 }],
    workSeconds: 50,
    baseReward: 60,
    baseXp: 30,
    weight: 3,
  },
  {
    code: 'FLOODED_BASEMENT',
    category: 'flood',
    families: ['FIRE'],
    minLevel: 1,
    severity: [2, 4],
    requirements: [
      { capability: 'TECHNICAL_RESCUE', level: 'REQUIRED', base: 35 },
      { capability: 'WATER_SUPPLY', level: 'OPTIONAL', base: 30 },
    ],
    workSeconds: 70,
    baseReward: 70,
    baseXp: 35,
    weight: 2,
  },
  {
    code: 'ROAD_ACCIDENT',
    category: 'traffic_accident',
    families: ['FIRE'],
    minLevel: 1,
    severity: [2, 5],
    requirements: [
      { capability: 'EXTRICATION', level: 'REQUIRED', base: 40 },
      { capability: 'FIRE_SUPPRESSION', level: 'RECOMMENDED', base: 30 },
    ],
    workSeconds: 60,
    baseReward: 85,
    baseXp: 45,
    weight: 4,
  },
  {
    code: 'ROAD_ACCIDENT_TRAPPED',
    category: 'traffic_accident',
    families: ['FIRE', 'EMS'],
    minLevel: 3,
    severity: [5, 8],
    requirements: [
      { capability: 'EXTRICATION', level: 'REQUIRED', base: 65 },
      { capability: 'MEDICAL_BASIC', level: 'REQUIRED', base: 60 },
      { capability: 'MEDICAL_ADVANCED', level: 'RECOMMENDED', base: 60 },
    ],
    workSeconds: 100,
    baseReward: 220,
    baseXp: 95,
    weight: 2,
  },
  {
    code: 'GAS_LEAK',
    category: 'gas_leak',
    families: ['FIRE'],
    minLevel: 2,
    severity: [3, 6],
    requirements: [
      { capability: 'TECHNICAL_RESCUE', level: 'REQUIRED', base: 55 },
      { capability: 'HAZMAT', level: 'OPTIONAL', base: 40 },
    ],
    workSeconds: 80,
    baseReward: 120,
    baseXp: 55,
    weight: 2,
  },
  {
    code: 'MEDICAL_MINOR',
    category: 'medical',
    families: ['EMS'],
    minLevel: 3,
    severity: [1, 3],
    requirements: [
      { capability: 'MEDICAL_BASIC', level: 'REQUIRED', base: 50 },
      { capability: 'PATIENT_TRANSPORT', level: 'RECOMMENDED', base: 100 },
    ],
    workSeconds: 45,
    baseReward: 60,
    baseXp: 30,
    weight: 5,
  },
  {
    code: 'FALL_INJURY',
    category: 'trauma',
    families: ['EMS'],
    minLevel: 3,
    severity: [3, 6],
    requirements: [
      { capability: 'MEDICAL_BASIC', level: 'REQUIRED', base: 70 },
      { capability: 'PATIENT_TRANSPORT', level: 'REQUIRED', base: 100 },
    ],
    workSeconds: 60,
    baseReward: 95,
    baseXp: 50,
    weight: 3,
  },
  {
    code: 'CARDIAC_ARREST',
    category: 'cardiac',
    families: ['EMS'],
    minLevel: 4,
    severity: [7, 9],
    requirements: [
      { capability: 'MEDICAL_ADVANCED', level: 'REQUIRED', base: 80 },
      { capability: 'PATIENT_TRANSPORT', level: 'REQUIRED', base: 100 },
    ],
    workSeconds: 75,
    baseReward: 210,
    baseXp: 100,
    weight: 2,
  },
];

/** XP needed to go from level n to n+1 (analisi/05 §4), then +22% per level. */
const LEVEL_STEPS = [100, 160, 240, 340, 460, 600, 760, 940, 1150];
export function xpThreshold(level: number): number {
  // cumulative XP required to REACH `level` (level 1 = 0)
  let total = 0;
  for (let l = 1; l < level; l++) {
    const step = LEVEL_STEPS[l - 1] ?? Math.round(1150 * 1.22 ** (l - LEVEL_STEPS.length));
    total += step;
  }
  return total;
}
export function levelForXp(xp: number): number {
  let level = 1;
  while (xpThreshold(level + 1) <= xp && level < 60) level++;
  return level;
}
