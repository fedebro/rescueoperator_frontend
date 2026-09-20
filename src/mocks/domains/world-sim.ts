import { cellToLatLng, polygonToCells } from 'h3-js';
import type { z } from 'zod';
import type { CoverageDto as CoverageSchema, ServiceFamily, SyncSnapshot } from '@/contracts';
import { haversineMeters, type LngLat } from '@/lib/geo';
import { ECONOMY } from '../data/catalog';
import { PESCARA } from '../data/pescara';

/**
 * Pure simulation functions of the `world` mock domain (no engine, no state): time context, weather, traffic, closures
 * geometry, coverage and the stipend formula. Kept separate from `world.ts` so that they can be unit-tested in isolation
 * and mirror the pure functions of the backend (`modules/world/time-context.ts`, `economy/stipend.service.ts`).
 */

export type WorldContext = SyncSnapshot['world'];
export type WeatherCode = WorldContext['weather']['code'];
export type DayPhase = WorldContext['dayPhase'];
export type TrafficLevel = WorldContext['trafficLevel'];
export type CoverageDto = z.infer<typeof CoverageSchema>;
export type HourBand = 'NIGHT' | 'EARLY_MORNING' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'LATE_EVENING';
export type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN';
export type WeekdayType = 'WEEKDAY' | 'SATURDAY' | 'SUNDAY';

/* ───────────────────────────── time ───────────────────────────── */

export interface TimeContext {
  hour: number;
  minute: number;
  month: number;
  /** Local calendar day, e.g. "2026-09-20": the seed of the day's weather. */
  dayKey: string;
  hourBand: HourBand;
  weekdayType: WeekdayType;
  season: Season;
  dayPhase: DayPhase;
}

/** Same bands as the backend (catalog/data/time.yaml): the game clock is the real local time of the territory (D-63). */
export const hourBandOf = (hour: number): HourBand =>
  hour < 6
    ? 'NIGHT'
    : hour < 9
      ? 'EARLY_MORNING'
      : hour < 13
        ? 'MORNING'
        : hour < 18
          ? 'AFTERNOON'
          : hour < 22
            ? 'EVENING'
            : 'LATE_EVENING';
export const seasonOf = (month: number): Season =>
  month === 12 || month <= 2 ? 'WINTER' : month <= 5 ? 'SPRING' : month <= 8 ? 'SUMMER' : 'AUTUMN';

/** Sunrise / sunset on the local clock (minutes after midnight, DST included) at mid-month, latitude of Pescara. */
const SUN_TABLE: readonly (readonly [number, number])[] = [
  [450, 1015],
  [420, 1055],
  [380, 1090],
  [385, 1185],
  [345, 1215],
  [330, 1240],
  [340, 1235],
  [370, 1200],
  [405, 1150],
  [435, 1095],
  [410, 1005],
  [445, 990],
];
const TWILIGHT_MINUTES = 35;

export function dayPhaseOf(month: number, hour: number, minute: number): DayPhase {
  const [sunrise, sunset] = SUN_TABLE[(month - 1) % 12]!;
  const m = hour * 60 + minute;
  if (m >= sunrise + TWILIGHT_MINUTES && m <= sunset - TWILIGHT_MINUTES) return 'DAY';
  if (m < sunrise - TWILIGHT_MINUTES || m > sunset + TWILIGHT_MINUTES) return 'NIGHT';
  return 'TWILIGHT';
}

export function timeContext(nowMs: number, timezone: string): TimeContext {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(nowMs);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const month = Number(get('month'));
  const weekday = get('weekday');
  return {
    hour,
    minute,
    month,
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    hourBand: hourBandOf(hour),
    weekdayType: weekday === 'Sat' ? 'SATURDAY' : weekday === 'Sun' ? 'SUNDAY' : 'WEEKDAY',
    season: seasonOf(month),
    dayPhase: dayPhaseOf(month, hour, minute),
  };
}

/* ───────────────────────────── weather ───────────────────────────── */

