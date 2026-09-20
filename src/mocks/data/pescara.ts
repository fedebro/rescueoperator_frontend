import type { LngLat } from '@/lib/geo';

export const PESCARA = {
  id: 'IT-068028',
  name: 'Pescara',
  province: 'PE',
  region: 'Abruzzo',
  population: 118_657,
  center: [14.2139, 42.4618] as LngLat,
  bounds: [14.155, 42.415, 14.262, 42.498] as [number, number, number, number],
  timezone: 'Europe/Rome',
};

/** Other municipalities returned by the search; only Pescara is playable in the mock. */
export const OTHER_LOCATIONS = [
  {
    id: 'IT-068024',
    name: 'Montesilvano',
    province: 'PE',
    region: 'Abruzzo',
    population: 53_174,
    center: [14.1494, 42.5142] as LngLat,
  },
  {
    id: 'IT-068041',
    name: 'Spoltore',
    province: 'PE',
    region: 'Abruzzo',
    population: 18_868,
    center: [14.1406, 42.4553] as LngLat,
  },
  {
    id: 'IT-069022',
    name: 'Chieti',
    province: 'CH',
    region: 'Abruzzo',
    population: 48_714,
    center: [14.1672, 42.3512] as LngLat,
  },
  {
    id: 'IT-069035',
    name: 'Francavilla al Mare',
    province: 'CH',
    region: 'Abruzzo',
    population: 25_520,
    center: [14.2917, 42.4183] as LngLat,
  },
  {
    id: 'IT-066049',
    name: "L'Aquila",
    province: 'AQ',
    region: 'Abruzzo',
    population: 69_605,
    center: [13.3995, 42.3498] as LngLat,
  },
  {
    id: 'IT-067041',
    name: 'Teramo',
    province: 'TE',
    region: 'Abruzzo',
    population: 51_650,
    center: [13.7039, 42.6589] as LngLat,
  },
  {
    id: 'IT-058091',
    name: 'Roma',
    province: 'RM',
    region: 'Lazio',
    population: 2_748_109,
    center: [12.4964, 41.9028] as LngLat,
  },
  {
    id: 'IT-015146',
    name: 'Milano',
    province: 'MI',
    region: 'Lombardia',
    population: 1_371_498,
    center: [9.19, 45.4642] as LngLat,
  },
  {
    id: 'IT-068030',
    name: 'Pianella',
    province: 'PE',
    region: 'Abruzzo',
    population: 8_588,
    center: [14.0453, 42.3986] as LngLat,
  },
  {
    id: 'IT-068027',
    name: 'Penne',
    province: 'PE',
    region: 'Abruzzo',
    population: 11_502,
    center: [13.9281, 42.4575] as LngLat,
  },
];

export const STARTER_SITES = [
  {
    key: 'central',
    name: 'Caserma Pescara Centro',
    real: false,
    position: [14.2102, 42.4629] as LngLat,
    address: 'Via Michelangelo, Pescara',
    coveragePopulationPct: 82,
    avgResponseMinutes: 5.4,
    capacityPoints: 6,
    expansionPotential: 'LOW' as const,
    profile: 'CENTRAL' as const,
  },
  {
    key: 'balanced',
    name: 'Comando Vigili del Fuoco — Viale Pindaro',
    real: true,
    position: [14.2236, 42.4541] as LngLat,
    address: 'Viale Pindaro, Pescara',
    coveragePopulationPct: 74,
    avgResponseMinutes: 6.3,
    capacityPoints: 8,
    expansionPotential: 'MEDIUM' as const,
    profile: 'BALANCED' as const,
  },
  {
    key: 'peripheral',
    name: 'Sito Tiburtina Ovest',
    real: false,
    position: [14.1872, 42.4488] as LngLat,
    address: 'Via Tiburtina Valeria, Pescara',
    coveragePopulationPct: 58,
    avgResponseMinutes: 8.1,
    capacityPoints: 10,
    expansionPotential: 'HIGH' as const,
    profile: 'PERIPHERAL' as const,
  },
];

/**
 * Candidate sites where a new facility can be acquired (GET /sites). `real: true` sites are named after the real KIND of
 * place found in the geodata (never an emblem or livery, D-80); generated ones follow the geodata naming
 * ("Sede operativa <street>"). A SHARED site carries the family of its closest service and only offers SHARED types.
 * The three starter sites are candidates too (see `STARTER_SITES`): the one picked at onboarding shows up as owned.
 */
