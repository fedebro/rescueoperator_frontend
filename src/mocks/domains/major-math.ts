import type { MajorGroupDto, MajorPhase } from '@/contracts';
import type { MajorScenario, MajorSettings } from '../data/catalog';

/**
 * Major incidents — the pure rules of the mock (D-24 [U] / D-69 [C]). A port of the backend's
 * `src/modules/major-incidents/major.math.ts` and `major.view.ts` (analisi/note-agenti/major-incidents.md §2): sizing on the
 * fleet, severity one band beyond the level cap, phases, linked incidents, reinforcement gap, quality / reward / medal /
 * reputation and the requirement bars grouped by service. No state, no randomness of its own (a `rand` is passed in).
 */

export const OPERATIONAL_PHASES = ['ALARM', 'CONTAINMENT', 'RESCUE', 'SECURING'] as const;
export type OperationalPhase = (typeof OPERATIONAL_PHASES)[number];
export type MajorOutcomeValue = 'SUCCESS' | 'PARTIAL' | 'FAILURE' | 'CANCELLED';
export type MajorMedalValue = 'BRONZE' | 'SILVER' | 'GOLD';

/** The backend's reward quality bounds (`config.rewards.qualityMin/Max`) and reputation (`config.reputation`). */
export const QUALITY = { min: 0.5, max: 1.2 } as const;
export const REPUTATION = { smoothing: 0.0645, failedTarget: 0 } as const;

const clamp = (min: number, max: number, value: number): number => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 4): number => Math.round(value * 10 ** digits) / 10 ** digits;

export const phaseIndex = (phase: MajorPhase): number =>
  phase === 'ENDED' ? OPERATIONAL_PHASES.length : OPERATIONAL_PHASES.indexOf(phase);

/* ───────────── sizing on the fleet ───────────── */

/** clamp(minVehicles, maxVehicles, operational × U(fleetShare)). */
export function targetVehicles(operational: number, sizing: MajorSettings['sizing'], u: number): number {
  const [low, high] = sizing.fleetShare;
  const share = low + u * Math.max(0, high - low);
  return clamp(
    sizing.minVehicles,
    Math.max(sizing.minVehicles, sizing.maxVehicles),
    Math.round(operational * share),
  );
}

export interface SizingRequirement {
  capability: string;
  level: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  required: number;
  external?: boolean;
}

/** Fewest vehicles of the career's own types covering every REQUIRED own need (greedy set cover); never below 1. */
export function estimateVehicles(
  requirements: readonly SizingRequirement[],
  fleetTypes: ReadonlyArray<Readonly<Record<string, number>>>,
): number {
  const needs = requirements.filter(
    (r) =>
      r.level === 'REQUIRED' &&
      !r.external &&
      r.required > 0 &&
      fleetTypes.some((t) => (t[r.capability] ?? 0) > 0),
  );
  const remaining = new Map(needs.map((r) => [r.capability, r.required]));
  const threshold = new Map(needs.map((r) => [r.capability, r.required]));
  let picks = 0;
  while ([...remaining.values()].some((left) => left > 0) && picks < 80) {
    let best: Readonly<Record<string, number>> | null = null;
    let bestGain = 0;
    for (const type of fleetTypes) {
      let gain = 0;
      for (const [capability, left] of remaining)
        if (left > 0) gain += Math.min(left, type[capability] ?? 0) / threshold.get(capability)!;
      if (gain > bestGain) {
        best = type;
        bestGain = gain;
      }
    }
    if (!best) break;
    picks += 1;
    for (const [capability, left] of remaining) remaining.set(capability, left - (best[capability] ?? 0));
  }
  return Math.max(1, picks);
}

export const mainScale = (mainVehicles: number, estimate: number, maxScale: number): number =>
  round(clamp(1, maxScale, mainVehicles / Math.max(1, estimate)), 3);
export const scaleThreshold = (threshold: number, k: number): number =>
  Math.max(1, Math.ceil(threshold * k - 1e-9));

export function splitTarget(target: number, mainShare: number): { mainVehicles: number; subBudget: number } {
  const mainVehicles = clamp(2, Math.max(2, target), Math.round(target * mainShare));
  return { mainVehicles, subBudget: Math.max(0, target - mainVehicles) };
}

/* ───────────── severity: one band beyond the level cap ───────────── */

export interface BandedTemplate {
  severity: readonly [number, number];
  bands: ReadonlyArray<{ severity: readonly [number, number]; minLevel: number }>;
}