/** Deterministic hash → [0, 1). The weather of a slot never depends on `Math.random`, so every tab and test agrees. */
export function hash01(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const seedOf = (textSeed: string): number => {
  let h = 2166136261;
  for (const ch of textSeed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};

/** A weather front lasts three slots (~1 game hour) and blends into the next one: no flickering between extremes. */
const SLOTS_PER_FRONT = 3;
const SEASON_TEMPERATURE: Record<Season, number> = { WINTER: 7, SPRING: 15, SUMMER: 27, AUTUMN: 17 };

export interface WeatherSample {
  code: WeatherCode;
  temperatureC: number;
  windKmh: number;
}

/**
 * Weather of the slot that contains `nowMs`. `slotMs` = 20 game minutes in real milliseconds (`engine.dur(1200)`).
 * The sequence is seeded by the local day, so it is stable across reloads and identical for every observer.
 */
export function weatherAt(nowMs: number, slotMs: number, timezone: string): WeatherSample {
  const slot = Math.floor(nowMs / slotMs);
  // Everything is evaluated at the START of the slot: the sample is constant for the whole slot.
  const time = timeContext(slot * slotMs, timezone);
  const front = Math.floor(slot / SLOTS_PER_FRONT);
  const daySeed = seedOf(time.dayKey);
  const blend = (slot % SLOTS_PER_FRONT) / SLOTS_PER_FRONT;
  const v = hash01(daySeed ^ front) * (1 - blend) + hash01(daySeed ^ (front + 1)) * blend;
  const gust = hash01(daySeed ^ (slot * 7919));

  let code: WeatherCode;
  if (v < 0.46) code = 'CLEAR';
  else if (v < 0.7) code = 'CLOUDY';
  else if (v < 0.82) code = 'RAIN';
  else if (v < 0.88) code = 'HEAVY_RAIN';
  else if (v < 0.91) code = 'STORM';
  else if (v < 0.95) code = 'HIGH_WIND';
  else code = time.hour < 9 || time.hour >= 21 ? 'FOG' : 'CLOUDY';
  if (time.season === 'SUMMER' && code === 'CLEAR' && v < 0.12 && time.hour >= 12 && time.hour < 18)
    code = 'EXTREME_HEAT';
  if (time.season === 'WINTER' && code === 'HEAVY_RAIN') code = 'SNOW';

  const diurnal = 5 * Math.cos(((time.hour + time.minute / 60 - 15) / 24) * 2 * Math.PI);
  const wet = code === 'RAIN' || code === 'HEAVY_RAIN' || code === 'STORM' ? -3 : 0;
  let temperatureC = SEASON_TEMPERATURE[time.season] + diurnal + wet + (gust - 0.5) * 3;
  if (code === 'EXTREME_HEAT') temperatureC = Math.max(temperatureC, 36 + gust * 3);
  if (code === 'SNOW') temperatureC = Math.min(temperatureC, 1);
  let windKmh = 5 + gust * gust * 28;
  if (code === 'HIGH_WIND') windKmh = 55 + gust * 25;
  if (code === 'STORM') windKmh = 38 + gust * 30;
  return { code, temperatureC: Math.round(temperatureC), windKmh: Math.round(windKmh) };
}

/** How much the weather slows road travel down (folded into `trafficMultiplier`, like the backend does). */
export const WEATHER_TRAVEL_FACTOR: Record<WeatherCode, number> = {
  CLEAR: 1,
  CLOUDY: 1,
  RAIN: 1.08,
  HEAVY_RAIN: 1.18,
  STORM: 1.3,
  HIGH_WIND: 1.05,
  FOG: 1.2,
  SNOW: 1.4,
  EXTREME_HEAT: 1,
};

/* ───────────────────────────── traffic ───────────────────────────── */

function hourCongestion(time: Pick<TimeContext, 'hour' | 'weekdayType' | 'season'>): number {
  const h = time.hour;
  if (h < 6) return 0;
  if (time.weekdayType === 'WEEKDAY') {
    if (h >= 7 && h < 9) return 0.32;
    if (h >= 17 && h < 19) return 0.36;
    if (h >= 12 && h < 14) return 0.2;
    return h >= 22 ? 0.03 : 0.1;
  }
  if (time.weekdayType === 'SATURDAY') {
    if ((h >= 10 && h < 13) || (h >= 17 && h < 20)) return 0.22;
    return h >= 23 ? 0.05 : 0.08;
  }
  // Sunday evening in summer: everybody drives back from the beach.
  if (time.season === 'SUMMER' && h >= 17 && h < 20) return 0.3;
  return 0.04;
}

/** Road travel multiplier of the moment (hour × weekday × weather), clamped like the backend configuration. */
export function trafficMultiplierOf(
  time: Pick<TimeContext, 'hour' | 'weekdayType' | 'season'>,
  weather: WeatherCode,
): number {
  const raw = (1 + hourCongestion(time)) * WEATHER_TRAVEL_FACTOR[weather];
  return Math.round(Math.min(1.8, Math.max(1, raw)) * 100) / 100;
}
/** Same thresholds as the backend (`trafficLevelOf`). */
export const trafficLevelOf = (multiplier: number): TrafficLevel =>
  multiplier < 1.05
    ? 'FREE_FLOW'
    : multiplier < 1.15
      ? 'LIGHT'
      : multiplier < 1.3
        ? 'MODERATE'
        : multiplier < 1.5
          ? 'HEAVY'
          : 'SEVERE';

/* ───────────────────────────── closures ───────────────────────────── */

export interface MockClosure {
  id: string;
  polygon: LngLat[];
  reasonKey: string;
  reasonParams: Record<string, string | number>;
  /** Epoch ms; null = until removed. */
  endsAt: number | null;
  kind: 'PARTIAL' | 'FULL';
  multiplier: number;
  incidentId: string | null;
}
export const CLOSURE_MULTIPLIER = { PARTIAL: 1.25, FULL: 1.6 } as const;

const metersToLng = (meters: number, lat: number) => meters / (111_320 * Math.cos((lat * Math.PI) / 180));
const metersToLat = (meters: number) => meters / 110_540;

/** Closed ring (first point repeated) approximating a circle: closure around an incident scene. */
export function circlePolygon(center: LngLat, radiusMeters: number, steps = 10): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([
      center[0] + metersToLng(radiusMeters * Math.cos(a), center[1]),
      center[1] + metersToLat(radiusMeters * Math.sin(a)),
    ]);
  }
  ring.push(ring[0]!);
  return ring;
}