export interface MockCandidateSite {
  key: string;
  name: string;
  real: boolean;
  family: 'FIRE' | 'EMS' | 'POLICE' | 'WILDFIRE' | 'ALPINE';
  position: LngLat;
  address: string;
  capacityPoints: number;
  expansionPotential: 'LOW' | 'MEDIUM' | 'HIGH';
  profile: 'CENTRAL' | 'BALANCED' | 'PERIPHERAL';
  compatibleFacilityTypes: string[];
}
const site = (
  key: string,
  name: string,
  real: boolean,
  family: MockCandidateSite['family'],
  position: LngLat,
  address: string,
  capacityPoints: number,
  expansionPotential: MockCandidateSite['expansionPotential'],
  profile: MockCandidateSite['profile'],
  compatibleFacilityTypes: string[],
): MockCandidateSite => ({
  key,
  name,
  real,
  family,
  position,
  address,
  capacityPoints,
  expansionPotential,
  profile,
  compatibleFacilityTypes,
});
const FIRE_SMALL = ['FIRE_LOCAL_STATION', 'FIRE_DETACHMENT'];
const EMS_SMALL = ['EMS_POST', 'EMS_STATION'];
const POLICE_SMALL = ['POLICE_POST', 'POLICE_STATION'];
export const CANDIDATE_SITES: MockCandidateSite[] = [
  ...STARTER_SITES.map((s) =>
    site(
      s.key,
      s.name,
      s.real,
      'FIRE',
      s.position,
      s.address,
      s.capacityPoints,
      s.expansionPotential,
      s.profile,
      FIRE_SMALL,
    ),
  ),
  site(
    'fire-port',
    'Distaccamento portuale dei Vigili del Fuoco',
    true,
    'FIRE',
    [14.2297, 42.4668],
    'Lungomare Giovanni XXIII, Pescara',
    8,
    'MEDIUM',
    'BALANCED',
    [...FIRE_SMALL, 'FIRE_COMMAND'],
  ),
  site(
    'fire-north',
    'Sede operativa Via Nazionale Adriatica Nord',
    false,
    'FIRE',
    [14.1985, 42.4794],
    'Via Nazionale Adriatica Nord, Pescara',
    6,
    'HIGH',
    'PERIPHERAL',
    FIRE_SMALL,
  ),
  site(
    'ems-hospital',
    'Postazione 118 dell’ospedale civile',
    true,
    'EMS',
    [14.2012, 42.4619],
    'Via Fonte Romana, Pescara',
    3,
    'LOW',
    'CENTRAL',
    EMS_SMALL,
  ),
  site(
    'ems-south',
    'Postazione 118 Pescara Sud',
    true,
    'EMS',
    [14.2243, 42.4497],
    'Viale Pindaro, Pescara',
    4,
    'MEDIUM',
    'BALANCED',
    [...EMS_SMALL, 'EMS_ADVANCED_STATION'],
  ),
  site(
    'ems-marconi',
    'Sede operativa Viale Marconi',
    false,
    'EMS',
    [14.2189, 42.4571],
    'Viale Guglielmo Marconi, Pescara',
    2,
    'LOW',
    'CENTRAL',
    ['EMS_POST'],
  ),
  site(
    'ems-caravaggio',
    'Sede operativa Via Caravaggio',
    false,
    'EMS',
    [14.2068, 42.4758],
    'Via Caravaggio, Pescara',
    4,
    'HIGH',
    'PERIPHERAL',
    EMS_SMALL,
  ),
  site(
    'ems-airport',
    'Area elicotteri dell’aeroporto',
    true,
    'EMS',
    [14.1889, 42.4362],
    'Via Tiburtina Valeria, Pescara',
    10,
    'HIGH',
    'PERIPHERAL',
    ['EMS_ADVANCED_STATION', 'EMS_HELI_BASE'],
  ),
  site(
    'police-hq',
    'Questura di Pescara',
    true,
    'POLICE',
    [14.2079, 42.4671],
    'Via Pesaro, Pescara',
    10,
    'MEDIUM',
    'CENTRAL',
    [...POLICE_SMALL, 'POLICE_HQ'],
  ),
  site(
    'police-local',
    'Comando della Polizia Locale',
    true,
    'POLICE',
    [14.1948, 42.4663],
    'Via del Circuito, Pescara',
    6,
    'MEDIUM',
    'BALANCED',
    POLICE_SMALL,
  ),
  site(
    'police-tirino',
    'Sede operativa Via Tirino',
    false,
    'POLICE',
    [14.2047, 42.4507],
    'Via Tirino, Pescara',
    3,
    'LOW',
    'PERIPHERAL',
    ['POLICE_POST'],
  ),
  site(
    'aib-pineta',
    'Stazione dei Carabinieri Forestali della Pineta',
    true,
    'WILDFIRE',
    [14.2331, 42.4489],
    'Pineta Dannunziana, Pescara',
    4,
    'MEDIUM',
    'BALANCED',
    ['AIB_OUTPOST', 'AIB_BASE'],
  ),
  site(
    'aib-colle',
    'Sede operativa Strada Colle Pineta',
    false,
    'WILDFIRE',
    [14.2226, 42.4405],
    'Strada Colle Pineta, Pescara',
    8,
    'HIGH',
    'PERIPHERAL',
    ['AIB_OUTPOST', 'AIB_BASE', 'AIB_OPERATIONS_CENTER'],
  ),
  site(
    'alpine-silvestro',
    'Sede operativa San Silvestro Colle',
    false,
    'ALPINE',
    [14.2141, 42.4271],
    'San Silvestro, Pescara',
    4,
    'MEDIUM',
    'PERIPHERAL',
    ['ALPINE_STATION', 'ALPINE_RESCUE_CENTER'],
  ),
  site(
    'shared-coc',
    'Centro operativo comunale di protezione civile',
    true,
    'FIRE',
    [14.2039, 42.4583],
    'Via Aterno, Pescara',
    4,
    'LOW',
    'CENTRAL',
    ['COORDINATION_CENTER'],
  ),
];