/**
 * The main severity: usually top-heavy inside what the level may roll; with `boostChance` from the band right ABOVE the level's
 * cap ("l'unico modo in cui un giocatore di livello 8 vede un incendio con 8 mezzi"). `rand()` ∈ [0, 1).
 */
export function rollMajorSeverity(
  template: BandedTemplate,
  level: number,
  boostChance: number,
  rand: () => number,
): { severity: number; boosted: boolean } {
  const [min, max] = template.severity;
  const bands = [...template.bands].sort((a, b) => a.severity[0] - b.severity[0]);
  const reachable = bands.filter((b) => b.minLevel <= level);
  const cap = clamp(min, max, reachable.length ? Math.max(...reachable.map((b) => b.severity[1])) : min);
  const capBand = bands.find((b) => cap >= b.severity[0] && cap <= b.severity[1]);
  const low = clamp(min, cap, capBand ? capBand.severity[0] : min);
  const next = capBand ? bands.find((b) => b.severity[0] > capBand.severity[1]) : undefined;
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  if (next && rand() < boostChance) {
    const from = Math.max(next.severity[0], cap + 1);
    const to = Math.min(next.severity[1], max);
    if (from <= to) return { severity: int(from, to), boosted: true };
  }
  return { severity: Math.max(int(low, cap), int(low, cap)), boosted: false };
}

/* ───────────── scenario choice ───────────── */

export interface ScenarioConditions {
  weather: string;
  season: string;
  hourBand: string;
  weekdayType: string;
  dayPhase: string;
  temperatureC: number | null;
  events: readonly string[];
}

export function scenarioPossible(
  scenario: Pick<MajorScenario, 'onlyWhen'>,
  now: ScenarioConditions,
): boolean {
  const gate = scenario.onlyWhen;
  if (!gate) return true;
  return (
    (gate.weather ?? []).includes(now.weather) ||
    (gate.events ?? []).some((e) => now.events.includes(e)) ||
    (gate.minTemperatureC !== undefined &&
      now.temperatureC !== null &&
      now.temperatureC >= gate.minTemperatureC)
  );
}

export function scenarioWeight(scenario: MajorScenario, now: ScenarioConditions): number {
  if (!scenarioPossible(scenario, now)) return 0;
  const c = scenario.conditions;
  return (
    scenario.weight *
    (c.weather?.[now.weather] ?? 1) *
    (c.season?.[now.season] ?? 1) *
    (c.hourBand?.[now.hourBand] ?? 1) *
    (c.weekday?.[now.weekdayType] ?? 1) *
    (c.dayPhase?.[now.dayPhase] ?? 1)
  );
}

export function scenarioTrigger(
  scenario: MajorScenario,
  now: ScenarioConditions,
): { weather: string | null; event: string | null } {
  const weatherWeighs =
    (scenario.conditions.weather?.[now.weather] ?? 1) > 1 ||
    (scenario.onlyWhen?.weather ?? []).includes(now.weather);
  const event = (scenario.onlyWhen?.events ?? []).find((e) => now.events.includes(e)) ?? null;
  return { weather: weatherWeighs ? now.weather : null, event };
}

/** The main template of a scenario at this level: the highest `fromLevel` reached. */
export function mainTemplateFor(
  scenario: Pick<MajorScenario, 'mainTemplates'>,
  level: number,
): string | null {
  const reached = scenario.mainTemplates.filter((m) => m.fromLevel <= level);
  return reached.length > 0 ? reached.reduce((a, b) => (b.fromLevel > a.fromLevel ? b : a)).template : null;
}

/* ───────────── phases ───────────── */

export interface PhaseInput {
  current: MajorPhase;
  mainReached: boolean;
  /** Since the start, in the backend's real seconds (the mock: game seconds, before the demo speed). */
  secondsSinceStart: number;
  progress: number;
  mainDone: boolean;
}

/** Phases only move forward: CONTAINMENT at the first arrival (or after a while anyway), RESCUE at 35 %, SECURING at 75 %. */
export function phaseFor(input: PhaseInput, phases: MajorSettings['phases']): MajorPhase {
  if (input.current === 'ENDED') return 'ENDED';
  let target: OperationalPhase = 'ALARM';
  if (input.mainReached || input.secondsSinceStart >= phases.containmentAfterSeconds || input.mainDone)
    target = 'CONTAINMENT';
  if (target === 'CONTAINMENT' && (input.progress >= phases.rescueFromProgress || input.mainDone))
    target = 'RESCUE';
  if (target === 'RESCUE' && (input.progress >= phases.securingFromProgress || input.mainDone))
    target = 'SECURING';
  return phaseIndex(target) > phaseIndex(input.current) ? target : input.current;
}