/** Closed ring of the corridor `halfWidthMeters` around the street segment a → b. */
export function corridorPolygon(a: LngLat, b: LngLat, halfWidthMeters: number): LngLat[] {
  const lat = (a[1] + b[1]) / 2;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos((lat * Math.PI) / 180);
  const dy = (b[1] - a[1]) * 110_540;
  const len = Math.hypot(dx, dy) || 1;
  const nx = metersToLng((-dy / len) * halfWidthMeters, lat);
  const ny = metersToLat((dx / len) * halfWidthMeters);
  const ring: LngLat[] = [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
  ring.push(ring[0]!);
  return ring;
}

export function pointInPolygon(p: LngLat, polygon: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const orient = (a: LngLat, b: LngLat, c: LngLat) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
/** True when the road path enters or crosses the polygon (vertex inside, or a leg cutting an edge). */
export function pathCrossesPolygon(path: readonly LngLat[], polygon: readonly LngLat[]): boolean {
  if (polygon.length < 3 || path.length === 0) return false;
  if (path.some((p) => pointInPolygon(p, polygon))) return true;
  for (let i = 1; i < path.length; i++)
    for (let j = 1; j < polygon.length; j++)
      if (segmentsIntersect(path[i - 1]!, path[i]!, polygon[j - 1]!, polygon[j]!)) return true;
  return false;
}
/** Worst multiplier among the closures the path runs into (detours do not stack). */
export function closureFactor(path: readonly LngLat[], closures: readonly MockClosure[]): number {
  let factor = 1;
  for (const c of closures) if (pathCrossesPolygon(path, c.polygon)) factor = Math.max(factor, c.multiplier);
  return factor;
}

/** Demo closures on real streets of Pescara; they come and go on a slot-based rota (stateless, so nothing to catch up). */
const DEMO_CLOSURES = [
  {
    key: 'corso',
    street: 'Corso Vittorio Emanuele II',
    reasonKey: 'world.closure.ROADWORKS',
    kind: 'PARTIAL' as const,
    from: [14.2119, 42.4689] as LngLat,
    to: [14.2131, 42.4642] as LngLat,
    cycle: 6,
    activeSlots: 4,
    offset: 0,
  },
  {
    key: 'lungomare',
    street: 'Lungomare Matteotti',
    reasonKey: 'world.closure.EVENT',
    kind: 'FULL' as const,
    from: [14.2196, 42.4716] as LngLat,
    to: [14.2236, 42.4681] as LngLat,
    cycle: 9,
    activeSlots: 4,
    offset: 2,
  },
];
export function demoClosuresAt(nowMs: number, slotMs: number): MockClosure[] {
  const slot = Math.floor(nowMs / slotMs);
  return DEMO_CLOSURES.flatMap((d) => {
    const position = (((slot - d.offset) % d.cycle) + d.cycle) % d.cycle;
    if (position >= d.activeSlots) return [];
    const startSlot = slot - position;
    return [
      {
        id: `rst_demo_${d.key}_${startSlot}`,
        polygon: corridorPolygon(d.from, d.to, 28),
        reasonKey: d.reasonKey,
        reasonParams: { street: d.street },
        endsAt: (startSlot + d.activeSlots) * slotMs,
        kind: d.kind,
        multiplier: CLOSURE_MULTIPLIER[d.kind],
        incidentId: null,
      },
    ];
  });
}

/* ───────────────────────────── coverage ───────────────────────────── */

export const COVERAGE_RESOLUTION = 8;
export const ISOCHRONE_SECONDS = [300, 600, 900, 1200, 1800];
/** Straight line × 1.4 at the urban emergency average, plus the turnout time of the crew. */
const DETOUR_FACTOR = 1.4;
const URBAN_SPEED_MS = 33 / 3.6;
const TURNOUT_SECONDS = 90;
/** Beyond this nobody is "reachable" for coverage purposes (the cell is drawn hatched). */
const UNREACHABLE_SECONDS = 2700;

export interface PopulationCell {
  h3: string;
  center: LngLat;
  population: number;
}

/** The Adriatic coast of Pescara runs NW → SE: everything north-east of this line is sea. */
const COAST_A: LngLat = [14.185, 42.5];
const COAST_B: LngLat = [14.262, 42.4385];
function metersInland(p: LngLat): number {
  const lat = (COAST_A[1] + COAST_B[1]) / 2;
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  const ax = (COAST_B[0] - COAST_A[0]) * kx;
  const ay = (COAST_B[1] - COAST_A[1]) * ky;
  const px = (p[0] - COAST_A[0]) * kx;
  const py = (p[1] - COAST_A[1]) * ky;
  // Signed distance from the coast line; positive = south-west of it = land.
  return (ax * py - ay * px) / -Math.hypot(ax, ay);
}

let cellCache: PopulationCell[] | null = null;
/**
 * Inhabited H3 res-8 cells of the playable area with a plausible population: densest around the centre and along the
 * coastal strip, thinning out towards the hills. The total equals the real population of the municipality.
 */
export function populationCells(): PopulationCell[] {
  if (cellCache) return cellCache;
  const [w, s, e, n] = PESCARA.bounds;
  const ids = polygonToCells(
    [
      [s, w],
      [s, e],
      [n, e],
      [n, w],
      [s, w],
    ],
    COVERAGE_RESOLUTION,
  );
  const raw = ids
    .map((h3) => {
      const [lat, lng] = cellToLatLng(h3);
      const center: LngLat = [lng, lat];
      const inland = metersInland(center);
      if (inland < -150) return null;
      const fromCentre = haversineMeters(center, PESCARA.center);
      const density = Math.exp(-fromCentre / 1750) + 0.55 * Math.exp(-Math.max(0, inland) / 900) + 0.025;
      return { h3, center, density };
    })
    .filter((c): c is { h3: string; center: LngLat; density: number } => c !== null)
    .sort((a, b) => a.h3.localeCompare(b.h3));
  const total = raw.reduce((sum, c) => sum + c.density, 0) || 1;
  cellCache = raw.map((c) => ({
    h3: c.h3,
    center: c.center,
    population: Math.round((c.density / total) * PESCARA.population),
  }));
  return cellCache;
}

export const responseSeconds = (from: LngLat, to: LngLat): number =>
  Math.round(TURNOUT_SECONDS + (haversineMeters(from, to) * DETOUR_FACTOR) / URBAN_SPEED_MS);

export interface CoverageFacility {
  id: string;
  position: LngLat;
  /** Families of the vehicles this operational facility can actually send out. */
  families: ServiceFamily[];
}

const PLAYER_FAMILIES: ServiceFamily[] = ['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE'];

export function computeCoverage(input: {
  facilities: CoverageFacility[];
  unlockedFamilies: readonly string[];
  computedAt: string;
  stale?: boolean;
}): CoverageDto {
  const cells = populationCells();
  const populationTotal = cells.reduce((sum, c) => sum + c.population, 0);
  const stipend = ECONOMY.stipend;
  const outCells = cells.map((cell) => {
    const secondsByFamily: Record<string, number> = {};
    for (const facility of input.facilities) {
      const seconds = responseSeconds(facility.position, cell.center);
      if (seconds > UNREACHABLE_SECONDS) continue;
      for (const family of facility.families)
        secondsByFamily[family] = Math.min(secondsByFamily[family] ?? Number.POSITIVE_INFINITY, seconds);
    }
    const values = Object.values(secondsByFamily);
    return {
      h3: cell.h3,
      population: cell.population,
      bestSeconds: values.length ? Math.min(...values) : null,
      center: cell.center,
      inArea: true,
      secondsByFamily,
    };
  });
  const byFamily = PLAYER_FAMILIES.map((family) => {
    const thresholdSeconds = (stipend.coverageThresholdMinutes[family] ?? 12) * 60;
    const populationCovered = outCells
      .filter((c) => (c.secondsByFamily[family] ?? Number.POSITIVE_INFINITY) <= thresholdSeconds)
      .reduce((sum, c) => sum + c.population, 0);
    return {
      family,
      pct: populationTotal > 0 ? Math.round((populationCovered / populationTotal) * 10_000) / 100 : 0,
      thresholdSeconds,
      weight: stipend.familyWeights[family] ?? 1,
      populationCovered,
      active: input.facilities.some((f) => f.families.includes(family)),
    };
  });
  // Only the families the player can already run count: a locked family must not drag the stipend down.
  const counted = byFamily.filter((f) => input.unlockedFamilies.includes(f.family));
  const weightSum = counted.reduce((sum, f) => sum + f.weight, 0) || 1;
  const overallPct =
    Math.round((counted.reduce((sum, f) => sum + f.pct * f.weight, 0) / weightSum) * 100) / 100;
  return {
    computedAt: input.computedAt,
    targetSeconds: (stipend.coverageThresholdMinutes.FIRE ?? 12) * 60,
    overallPct,
    byFamily,
    cells: outCells,
    method: input.facilities.length ? 'STRAIGHT_LINE' : 'NONE',
    populationTotal,
    facilities: input.facilities,
    isochroneSeconds: ISOCHRONE_SECONDS,
    stale: input.stale ?? false,
  };
}

/* ───────────────────────────── stipend ───────────────────────────── */

/** `g(coverage)`: stepped factor on the covered share 0..1 (analisi/05 §3). */
export function coverageFactor(share: number): number {
  const steps = ECONOMY.stipend.coverageSteps;
  return (steps.find((s) => share < s.below) ?? steps.at(-1)!).factor;
}
/** `h(reputation)`: linear between the two configured ends, 3 decimals like the backend. */
export function reputationFactor(reputation: number): number {
  const { atZero, atHundred } = ECONOMY.stipend.reputationFactor;
  const r = Math.min(100, Math.max(0, reputation));
  return Math.round((atZero + ((atHundred - atZero) * r) / 100) * 1000) / 1000;
}

export interface StipendEstimate {
  base: number;
  coveragePct: number;
  coverageMultiplier: number;
  reputationMultiplier: number;
  bonusMultiplier: number;
  personnelCost: number;
  net: number;
}
/** stipend = max(0, round(base × g × h × bonus) − personnel cost): the deduction can never make it negative. */
export function computeStipend(input: {
  base: number;
  coveragePct: number;
  reputation: number;
  bonusMultiplier?: number;
  personnelCost: number;
}): StipendEstimate {
  const coverageMultiplier = coverageFactor(input.coveragePct / 100);
  const reputationMultiplier = reputationFactor(input.reputation);
  const bonusMultiplier = input.bonusMultiplier ?? 1;
  const gross = Math.max(
    0,
    Math.round(input.base * coverageMultiplier * reputationMultiplier * bonusMultiplier),
  );
  const personnelCost = Math.max(0, Math.round(input.personnelCost));
  return {
    base: input.base,
    coveragePct: input.coveragePct,
    coverageMultiplier,
    reputationMultiplier,
    bonusMultiplier,
    personnelCost,
    net: Math.max(0, gross - personnelCost),
  };
}