/** Inland spots (approximate, all on land) used to place mock incidents. */
export const INCIDENT_SPOTS: { address: string; position: LngLat }[] = [
  { address: 'Corso Umberto I, Pescara', position: [14.2131, 42.4661] },
  { address: 'Piazza della Rinascita, Pescara', position: [14.2152, 42.4667] },
  { address: 'Via Nicola Fabrizi, Pescara', position: [14.2118, 42.4642] },
  { address: 'Stazione Pescara Centrale', position: [14.2086, 42.4656] },
  { address: 'Viale Giovanni Bovio, Pescara', position: [14.2049, 42.4731] },
  { address: 'Via del Santuario, Pescara', position: [14.1998, 42.4692] },
  { address: 'Via di Sotto, Pescara', position: [14.1904, 42.4623] },
  { address: 'Via Tiburtina Valeria, Pescara', position: [14.1951, 42.4519] },
  { address: 'Aeroporto d’Abruzzo, Pescara', position: [14.1872, 42.4371] },
  { address: 'Viale Guglielmo Marconi, Pescara', position: [14.2201, 42.4562] },
  { address: 'Via Tirino, Pescara', position: [14.2052, 42.4502] },
  { address: 'Viale Pindaro, Pescara', position: [14.2259, 42.4522] },
  { address: 'Stadio Adriatico, Pescara', position: [14.2288, 42.4546] },
  { address: 'Via Nazionale Adriatica Nord, Pescara', position: [14.1979, 42.4806] },
  { address: 'Via Caravaggio, Pescara', position: [14.2061, 42.4763] },
  { address: 'Via Fonte Romana, Pescara', position: [14.2004, 42.4612] },
  { address: 'Via Rigopiano, Pescara', position: [14.1992, 42.4574] },
  { address: 'Strada Colle Pineta, Pescara', position: [14.2219, 42.4412] },
  { address: 'Via Aterno, Pescara', position: [14.2031, 42.4551] },
  { address: 'San Silvestro, Pescara', position: [14.2148, 42.4262] },
  { address: 'Pineta Dannunziana, Pescara', position: [14.2342, 42.4478] },
  { address: 'Via del Circuito, Pescara', position: [14.1935, 42.4668] },
  { address: 'Piazza Duca d’Aosta, Pescara', position: [14.2172, 42.4607] },
  { address: 'Via Raffaello Sanzio, Pescara', position: [14.2087, 42.4712] },
];

/**
 * Plausible road-like polyline between two points without a routing engine: a staircase along Pescara's
 * street grid (rotated ≈ −38° to follow the coast), with a deterministic wobble. Distances ≈ straight × 1.3.
 */
export function mockRoute(from: LngLat, to: LngLat, seed = 1): LngLat[] {
  const theta = (-38 * Math.PI) / 180;
  const cosLat = Math.cos((from[1] * Math.PI) / 180);
  const toLocal = (p: LngLat): [number, number] => {
    const x = (p[0] - from[0]) * cosLat,
      y = p[1] - from[1];
    return [x * Math.cos(theta) + y * Math.sin(theta), -x * Math.sin(theta) + y * Math.cos(theta)];
  };
  const toWorld = (u: number, w: number): LngLat => {
    const x = u * Math.cos(theta) - w * Math.sin(theta),
      y = u * Math.sin(theta) + w * Math.cos(theta);
    return [from[0] + x / cosLat, from[1] + y];
  };
  const [tu, tw] = toLocal(to);
  const steps = Math.max(2, Math.min(5, Math.round((Math.abs(tu) + Math.abs(tw)) / 0.006)));
  let s = seed >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  const pts: LngLat[] = [from];
  let u = 0,
    w = 0;
  for (let i = 1; i <= steps; i++) {
    const fu = i === steps ? 1 : Math.min(1, i / steps + (rnd() - 0.5) * 0.12);
    const nu = tu * fu;
    pts.push(toWorld(nu, w));
    u = nu;
    const nw = i === steps ? tw : tw * Math.min(1, i / steps + (rnd() - 0.5) * 0.12);
    pts.push(toWorld(u, nw));
    w = nw;
  }
  pts.push(to);
  // drop consecutive duplicates
  return pts.filter(
    (p, i) => i === 0 || Math.abs(p[0] - pts[i - 1]![0]) > 1e-7 || Math.abs(p[1] - pts[i - 1]![1]) > 1e-7,
  );
}