export const phasesBetween = (from: MajorPhase, to: MajorPhase): OperationalPhase[] =>
  OPERATIONAL_PHASES.filter((p) => phaseIndex(p) > phaseIndex(from) && phaseIndex(p) <= phaseIndex(to));

/** Vehicle-equivalents a phase may spend: its share of the remaining budget over the phases still to come. */
export function phaseBudget(
  remainingBudget: number,
  phase: OperationalPhase,
  shares: MajorSettings['sizing']['phaseShares'],
): number {
  const upcoming = OPERATIONAL_PHASES.filter((p) => phaseIndex(p) >= phaseIndex(phase));
  const total = upcoming.reduce((sum, p) => sum + shares[p], 0);
  return total > 0 ? (remainingBudget * shares[phase]) / total : 0;
}

export interface SubCandidate {
  template: string;
  weight: number;
  cost: number;
}

/** Linked incidents of a phase: weighted draws while the budget lasts (a half-vehicle overshoot is fine), ≤ `maxCount`. */
export function pickSubIncidents<T extends SubCandidate>(
  candidates: readonly T[],
  budget: number,
  maxCount: number,
  rand: () => number,
): { picks: T[]; spent: number } {
  const picks: T[] = [];
  let left = budget;
  while (picks.length < maxCount && left >= 0.5) {
    const affordable = candidates.filter((c) => c.cost <= left + 0.5 && c.weight > 0);
    if (affordable.length === 0) break;
    let r = rand() * affordable.reduce((s, c) => s + c.weight, 0);
    const chosen = affordable.find((c) => (r -= c.weight) <= 0) ?? affordable.at(-1)!;
    picks.push(chosen);
    left -= chosen.cost;
  }
  return { picks, spent: budget - left };
}

/* ───────────── reinforcements ───────────── */

export interface GapRequirement {
  incidentId: string;
  capability: string;
  family: string | null;
  level: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  required: number;
  onScene: number;
  enRoute: number;
  external: boolean;
  /** Capability already supplied by reinforcement columns on this need (on scene or en route). */
  reinforced: number;
}
export interface GapItem {
  incidentId: string;
  capability: string;
  family: string | null;
  value: number;
}

/** What a column would cover now: every own REQUIRED / RECOMMENDED need minus what the committed units bring. */
export function reinforcementGap(requirements: readonly GapRequirement[]): {
  items: GapItem[];
  gapUnits: number;
  totalUnits: number;
  share: number;
} {
  const relevant = requirements.filter((r) => r.level !== 'OPTIONAL');
  const totalUnits = relevant.reduce(
    (sum, r) =>
      sum +
      (r.external ? Math.min(r.reinforced, Math.max(0, r.required)) : Math.max(0, r.required) + r.reinforced),
    0,
  );
  const items: GapItem[] = [];
  for (const r of relevant) {
    if (r.external || r.required <= 0) continue;
    const gap = Math.max(0, r.required - r.onScene - r.enRoute);
    if (gap > 0)
      items.push({ incidentId: r.incidentId, capability: r.capability, family: r.family, value: gap });
  }
  const gapUnits = items.reduce((sum, i) => sum + i.value, 0);
  return { items, gapUnits, totalUnits, share: totalUnits > 0 ? round(gapUnits / totalUnits) : 0 };
}

/** Several columns: 1 − Π(1 − share). */
export const combineShares = (shares: readonly number[]): number =>
  round(1 - shares.reduce((keep, s) => keep * (1 - clamp(0, 1, s)), 1));

/** Real seconds until a column is on scene: base + spread, slower at night / in bad weather, sooner from level 8. */
export function reinforcementEtaSeconds(
  arrival: MajorSettings['reinforcements']['arrival'],
  context: { night: boolean; weather: string; priority: boolean; priorityMultiplier: number },
  u: number,
): number {
  const base = arrival.baseSeconds + u * arrival.spreadSeconds;
  const speed = Math.max(0.25, arrival.weather[context.weather] ?? 1);
  return Math.max(
    30,
    Math.round(
      (base *
        (context.night ? arrival.nightMultiplier : 1) *
        (context.priority ? context.priorityMultiplier : 1)) /
        speed,
    ),
  );
}

/** What the career's fleet still has to bring once columns on scene cover `covered` of the (scaled) `full` need. */
export function reinforcedRequirement(
  full: number,
  covered: number,
): { required: number; external: boolean } {
  if (covered >= full) return { required: Math.max(1, full), external: true };
  return { required: Math.max(1, Math.ceil(full - covered)), external: false };
}

/* ───────────── outcome, reward, reputation, medals ───────────── */

export interface MajorResultInput {
  main: 'RESOLVED' | 'FAILED' | 'CANCELLED';
  meanCoverage: number;
  /** Seconds from the start to the first arrival on the main scene; null = nobody ever arrived. */
  responseSeconds: number | null;
  subsResolved: number;
  subsTotal: number;
}

export function majorQuality(input: MajorResultInput, reward: MajorSettings['reward']): number {
  const max = QUALITY.max;
  const coverage = clamp(0, max, input.meanCoverage);
  const target = reward.responseTargetSeconds;
  const timeliness =
    input.responseSeconds === null
      ? 0
      : input.responseSeconds <= target
        ? max
        : input.responseSeconds >= target * 3
          ? 0
          : max * (1 - (input.responseSeconds - target) / (target * 2));
  const subs = input.subsTotal > 0 ? (input.subsResolved / input.subsTotal) * max : max;
  const w = reward.weights;
  const sum = w.coverage + w.timeliness + w.subIncidents || 1;
  return round(
    clamp(
      QUALITY.min,
      max,
      (w.coverage * coverage + w.timeliness * timeliness + w.subIncidents * subs) / sum,
    ),
  );
}

export function majorOutcome(
  main: MajorResultInput['main'],
  quality: number,
  reward: MajorSettings['reward'],
): MajorOutcomeValue {
  if (main === 'CANCELLED') return 'CANCELLED';
  if (main === 'FAILED') return 'FAILURE';
  return quality >= reward.successFrom ? 'SUCCESS' : 'PARTIAL';
}

/** credits = perSize × target^sizeExponent × quality × (1 − reinforcedShare × rewardPenalty); FAILURE × failureShare. */
export function majorReward(
  input: {
    level: number;
    targetVehicles: number;
    quality: number;
    outcome: MajorOutcomeValue;
    reinforcedShare: number;
  },
  cfg: MajorSettings,
): { credits: number; xp: number } {
  const size = Math.max(1, input.targetVehicles) ** cfg.reward.sizeExponent;
  const credits = cfg.reward.credits.base + cfg.reward.credits.perLevel * input.level;
  const xp = cfg.reward.xp.base + cfg.reward.xp.perLevel * input.level;
  if (input.outcome === 'CANCELLED') return { credits: 0, xp: 0 };
  if (input.outcome === 'FAILURE')
    return { credits: Math.round(credits * size * cfg.reward.failureShare), xp: 0 };
  const keep = 1 - clamp(0, 1, input.reinforcedShare) * cfg.reinforcements.rewardPenalty;
  return {
    credits: Math.max(0, Math.round(credits * size * input.quality * keep)),
    xp: Math.max(1, Math.round(xp * size * input.quality * keep)),
  };
}

/** The bonus range shown while the major runs: quality 0.5 … 1.2 at the current reinforced share. */
export function estimatedMajorReward(
  level: number,
  target: number,
  reinforcedShare: number,
  cfg: MajorSettings,
): { min: number; max: number } {
  const at = (quality: number) =>
    majorReward({ level, targetVehicles: target, quality, outcome: 'SUCCESS', reinforcedShare }, cfg).credits;
  return { min: at(QUALITY.min), max: at(QUALITY.max) };
}

export function majorMedal(
  input: { outcome: MajorOutcomeValue; quality: number; reinforcedShare: number; growthLevel: number },
  cfg: MajorSettings,
): MajorMedalValue | null {
  if (input.outcome === 'SUCCESS')
    return input.quality >= cfg.reward.goldFrom &&
      input.reinforcedShare <= cfg.reinforcements.minGapShare &&
      input.growthLevel === 0
      ? 'GOLD'
      : 'SILVER';
  return input.outcome === 'PARTIAL' ? 'BRONZE' : null;
}

const MEDAL_RANK: Record<MajorMedalValue, number> = { BRONZE: 1, SILVER: 2, GOLD: 3 };
export const betterMedal = (a: MajorMedalValue | null, b: MajorMedalValue | null): MajorMedalValue | null =>
  !a ? b : !b ? a : MEDAL_RANK[b] > MEDAL_RANK[a] ? b : a;

/** Moving average with a weighted step: a success counts double, a partial once, a failure only half (A1). */
export function majorReputation(
  current: number,
  input: { outcome: MajorOutcomeValue; quality: number },
  cfg: MajorSettings,
): number {
  const weights = cfg.reward.reputation;
  const weight =
    input.outcome === 'SUCCESS'
      ? weights.successWeight
      : input.outcome === 'PARTIAL'
        ? weights.partialWeight
        : input.outcome === 'FAILURE'
          ? weights.failureWeight
          : 0;
  if (weight <= 0) return current;
  const target =
    input.outcome === 'FAILURE'
      ? REPUTATION.failedTarget
      : clamp(0, 100, ((input.quality - QUALITY.min) / (QUALITY.max - QUALITY.min)) * 100);
  const step = Math.min(1, REPUTATION.smoothing * weight);
  return Math.round(clamp(0, 100, current + step * (target - current)) * 100) / 100;
}

/* ───────────── requirement bars grouped by service (major.view.ts) ───────────── */

export interface GroupRow {
  incidentId: string;
  capability: string;
  family: string | null;
  level: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  required: number;
  onScene: number;
  enRoute: number;
  external: boolean;
  externalSource: string | null;
}
const FAMILY_ORDER = ['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE', 'UNG', ''];
const levelRank = (level: string): number => (level === 'REQUIRED' ? 0 : level === 'RECOMMENDED' ? 1 : 2);

/**
 * Requirement bars grouped by family (study §2.6: "barre raggruppate per servizio, non 15 righe piatte"). `reinforcedOf`
 * gives what columns bring per (incident, capability), en route and on scene.
 */
export function groupRequirements(
  rows: readonly GroupRow[],
  reinforcedOf: (incidentId: string, capability: string) => { enRoute: number; onScene: number },
): MajorGroupDto[] {
  type Acc = MajorGroupDto['capabilities'][number] & { reinforcedOnScene: number; ownOrReinforced: boolean };
  const byFamily = new Map<string, Map<string, Acc>>();
  for (const row of rows) {
    const family = row.family ?? '';
    const reinforced = reinforcedOf(row.incidentId, row.capability);
    const byReinforcement = row.external && row.externalSource === 'REINFORCEMENTS';
    const capabilities = byFamily.get(family) ?? new Map<string, Acc>();
    const current: Acc = capabilities.get(row.capability) ?? {
      capability: row.capability,
      level: row.level,
      required: 0,
      onScene: 0,
      enRoute: 0,
      reinforced: 0,
      external: true,
      reinforcedOnScene: 0,
      ownOrReinforced: false,
    };
    current.required += row.external ? 0 : row.required;
    current.onScene += row.onScene;
    current.enRoute += row.enRoute;
    current.reinforced += reinforced.enRoute + reinforced.onScene;
    current.reinforcedOnScene += reinforced.onScene;
    current.external = current.external && row.external;
    current.ownOrReinforced = current.ownOrReinforced || !row.external || byReinforcement;
    if (levelRank(row.level) < levelRank(current.level)) current.level = row.level;
    capabilities.set(row.capability, current);
    byFamily.set(family, capabilities);
  }
  const groups: MajorGroupDto[] = [];
  for (const [family, capabilities] of byFamily) {
    const list = [...capabilities.values()].sort(
      (a, b) => levelRank(a.level) - levelRank(b.level) || a.capability.localeCompare(b.capability),
    );
    const measured = list.filter((c) => c.level === 'REQUIRED' && c.ownOrReinforced);
    const coverage =
      measured.length === 0
        ? 1
        : measured.reduce(
            (sum, c) =>
              sum +
              Math.min(1, (c.onScene + c.reinforcedOnScene) / Math.max(1, c.required + c.reinforcedOnScene)),
            0,
          ) / measured.length;
    groups.push({
      family: (family || null) as MajorGroupDto['family'],
      required: list.reduce((sum, c) => sum + c.required, 0),
      onScene: list.reduce((sum, c) => sum + c.onScene, 0),
      enRoute: list.reduce((sum, c) => sum + c.enRoute, 0),
      reinforced: list.reduce((sum, c) => sum + c.reinforced, 0),
      coverage: Math.round(coverage * 10_000) / 10_000,
      capabilities: list.map(({ reinforcedOnScene: _r, ownOrReinforced: _o, ...c }) => c),
    });
  }
  return groups.sort((a, b) => FAMILY_ORDER.indexOf(a.family ?? '') - FAMILY_ORDER.indexOf(b.family ?? ''));
}

/** A point `meters` from `center` towards `bearing` (radians) — flat-earth, fine for a few kilometres. */
export function offsetPoint(
  center: readonly [number, number],
  meters: number,
  bearing: number,
): [number, number] {
  const [lng, lat] = center;
  const dLat = (meters * Math.cos(bearing)) / 111_320;
  const dLng = (meters * Math.sin(bearing)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [Math.round((lng + dLng) * 1e6) / 1e6, Math.round((lat + dLat) * 1e6) / 1e6];
}
