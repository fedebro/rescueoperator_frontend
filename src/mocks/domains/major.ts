import type {
  I18nText,
  IncidentDto,
  MajorIncidentDto,
  MajorIncidentRefDto,
  MajorPhase,
  MajorReinforcementQuoteDto,
  MajorSectorDto,
  MajorTrophiesResult,
  ServiceFamily,
  VehicleDto,
} from '@/contracts';
import { haversineMeters, type LngLat } from '@/lib/geo';
import {
  FEATURES,
  INCIDENT_TEMPLATES,
  MAJOR_SCENARIOS,
  MAJOR_SETTINGS as CFG,
  VEHICLE_TYPES,
  type MajorScenario,
} from '../data/catalog';
import { INCIDENT_SPOTS } from '../data/pescara';
import { MockError, iso, text, type MockCareer, type MockEngine } from '../engine';
import type { QaHelpers } from '../qa';
import { domainState } from './index';
import {
  OPERATIONAL_PHASES,
  betterMedal,
  combineShares,
  estimateVehicles,
  estimatedMajorReward,
  groupRequirements,
  mainScale,
  mainTemplateFor,
  majorMedal,
  majorOutcome,
  majorQuality,
  majorReputation,
  majorReward,
  offsetPoint,
  phaseBudget,
  phaseFor,
  phaseIndex,
  phasesBetween,
  pickSubIncidents,
  reinforcedRequirement,
  reinforcementEtaSeconds,
  reinforcementGap,
  rollMajorSeverity,
  scaleThreshold,
  scenarioTrigger,
  scenarioWeight,
  splitTarget,
  targetVehicles,
  type MajorMedalValue,
  type MajorOutcomeValue,
  type OperationalPhase,
} from './major-math';

/**
 * Major incidents of the mock ("maxi-emergenze", D-24 [U] / D-69 [C]) — the in-browser counterpart of the backend's
 * `MajorIncidentsService` (analisi/note-agenti/major-incidents.md): a rare event sized on the career's own fleet, a MAIN scene
 * plus LINKED incidents spawned around it phase by phase (ALARM → CONTAINMENT → RESCUE → SECURING), growth instead of failure
 * when the main scene is left uncovered, external reinforcement columns ("Chiedi rinforzi") at a cost in bonus, the bonus /
 * XP / reputation step / medal at the end. Every member is a normal incident of the engine carrying `IncidentDto.major`.
 *
 * Time: the phase, growth and reinforcement timers are the backend's REAL seconds run through `engine.dur()` (the demo speed
 * compresses them like every game timer). The GENERATOR is not: its 20–40 / 45–90 minutes of on-duty play are wall-clock
 * minutes, so a fast demo (and the e2e suite) never meets an organic major by accident — `qa.startMajor()` starts one.
 * Randomness: a per-major seeded generator, never `engine.random()` (the other domains' sequences stay as they were).
 */

type Phase = MajorPhase;
interface MockMember {
  incidentId: string;
  role: 'MAIN' | 'SUB';
  cause: 'INITIAL' | 'PHASE' | 'GROWTH' | 'SECONDARY';
  phase: Phase;
  sector: number;
  templateCode: string;
  /** The last DTO once the member closed (it left the engine's incident list). */
  closed: IncidentDto | null;
  /** The scaled threshold of each own need: reinforcement columns reduce what is left of it. */
  full: Record<string, number>;
}
interface MockColumn {
  id: string;
  status: 'EN_ROUTE' | 'ON_SCENE' | 'RELEASED';
  requestedAt: number;
  arriveAt: number;
  coverageShare: number;
  items: { incidentId: string; capability: string; family: string | null; value: number }[];
}
export interface MockMajor {
  id: string;
  scenarioCode: string;
  status: 'ACTIVE' | 'ENDED';
  outcome: MajorOutcomeValue | null;
  phase: Phase;
  phaseStartedAt: number;
  history: { phase: Phase; at: number }[];
  center: LngLat;
  baseRadius: number;
  radius: number;
  address: string;
  municipality: string | null;
  mainIncidentId: string | null;
  severity: number;
  boosted: boolean;
  fleet: { operational: number; targetVehicles: number };
  trigger: { weather: string | null; event: string | null };
  scale: number;
  growthLevel: number;
  nextGrowthAt: number | null;
  members: MockMember[];
  sectors: number;
  subBudget: number;
  columns: MockColumn[];
  reinforcedShare: number;
  firstArrivalAt: number | null;
  /** Time-weighted coverage of the main scene while somebody works there (game seconds). */
  coverage: { integral: number; seconds: number; lastAt: number | null; last: number };
  level: number;
  reward: {
    credits: number | null;
    xp: number | null;
    reputationDelta: number | null;
    medal: MajorMedalValue | null;
    quality: number | null;
    notes: I18nText[];
  };
  startedAt: number;
  endedAt: number | null;
  /** State of the seeded generator of this major (mulberry32). */
  rng: number;
}
interface MockTrophy {
  medal: MajorMedalValue | null;
  handled: number;
  attempts: number;
  bestQuality: number | null;
  firstAt: number | null;
  lastAt: number | null;
}
export interface MajorDomainState {
  majors: MockMajor[];
  schedule: { playSeconds: number; dueSeconds: number | null; lastCheckAt: number | null; first: boolean };
  trophies: Record<string, MockTrophy>;
}

export const majorState = (career: MockCareer): MajorDomainState =>
  domainState<MajorDomainState>(career, 'major', () => ({
    majors: [],
    schedule: { playSeconds: 0, dueSeconds: null, lastCheckAt: null, first: true },
    trophies: {},
  }));

const CLOSED = new Set(['RESOLVED', 'FAILED', 'EXPIRED', 'CANCELLED']);
const NOT_OPERATIONAL = new Set([
  'IN_DELIVERY',
  'OUT_OF_SERVICE',
  'MAINTENANCE',
  'BROKEN_DOWN',
  'BEING_RECOVERED',
]);
const TICK_SECONDS = 5;

const hash = (value: string): number => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** mulberry32 over the major's own state: deterministic, saved with the career. */
function nextRandom(major: Pick<MockMajor, 'rng'>): number {
  major.rng = (major.rng + 0x6d2b79f5) >>> 0;
  let t = major.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const drawMinutes = (range: readonly [number, number], u: number): number =>
  Math.round((Math.min(range[0], range[1]) + u * Math.abs(range[1] - range[0])) * 60);

export interface MajorDomain {
  current(career: MockCareer): MajorIncidentDto | null;
  list(career: MockCareer, limit: number): MajorIncidentDto[];
  detail(career: MockCareer, id: string): MajorIncidentDto;
  quote(career: MockCareer, id: string): MajorReinforcementQuoteDto;
  requestReinforcements(career: MockCareer, id: string): MajorIncidentDto;
  trophies(career: MockCareer): MajorTrophiesResult;
  /** Starts a major now (QA, admin). 409 CONFLICT while one runs. */
  start(
    career: MockCareer,
    opts?: { scenarioCode?: string; severity?: number; targetVehicles?: number },
  ): MajorIncidentDto;
  /** Additive views of the major (alliances: allied columns, the aid request). Applied last in `toDto`. */
  viewHooks: ((career: MockCareer, major: MajorIncidentDto) => MajorIncidentDto)[];
}
const domains = new WeakMap<MockEngine, MajorDomain>();
export function majorOf(engine: MockEngine): MajorDomain {
  const domain = domains.get(engine);
  if (!domain) throw new Error('major domain not installed');
  return domain;
}

export function installMajor(engine: MockEngine): void {
  const typeOf = (code: string) => VEHICLE_TYPES.find((t) => t.code === code);
  const templateOf = (code: string) => INCIDENT_TEMPLATES.find((t) => t.code === code);
  const scenarioOf = (code: string): MajorScenario | undefined =>
    MAJOR_SCENARIOS.find((s) => s.code === code);
  const active = (career: MockCareer): MockMajor | undefined =>
    majorState(career).majors.find((m) => m.status === 'ACTIVE');
  const find = (career: MockCareer, id: string): MockMajor => {
    const major = majorState(career).majors.find((m) => m.id === id);
    if (!major) throw new MockError(404, 'NOT_FOUND', 'Major incident not found');
    return major;
  };
  const openIncident = (career: MockCareer, id: string | null) =>
    id ? career.incidents.find((i) => i.id === id) : undefined;
  /** The incident of a member now: live while open, its last DTO once closed. */
  const memberIncident = (career: MockCareer, member: MockMember): IncidentDto | undefined =>
    openIncident(career, member.incidentId) ?? member.closed ?? undefined;
  const text18 = (key: string, params?: Record<string, string | number>) => text(key, params);
  const scenarioText = (code: string, field: string, params?: Record<string, string | number>) =>
    text18(`major.scenario.${code}.${field}`, params);
  const enabled = () => engine.state.featureFlags.major_incidents !== false;
  const ownFamilies = (career: MockCareer) => new Set(career.summary.unlockedFamilies);
  const priorityLevel = FEATURES.find((f) => f.feature === 'PRIORITY_EXTERNAL_SUPPORT')?.requiredLevel ?? 8;

  /* ───────────── the member reference carried by every incident (`IncidentDto.major`) ───────────── */
  const refOf = (major: MockMajor, member: MockMember): MajorIncidentRefDto => ({
    id: major.id,
    scenarioCode: major.scenarioCode,
    title: scenarioText(major.scenarioCode, 'title'),
    role: member.role,
    phase: major.phase,
    mainIncidentId: major.mainIncidentId,
    sector: member.sector,
    center: major.center,
    areaRadiusMeters: Math.round(major.radius),
  });
  /** Refreshes the ref of every open member (phase / area moved) and announces it (`incident.updated`). */
  const refreshRefs = (career: MockCareer, major: MockMajor): void => {
    for (const member of major.members) {
      const incident = openIncident(career, member.incidentId);
      if (!incident) continue;
      const next = engine.patchIncident(career, incident.id, { major: refOf(major, member) });
      if (next) engine.emit(career, 'incident.updated', { incident: next });
    }
  };

  /* ───────────── the DTO (coordination view) ───────────── */
  const reinforcedIndex = (major: MockMajor) => {
    const index = new Map<string, { enRoute: number; onScene: number }>();
    for (const column of major.columns) {
      if (column.status === 'RELEASED') continue;
      for (const item of column.items) {
        const key = `${item.incidentId}:${item.capability}`;
        const entry = index.get(key) ?? { enRoute: 0, onScene: 0 };
        if (column.status === 'ON_SCENE') entry.onScene += item.value;
        else entry.enRoute += item.value;
        index.set(key, entry);
      }
    }
    return (incidentId: string, capability: string) =>
      index.get(`${incidentId}:${capability}`) ?? { enRoute: 0, onScene: 0 };
  };
  const rowsOf = (incidents: readonly IncidentDto[]) =>
    incidents.flatMap((incident) =>
      incident.requirements.map((r) => ({
        incidentId: incident.id,
        capability: r.capability,
        family: r.family ?? null,
        level: r.level,
        required: r.required,
        onScene: r.onScene,
        enRoute: r.enRoute,
        external: r.external === true,
        externalSource: r.externalSource ?? null,
      })),
    );

  const progressOf = (career: MockCareer, major: MockMajor, at = engine.now()): number => {
    const main = memberIncident(
      career,
      major.members.find((m) => m.role === 'MAIN')!,
    );
    if (!main) return 0;
    if (CLOSED.has(main.status) || main.status === 'RESOLVING') return main.status === 'RESOLVED' ? 1 : 1;
    const w = main.work;
    const elapsed = (Math.max(0, at - Date.parse(w.anchorAt)) / 1000) * engine.speed;
    const remaining = Math.max(0, w.remaining - w.ratePerSecond * elapsed);
    return w.total > 0 ? Math.min(1, Math.max(0, 1 - remaining / w.total)) : 0;
  };

  const quote = (
    career: MockCareer,
    major: MockMajor,
  ): { dto: MajorReinforcementQuoteDto; items: MockColumn['items'] } => {
    const reinforced = reinforcedIndex(major);
    const open = major.members
      .map((m) => openIncident(career, m.incidentId))
      .filter((i): i is IncidentDto => !!i && !CLOSED.has(i.status));
    const gap = reinforcementGap(
      open.flatMap((incident) =>
        incident.requirements.map((r) => {
          const col = reinforced(incident.id, r.capability);
          return {
            incidentId: incident.id,
            capability: r.capability,
            family: r.family ?? null,
            level: r.level,
            required: r.required,
            onScene: r.onScene,
            enRoute: r.enRoute,
            external: r.external === true,
            reinforced: col.enRoute + col.onScene,
          };
        }),
      ),
    );
    const committed = career.vehicles.some(
      (v) => v.incidentId !== null && open.some((i) => i.id === v.incidentId),
    );
    const blockedReason: MajorReinforcementQuoteDto['blockedReason'] =
      major.status === 'ENDED'
        ? 'MAJOR_ENDED'
        : major.columns.some((c) => c.status === 'EN_ROUTE')
          ? 'ALREADY_EN_ROUTE'
          : !committed
            ? 'NO_OWN_UNIT'
            : gap.share < CFG.reinforcements.minGapShare
              ? 'NOTHING_TO_COVER'
              : null;
    const world = engine.world(career);
    const priority = career.summary.level >= priorityLevel;
    // A stable ETA between the quote and the request: the draw is seeded by the major and its column count.
    const u = (hash(`${major.id}:${major.columns.length}`) % 10_000) / 10_000;
    const eta = reinforcementEtaSeconds(
      CFG.reinforcements.arrival,
      {
        night: world.dayPhase === 'NIGHT',
        weather: world.weather.code,
        priority,
        priorityMultiplier: CFG.reinforcements.priorityArrivalMultiplier,
      },
      u,
    );
    const shares = major.columns.filter((c) => c.status !== 'RELEASED').map((c) => c.coverageShare);
    const capabilities = new Map<string, number>();
    for (const item of gap.items)
      capabilities.set(item.capability, (capabilities.get(item.capability) ?? 0) + item.value);
    const families = [...new Set(gap.items.map((i) => i.family).filter((f): f is string => !!f))];
    return {
      items: gap.items,
      dto: {
        available: blockedReason === null,
        blockedReason,
        coverageShare: gap.share,
        rewardReductionShare:
          Math.round(combineShares([...shares, gap.share]) * CFG.reinforcements.rewardPenalty * 10_000) /
          10_000,
        // Real seconds of the demo clock (the game seconds / the demo speed), like every ETA of the mock.
        etaSeconds: Math.max(1, Math.round(eta / engine.speed)),
        priority,
        families: families as ServiceFamily[],
        capabilities: [...capabilities].map(([capability, value]) => ({ capability, value })),
      },
    };
  };

  const viewHooks: MajorDomain['viewHooks'] = [];
  const toDto = (career: MockCareer, major: MockMajor): MajorIncidentDto => {
    const reinforced = reinforcedIndex(major);
    const members = major.members
      .map((member) => ({ member, incident: memberIncident(career, member) }))
      .filter((x): x is { member: MockMember; incident: IncidentDto } => !!x.incident);
    const openMembers = members.filter((x) => !CLOSED.has(x.incident.status));
    const sectors: MajorSectorDto[] = members.map(({ member, incident }) => ({
      incidentId: incident.id,
      role: member.role,
      cause: member.cause,
      phase: member.phase,
      sector: member.sector,
      templateCode: member.templateCode,
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      position: incident.scenePosition ?? incident.position,
      distanceMeters: Math.round(haversineMeters(major.center, incident.scenePosition ?? incident.position)),
      families: incident.families,
      coverageRatio: incident.coverageRatio,
      assignedVehicleIds: CLOSED.has(incident.status)
        ? []
        : career.vehicles.filter((v) => v.incidentId === incident.id).map((v) => v.id),
      groups: groupRequirements(rowsOf([incident]), reinforced),
    }));
    const estimated = estimatedMajorReward(
      major.level,
      major.fleet.targetVehicles,
      major.reinforcedShare,
      CFG,
    );
    const dto: MajorIncidentDto = {
      id: major.id,
      scenarioCode: major.scenarioCode,
      title: scenarioText(major.scenarioCode, 'title'),
      description: scenarioText(major.scenarioCode, 'description'),
      alert: scenarioText(major.scenarioCode, 'alert', { address: major.address }),
      icon: scenarioOf(major.scenarioCode)?.icon ?? 'major-generic',
      status: major.status,
      outcome: major.outcome,
      phase: major.phase,
      phaseStartedAt: iso(major.phaseStartedAt),
      phases: OPERATIONAL_PHASES.map((phase) => {
        const reached = major.history.find((h) => h.phase === phase);
        return { phase, reached: !!reached, at: reached ? iso(reached.at) : null };
      }),
      progress: Math.round(progressOf(career, major) * 10_000) / 10_000,
      center: major.center,
      areaRadiusMeters: Math.round(major.radius),
      address: major.address,
      municipality: major.municipality,
      mainIncidentId: major.mainIncidentId,
      severity: major.severity,
      severityBoosted: major.boosted,
      fleet: major.fleet,
      trigger: {
        weather: (major.trigger.weather as MajorIncidentDto['trigger']['weather']) ?? null,
        event: major.trigger.event,
      },
      growth: {
        level: major.growthLevel,
        max: CFG.growth.maxLevel,
        nextCheckAt: major.nextGrowthAt === null ? null : iso(major.nextGrowthAt),
      },
      sectors,
      groups: groupRequirements(rowsOf(openMembers.map((x) => x.incident)), reinforced),
      reinforcements: {
        quote: quote(career, major).dto,
        requests: major.columns.map((c) => ({
          id: c.id,
          status: c.status,
          requestedAt: iso(c.requestedAt),
          arriveAt: iso(c.arriveAt),
          coverageShare: c.coverageShare,
          families: [
            ...new Set(c.items.map((i) => i.family).filter((f): f is string => !!f)),
          ] as ServiceFamily[],
          capabilities: [
            ...c.items.reduce(
              (m, i) => m.set(i.capability, (m.get(i.capability) ?? 0) + i.value),
              new Map<string, number>(),
            ),
          ].map(([capability, value]) => ({ capability, value })),
          source: text18('major.reinforcements.source'),
        })),
        reinforcedShare: major.reinforcedShare,
      },
      reward: {
        estimated: { min: String(estimated.min), max: String(estimated.max) },
        credits: major.reward.credits === null ? null : String(major.reward.credits),
        xp: major.reward.xp === null ? null : String(major.reward.xp),
        reputationDelta: major.reward.reputationDelta,
        medal: major.reward.medal,
        quality: major.reward.quality,
        notes: major.reward.notes,
      },
      startedAt: iso(major.startedAt),
      endedAt: major.endedAt === null ? null : iso(major.endedAt),
    };
    return viewHooks.reduce((d, hook) => hook(career, d), dto);
  };
  /** Every change of a major: `career.updated` carrying `{ major }` (no `career` key), like the backend. */
  const announce = (career: MockCareer, major: MockMajor) =>
    engine.emit(career, 'career.updated', { major: toDto(career, major) });

  /* ───────────── members ───────────── */
  const fleetTypes = (career: MockCareer) =>
    [...new Set(career.vehicles.map((v) => v.typeCode))].flatMap((code) => {
      const type = typeOf(code);
      return type ? [type.caps] : [];
    });
  const ownRequirements = (incident: IncidentDto) =>
    incident.requirements.map((r) => ({
      capability: r.capability,
      level: r.level,
      required: r.required,
      external: r.external === true,
    }));

  /** Expiry × multiplier and no escalation (a member grows with its major instead of failing on its own). */
  const stretchExpiry = (
    career: MockCareer,
    incidentId: string,
    multiplier: number,
  ): Partial<IncidentDto> => {
    engine.cancelActions(
      career,
      (a) => (a.type === 'INCIDENT_EXPIRE' || a.type === 'INCIDENT_ESCALATE') && a.ref === incidentId,
    );
    engine.schedule(career, 'INCIDENT_EXPIRE', 600 * multiplier, incidentId);
    const due = career.actions.find((a) => a.type === 'INCIDENT_EXPIRE' && a.ref === incidentId)!.dueAt;
    return { expiresAt: iso(due), nextEscalationAt: null, escalating: false };
  };

  /** Where a linked incident goes: 30–100 % of the area radius from the centre, with the nearest real street for its text. */
  const subPlace = (major: MockMajor): { position: LngLat; address: string } => {
    const [lo, hi] = CFG.sizing.subDistanceShare;
    const distance = major.radius * (lo + nextRandom(major) * (hi - lo));
    const position = offsetPoint(major.center, distance, nextRandom(major) * 2 * Math.PI);
    const nearest = [...INCIDENT_SPOTS].sort(
      (a, b) => haversineMeters(a.position, position) - haversineMeters(b.position, position),
    )[0];
    return { position, address: nearest?.address ?? major.address };
  };

  const createSub = (
    career: MockCareer,
    major: MockMajor,
    templateCode: string,
    cause: MockMember['cause'],
  ): boolean => {
    const template = templateOf(templateCode);
    // Only land templates the career can already get (a water linked incident is left to the backend's water placement).
    if (!template || template.water || !ownFamilies(career).has(template.primaryFamily)) return false;
    if (template.minLevel > career.summary.level) return false;
    const place = subPlace(major);
    const member: MockMember = {
      incidentId: '',
      role: 'SUB',
      cause,
      phase: major.phase,
      sector: major.sectors,
      templateCode,
      closed: null,
      full: {},
    };
    engine.spawnIncident(career, templateCode, false, {
      position: place.position,
      address: place.address,
      beforeAnnounce: (_career, incident) => {
        member.incidentId = incident.id;
        for (const r of incident.requirements) if (!r.external) member.full[r.capability] = r.required;
        engine.patchIncident(career, incident.id, {
          ...stretchExpiry(career, incident.id, CFG.incidents.subExpiryMultiplier),
          major: refOf(major, member),
        });
      },
    });
    if (!member.incidentId) return false;
    major.members.push(member);
    major.sectors += 1;
    return true;
  };

  /** A phase spends its share of the remaining budget on linked incidents of its list (≤ 4, ≤ 3 vehicles each). */
  const spawnPhaseSubs = (career: MockCareer, major: MockMajor, phase: OperationalPhase): void => {
    const scenario = scenarioOf(major.scenarioCode);
    if (!scenario) return;
    const types = fleetTypes(career);
    const candidates = (scenario.phases[phase] ?? []).flatMap((c) => {
      const template = templateOf(c.template);
      if (!template || template.water || !ownFamilies(career).has(template.primaryFamily)) return [];
      if (template.minLevel > career.summary.level) return [];
      const band = template.bands[0]!;
      const cost = Math.min(
        3,
        estimateVehicles(
          band.requirements.map((r) => ({ capability: r.capability, level: r.level, required: r.threshold })),
          types,
        ),
      );
      return [{ template: c.template, weight: c.weight, cost }];
    });
    const budget = phaseBudget(major.subBudget, phase, CFG.sizing.phaseShares);
    const { picks, spent } = pickSubIncidents(candidates, budget, CFG.sizing.maxSubsPerPhase, () =>
      nextRandom(major),
    );
    major.subBudget = Math.max(0, major.subBudget - spent);
    for (const pick of picks)
      createSub(career, major, pick.template, phase === 'ALARM' ? 'INITIAL' : 'PHASE');
  };

  /* ───────────── start ───────────── */
  const conditionsOf = (career: MockCareer) => {
    const world = engine.world(career);
    return {
      weather: world.weather.code,
      season: world.season ?? 'SUMMER',
      hourBand: world.hourBand ?? 'DAY',
      weekdayType: world.weekdayType ?? 'WEEKDAY',
      dayPhase: world.dayPhase,
      temperatureC: world.weather.temperatureC,
      events: (world.events ?? []).map((e) => e.type),
    };
  };

  const start: MajorDomain['start'] = (career, opts = {}) => {
    if (active(career)) throw new MockError(409, 'CONFLICT', 'A major incident is already running');
    const at = engine.now();
    const level = career.summary.level;
    const now = conditionsOf(career);
    const id = engine.id('mjr');
    const seed = { rng: hash(id) };
    let scenario: MajorScenario | undefined;
    if (opts.scenarioCode) {
      scenario = scenarioOf(opts.scenarioCode);
      if (!scenario) throw new MockError(404, 'NOT_FOUND', 'Unknown major scenario');
    } else {
      // Alliance-scale scenarios are fronts of an operation, never personal draws (alliances, 07 §6).
      const pool = MAJOR_SCENARIOS.filter((s) => !s.alliance)
        .map((s) => {
          const main = mainTemplateFor(s, level);
          const template = main ? templateOf(main) : undefined;
          const owned = !!template && ownFamilies(career).has(template.primaryFamily);
          return { s, weight: owned ? scenarioWeight(s, now) : 0 };
        })
        .filter((x) => x.weight > 0);
      let r = nextRandom(seed) * pool.reduce((sum, x) => sum + x.weight, 0);
      scenario = (pool.find((x) => (r -= x.weight) <= 0) ?? pool[0])?.s;
    }
    if (!scenario) throw new MockError(409, 'CONFLICT', 'No major scenario is possible for this career now');
    // A QA / admin start below a scenario's first level still gets its first main template.
    const mainCode = mainTemplateFor(scenario, level) ?? scenario.mainTemplates[0]!.template;
    const mainTemplate = templateOf(mainCode);
    if (!mainTemplate) throw new MockError(404, 'NOT_FOUND', 'Unknown main template');

    const rolled = rollMajorSeverity(mainTemplate, level, CFG.sizing.boostedBandChance, () =>
      nextRandom(seed),
    );
    const severity = opts.severity ?? rolled.severity;
    const operational = career.vehicles.filter((v) => !NOT_OPERATIONAL.has(v.status)).length;
    const target = opts.targetVehicles ?? targetVehicles(operational, CFG.sizing, nextRandom(seed));
    const { mainVehicles, subBudget } = splitTarget(target, CFG.sizing.mainShare);
    // The main scene: a free street 0.8–3 km from the headquarters (reachable, never on another incident).
    const hq = career.facilities[0]!.position;
    const used = new Set(career.incidents.map((i) => i.address));
    const spots = INCIDENT_SPOTS.filter((s) => !used.has(s.address));
    const near = spots.filter((s) => {
      const d = haversineMeters(hq, s.position);
      return d >= 800 && d <= 3000;
    });
    const pickFrom = near.length > 0 ? near : spots.length > 0 ? spots : INCIDENT_SPOTS;
    const spot = pickFrom[Math.floor(nextRandom(seed) * pickFrom.length)]!;

    const major: MockMajor = {
      id,
      scenarioCode: scenario.code,
      status: 'ACTIVE',
      outcome: null,
      phase: 'ALARM',
      phaseStartedAt: at,
      history: [{ phase: 'ALARM', at }],
      center: spot.position,
      baseRadius: scenario.areaRadiusMeters,
      radius: scenario.areaRadiusMeters,
      address: spot.address,
      municipality: null,
      mainIncidentId: null,
      severity,
      boosted: opts.severity === undefined && rolled.boosted,
      fleet: { operational, targetVehicles: target },
      trigger: scenarioTrigger(scenario, now),
      scale: 1,
      growthLevel: 0,
      nextGrowthAt: at + engine.dur(CFG.growth.firstCheckSeconds),
      members: [],
      sectors: 1,
      subBudget,
      columns: [],
      reinforcedShare: 0,
      firstArrivalAt: null,
      coverage: { integral: 0, seconds: 0, lastAt: null, last: 0 },
      level,
      reward: { credits: null, xp: null, reputationDelta: null, medal: null, quality: null, notes: [] },
      startedAt: at,
      endedAt: null,
      rng: seed.rng,
    };
    const mainMember: MockMember = {
      incidentId: '',
      role: 'MAIN',
      cause: 'INITIAL',
      phase: 'ALARM',
      sector: 0,
      templateCode: mainCode,
      closed: null,
      full: {},
    };
    engine.spawnIncident(career, mainCode, false, {
      severity,
      position: spot.position,
      address: spot.address,
      // Scaled on the fleet BEFORE `incident.created` is announced (the backend's `beforeAnnounce`).
      beforeAnnounce: (_career, incident) => {
        mainMember.incidentId = incident.id;
        major.mainIncidentId = incident.id;
        major.municipality = incident.municipality ?? null;
        const k = mainScale(
          mainVehicles,
          estimateVehicles(ownRequirements(incident), fleetTypes(career)),
          CFG.sizing.maxScale,
        );
        major.scale = k;
        const requirements = incident.requirements.map((r) =>
          r.external ? r : { ...r, required: scaleThreshold(r.required, k) },
        );
        for (const r of requirements) if (!r.external) mainMember.full[r.capability] = r.required;
        const work = k ** CFG.sizing.workScaleExponent;
        engine.patchIncident(career, incident.id, {
          requirements,
          work: {
            ...incident.work,
            total: incident.work.total * work,
            remaining: incident.work.remaining * work,
          },
          estimatedReward: incident.estimatedReward,
          ...stretchExpiry(career, incident.id, CFG.incidents.mainExpiryMultiplier),
          major: refOf(major, mainMember),
        });
      },
    });
    major.members.push(mainMember);
    majorState(career).majors = [major, ...majorState(career).majors].slice(0, 50);
    spawnPhaseSubs(career, major, 'ALARM');
    refreshRefs(career, major);
    engine.log(career, major.mainIncidentId!, 'major.started', text18('major.timeline.started'), at);
    engine.notify(career, {
      category: 'OPERATIONS',
      priority: 'CRITICAL',
      title: text18('major.notification.STARTED.title'),
      body: scenarioText(major.scenarioCode, 'alert', { address: major.address }),
      action: { kind: 'OPEN_INCIDENT', targetId: major.mainIncidentId },
    });
    announce(career, major);
    scheduleTick(career, major, at);
    engine.save();
    return toDto(career, major);
  };

  /* ───────────── phases, growth, end ───────────── */
  const scheduleTick = (career: MockCareer, major: MockMajor, at: number, seconds = TICK_SECONDS) => {
    engine.cancelActions(career, (a) => a.type === 'MAJOR_TICK' && a.ref === major.id);
    career.actions.push({
      id: engine.id('act'),
      type: 'MAJOR_TICK',
      dueAt: at + engine.dur(seconds),
      ref: major.id,
    });
  };
  const tickNow = (career: MockCareer, major: MockMajor, at: number) => {
    engine.cancelActions(career, (a) => a.type === 'MAJOR_TICK' && a.ref === major.id);
    career.actions.push({ id: engine.id('act'), type: 'MAJOR_TICK', dueAt: at, ref: major.id });
  };

  const sampleCoverage = (career: MockCareer, major: MockMajor, at: number) => {
    const main = openIncident(career, major.mainIncidentId);
    const c = major.coverage;
    if (c.lastAt !== null) {
      const seconds = (Math.max(0, at - c.lastAt) / 1000) * engine.speed;
      if (c.last > 0 || (main && main.status === 'ON_SCENE')) {
        c.integral += c.last * seconds;
        c.seconds += seconds;
      }
    }
    c.lastAt = at;
    c.last = main && main.status === 'ON_SCENE' ? main.coverageRatio : 0;
  };

  const tick = (career: MockCareer, major: MockMajor, at: number): void => {
    if (major.status !== 'ACTIVE') return;
    sampleCoverage(career, major, at);
    const mainMember = major.members.find((m) => m.role === 'MAIN');
    const main = mainMember ? memberIncident(career, mainMember) : undefined;
    let changed = false;
    let refsMoved = false;
    const mainDone = !main || CLOSED.has(main.status) || main.status === 'RESOLVING';
    const target = phaseFor(
      {
        current: major.phase,
        mainReached: major.firstArrivalAt !== null,
        secondsSinceStart: ((at - major.startedAt) / 1000) * engine.speed,
        progress: progressOf(career, major, at),
        mainDone,
      },
      CFG.phases,
    );
    if (phaseIndex(target) > phaseIndex(major.phase)) {
      for (const phase of phasesBetween(major.phase, target)) {
        major.phase = phase;
        major.phaseStartedAt = at;
        major.history.push({ phase, at });
        if (major.mainIncidentId)
          engine.log(
            career,
            major.mainIncidentId,
            `major.phase_${phase}`,
            text18(`major.timeline.phase_${phase}`),
            at,
          );
        spawnPhaseSubs(career, major, phase);
      }
      changed = true;
      refsMoved = true;
    }
    // Growth instead of failure: the main scene left uncovered widens the event (one more linked incident, +15 % area).
    if (major.nextGrowthAt !== null && at >= major.nextGrowthAt) {
      const uncovered =
        !!main && !mainDone && (main.status !== 'ON_SCENE' || main.coverageRatio < CFG.growth.coverageBelow);
      if (uncovered && major.growthLevel < CFG.growth.maxLevel) {
        major.growthLevel += 1;
        major.radius = major.baseRadius * (1 + CFG.growth.radiusStep * major.growthLevel);
        const scenario = scenarioOf(major.scenarioCode);
        const pool = (scenario?.growth ?? []).filter(
          (c) => templateOf(c.template) && !templateOf(c.template)!.water,
        );
        let r = nextRandom(major) * pool.reduce((s, c) => s + c.weight, 0);
        const pick = pool.find((c) => (r -= c.weight) <= 0) ?? pool[0];
        if (pick) createSub(career, major, pick.template, 'GROWTH');
        if (major.mainIncidentId)
          engine.log(career, major.mainIncidentId, 'major.growth', text18('major.timeline.growth'), at);
        engine.notify(career, {
          category: 'OPERATIONS',
          priority: 'IMPORTANT',
          title: text18('major.notification.GROWTH.title'),
          body: text18('major.notification.GROWTH.body'),
          action: { kind: 'OPEN_INCIDENT', targetId: major.mainIncidentId },
        });
        changed = true;
        refsMoved = true;
      }
      major.nextGrowthAt =
        major.growthLevel < CFG.growth.maxLevel && !mainDone
          ? at + engine.dur(CFG.growth.everySeconds)
          : null;
    }
    // Every member over → the end.
    const allDone = major.members.every((m) => {
      const incident = memberIncident(career, m);
      return !incident || CLOSED.has(incident.status);
    });
    if (allDone) {
      finalize(career, major, at);
      return;
    }
    if (refsMoved) refreshRefs(career, major);
    if (changed) announce(career, major);
    scheduleTick(career, major, at);
  };

  const finalize = (career: MockCareer, major: MockMajor, at: number): void => {
    const mainMember = major.members.find((m) => m.role === 'MAIN')!;
    const main = memberIncident(career, mainMember);
    const mainResult =
      main?.status === 'CANCELLED'
        ? 'CANCELLED'
        : main?.status === 'FAILED' || main?.status === 'EXPIRED'
          ? 'FAILED'
          : 'RESOLVED';
    const subs = major.members.filter((m) => m.role === 'SUB').map((m) => memberIncident(career, m));
    const meanCoverage =
      major.coverage.seconds > 0
        ? major.coverage.integral / major.coverage.seconds
        : (main?.coverageRatio ?? 0);
    const responseSeconds =
      major.firstArrivalAt === null ? null : ((major.firstArrivalAt - major.startedAt) / 1000) * engine.speed;
    const quality = majorQuality(
      {
        main: mainResult,
        meanCoverage,
        responseSeconds,
        subsResolved: subs.filter((s) => s?.status === 'RESOLVED').length,
        subsTotal: subs.length,
      },
      CFG.reward,
    );
    const outcome = majorOutcome(mainResult, quality, CFG.reward);
    const reward = majorReward(
      {
        level: career.summary.level,
        targetVehicles: major.fleet.targetVehicles,
        quality,
        outcome,
        reinforcedShare: major.reinforcedShare,
      },
      CFG,
    );
    const medal = majorMedal(
      { outcome, quality, reinforcedShare: major.reinforcedShare, growthLevel: major.growthLevel },
      CFG,
    );
    const notes: I18nText[] = [];
    if (outcome !== 'CANCELLED') {
      notes.push(
        text18(
          major.reinforcedShare > CFG.reinforcements.minGapShare
            ? 'major.note.REINFORCED'
            : 'major.note.OWN_FLEET',
        ),
      );
      if (responseSeconds !== null)
        notes.push(
          text18(
            responseSeconds <= CFG.reward.responseTargetSeconds
              ? 'major.note.FAST_RESPONSE'
              : 'major.note.SLOW_RESPONSE',
          ),
        );
      if (major.growthLevel > 0) notes.push(text18('major.note.GROWN', { count: major.growthLevel }));
      const lost = subs.filter((s) => s && s.status !== 'RESOLVED').length;
      if (lost > 0) notes.push(text18('major.note.SUBS_LOST', { count: lost }));
    }
    if (reward.credits > 0)
      engine.credit(
        career,
        reward.credits,
        'MAJOR_INCIDENT',
        false,
        text18('ledger.MAJOR_INCIDENT', {
          scenario: major.scenarioCode,
          outcome,
          quality,
          targetVehicles: major.fleet.targetVehicles,
          reinforcedShare: major.reinforcedShare,
        }),
      );
    if (reward.xp > 0) engine.awardXp(career, reward.xp);
    const before = career.summary.reputation;
    const after = majorReputation(before, { outcome, quality }, CFG);
    if (after !== before) career.summary = { ...career.summary, reputation: after };

    if (outcome !== 'CANCELLED') {
      const trophies = majorState(career).trophies;
      const trophy: MockTrophy = trophies[major.scenarioCode] ?? {
        medal: null,
        handled: 0,
        attempts: 0,
        bestQuality: null,
        firstAt: null,
        lastAt: null,
      };
      const best = betterMedal(trophy.medal, medal);
      trophies[major.scenarioCode] = {
        medal: best,
        attempts: trophy.attempts + 1,
        handled: trophy.handled + (outcome === 'SUCCESS' || outcome === 'PARTIAL' ? 1 : 0),
        bestQuality: outcome === 'FAILURE' ? trophy.bestQuality : Math.max(trophy.bestQuality ?? 0, quality),
        firstAt: trophy.firstAt ?? at,
        lastAt: at,
      };
      if (best && best !== trophy.medal)
        engine.notify(career, {
          category: 'PROGRESSION',
          priority: 'INFO',
          title: text18(`major.medal.${best}.title`),
          body: scenarioText(major.scenarioCode, 'title'),
          action: { kind: 'OPEN_PROGRESSION', targetId: null },
        });
    }
    for (const column of major.columns) column.status = 'RELEASED';
    engine.cancelActions(
      career,
      (a) => a.type === 'MAJOR_REINFORCEMENT_ARRIVE' && a.ref.startsWith(`${major.id}|`),
    );
    engine.cancelActions(career, (a) => a.type === 'MAJOR_TICK' && a.ref === major.id);
    major.status = 'ENDED';
    major.outcome = outcome;
    major.phase = 'ENDED';
    major.phaseStartedAt = at;
    major.history.push({ phase: 'ENDED', at });
    major.endedAt = at;
    major.nextGrowthAt = null;
    major.reward = {
      credits: reward.credits,
      xp: reward.xp,
      reputationDelta: Math.round((after - before) * 100) / 100,
      medal,
      quality,
      notes,
    };
    const schedule = majorState(career).schedule;
    schedule.playSeconds = 0;
    schedule.dueSeconds = drawMinutes(CFG.intervalMinutes, (hash(`${major.id}:next`) % 10_000) / 10_000);
    schedule.first = false;
    if (major.mainIncidentId)
      engine.log(career, major.mainIncidentId, 'major.ended', text18('major.timeline.ended'), at);
    if (outcome !== 'CANCELLED')
      engine.notify(career, {
        category: 'OPERATIONS',
        priority: 'IMPORTANT',
        title: text18(`major.notification.ENDED_${outcome}.title`),
        body: text18(`major.notification.ENDED_${outcome}.body`, { credits: String(reward.credits) }),
        action: { kind: 'OPEN_INCIDENT', targetId: major.mainIncidentId },
      });
    announce(career, major);
    // The snapshot's active major is gone: a normal call slowed down meanwhile may come sooner again.
    engine.scheduleSpawn(career);
  };

  engine.registerExecutor('MAJOR_TICK', (career, action) => {
    const major = majorState(career).majors.find((m) => m.id === action.ref);
    if (major) tick(career, major, action.dueAt);
  });

  /* ───────────── reinforcements ───────────── */
  const requestReinforcements: MajorDomain['requestReinforcements'] = (career, id) => {
    const major = find(career, id);
    const { dto, items } = quote(career, major);
    if (!dto.available)
      throw new MockError(409, 'CONFLICT', 'Reinforcements cannot be requested right now', {
        reason: dto.blockedReason,
      });
    const at = engine.now();
    const column: MockColumn = {
      id: engine.id('rnf'),
      status: 'EN_ROUTE',
      requestedAt: at,
      arriveAt: at + dto.etaSeconds * 1000,
      coverageShare: dto.coverageShare,
      items,
    };
    major.columns.push(column);
    career.actions.push({
      id: engine.id('act'),
      type: 'MAJOR_REINFORCEMENT_ARRIVE',
      dueAt: column.arriveAt,
      ref: `${major.id}|${column.id}`,
    });
    if (major.mainIncidentId)
      engine.log(
        career,
        major.mainIncidentId,
        'major.reinforcements_requested',
        text18('major.timeline.reinforcements_requested'),
        at,
      );
    announce(career, major);
    engine.save();
    return toDto(career, major);
  };

  /** A column on scene: each need it covers becomes what the fleet still has to bring (or external when fully covered). */
  engine.registerExecutor('MAJOR_REINFORCEMENT_ARRIVE', (career, action) => {
    const [majorId, columnId] = action.ref.split('|');
    const major = majorState(career).majors.find((m) => m.id === majorId);
    const column = major?.columns.find((c) => c.id === columnId);
    if (!major || !column || major.status !== 'ACTIVE' || column.status !== 'EN_ROUTE') return;
    const at = action.dueAt;
    column.status = 'ON_SCENE';
    major.reinforcedShare = combineShares(
      major.columns.filter((c) => c.status === 'ON_SCENE').map((c) => c.coverageShare),
    );
    const touched = new Set(column.items.map((i) => i.incidentId));
    for (const incidentId of touched) {
      const incident = openIncident(career, incidentId);
      const member = major.members.find((m) => m.incidentId === incidentId);
      if (!incident || !member) continue;
      const covered = (capability: string) =>
        major.columns
          .filter((c) => c.status === 'ON_SCENE')
          .flatMap((c) => c.items)
          .filter((i) => i.incidentId === incidentId && i.capability === capability)
          .reduce((sum, i) => sum + i.value, 0);
      const requirements = incident.requirements.map((r) => {
        const full = member.full[r.capability];
        if (full === undefined) return r;
        const next = reinforcedRequirement(full, covered(r.capability));
        return next.external
          ? { ...r, required: next.required, external: true, externalSource: 'REINFORCEMENTS' as const }
          : { ...r, required: next.required };
      });
      engine.patchIncident(career, incidentId, { requirements });
      const next = engine.recompute(career, incidentId, at);
      if (next) engine.emit(career, 'incident.updated', { incident: next });
    }
    if (major.mainIncidentId)
      engine.log(
        career,
        major.mainIncidentId,
        'major.reinforcements_arrived',
        text18('major.timeline.reinforcements_arrived'),
        at,
      );
    engine.notify(career, {
      category: 'OPERATIONS',
      priority: 'INFO',
      title: text18('major.notification.REINFORCEMENTS.title'),
      body: text18('major.notification.REINFORCEMENTS.body', {
        percent: Math.round(column.coverageShare * 100),
      }),
      action: { kind: 'OPEN_INCIDENT', targetId: major.mainIncidentId },
    });
    announce(career, major);
    tickNow(career, major, at);
  });

  /* ───────────── the generator: on-duty ACTIVE play (wall-clock minutes) ───────────── */
  const allowed = (career: MockCareer): boolean =>
    enabled() &&
    career.summary.level >= CFG.minLevel &&
    career.summary.onDuty &&
    career.summary.tutorial.completed &&
    engine.now() - career.lastSeenAt <= 180_000 &&
    career.vehicles.filter((v) => !NOT_OPERATIONAL.has(v.status)).length >= CFG.minOperationalVehicles;
  const ensureChain = (career: MockCareer): void => {
    if (!allowed(career) || career.actions.some((a) => a.type === 'MAJOR_CHECK')) return;
    const schedule = majorState(career).schedule;
    // A restarted chain never credits the gap (D-11): accrual starts now.
    schedule.lastCheckAt = engine.now();
    engine.schedule(career, 'MAJOR_CHECK', CFG.checkIntervalSeconds, career.summary.id, true);
  };
  engine.registerExecutor('MAJOR_CHECK', (career, action) => {
    const schedule = majorState(career).schedule;
    if (!allowed(career)) {
      schedule.lastCheckAt = null;
      return;
    }
    const at = action.dueAt;
    if (!active(career)) {
      const since = schedule.lastCheckAt === null ? 0 : Math.max(0, at - schedule.lastCheckAt) / 1000;
      schedule.playSeconds += Math.min(CFG.checkIntervalSeconds * 2, since);
      schedule.dueSeconds ??= drawMinutes(
        schedule.first ? CFG.firstIntervalMinutes : CFG.intervalMinutes,
        (hash(`${career.summary.id}:${majorState(career).majors.length}`) % 10_000) / 10_000,
      );
      if (schedule.playSeconds >= schedule.dueSeconds) {
        try {
          start(career);
        } catch {
          /* no scenario possible right now: try again at the next check */
        }
      }
    }
    schedule.lastCheckAt = at;
    engine.schedule(career, 'MAJOR_CHECK', CFG.checkIntervalSeconds, career.summary.id, true);
  });

  /* ───────────── engine hooks ───────────── */
  engine.hooks.touched.push((career) => ensureChain(career));
  engine.hooks.levelReached.push((career) => ensureChain(career));
  engine.hooks.vehicleArrived.push((career, _vehicle, incident, at) => {
    const major = active(career);
    if (!major || !major.members.some((m) => m.incidentId === incident.id)) return;
    if (incident.id === major.mainIncidentId && major.firstArrivalAt === null) major.firstArrivalAt = at;
    tickNow(career, major, at);
  });
  engine.hooks.incidentClosed.push((career, incident) => {
    const major = active(career);
    const member = major?.members.find((m) => m.incidentId === incident.id);
    if (!major || !member) return;
    member.closed = incident;
    tickNow(career, major, engine.now());
  });
  engine.hooks.snapshotView.push((career, snapshot) => ({
    ...snapshot,
    activeMajorIncidentId: active(career)?.id ?? null,
  }));

  const trophies: MajorDomain['trophies'] = (career) => {
    const own = majorState(career).trophies;
    const list = MAJOR_SCENARIOS.filter((s) => !s.alliance).map((s) => {
      const t = own[s.code];
      return {
        scenarioCode: s.code,
        title: scenarioText(s.code, 'title'),
        icon: s.icon,
        medal: t?.medal ?? null,
        handled: t?.handled ?? 0,
        attempts: t?.attempts ?? 0,
        bestQuality: t?.bestQuality ?? null,
        firstAt: t?.firstAt ? iso(t.firstAt) : null,
        lastAt: t?.lastAt ? iso(t.lastAt) : null,
      };
    });
    return {
      minLevel: CFG.minLevel,
      unlocked: career.summary.level >= CFG.minLevel,
      handled: list.reduce((sum, t) => sum + t.handled, 0),
      trophies: list,
    };
  };

  const domain: MajorDomain = {
    viewHooks,
    current: (career) => {
      const major = active(career);
      return major ? toDto(career, major) : null;
    },
    list: (career, limit) =>
      majorState(career)
        .majors.slice(0, limit)
        .map((m) => toDto(career, m)),
    detail: (career, id) => toDto(career, find(career, id)),
    quote: (career, id) => quote(career, find(career, id)).dto,
    requestReinforcements,
    trophies,
    start,
  };
  domains.set(engine, domain);

  /* ───────────── QA helpers (window.__rcMock.qa) ───────────── */
  const helpers = {
    /**
     * Starts a major now, deterministically: `startMajor('MAJ_RESIDENTIAL_FIRE', { targetVehicles: 12 })`. Returns its id,
     * the main scene and every member incident.
     */
    startMajor: (scenarioCode?: string, opts: { severity?: number; targetVehicles?: number } = {}) => {
      const career = engine.qa.career();
      const dto = start(career, { scenarioCode, ...opts });
      return {
        majorId: dto.id,
        mainIncidentId: dto.mainIncidentId,
        incidentIds: dto.sectors.map((s) => s.incidentId),
      };
    },
    /** The major as the client reads it (`GET /major-incidents/:id`; default: the running one, else the last). */
    major: (id?: string) => {
      const career = engine.qa.career();
      const major = id ? find(career, id) : (active(career) ?? majorState(career).majors[0]);
      return major ? toDto(career, major) : null;
    },
    /** Runs the phase / growth / end check now. */
    majorTick: () => {
      const career = engine.qa.career();
      const major = active(career);
      if (major) tick(career, major, engine.now());
      engine.save();
    },
    /** Moves the running major straight to a phase (spawning the linked incidents of every phase it enters). */
    majorPhase: (phase: OperationalPhase) => {
      const career = engine.qa.career();
      const major = active(career);
      if (!major || phaseIndex(phase) <= phaseIndex(major.phase)) return;
      const at = engine.now();
      for (const p of phasesBetween(major.phase, phase)) {
        major.phase = p;
        major.phaseStartedAt = at;
        major.history.push({ phase: p, at });
        spawnPhaseSubs(career, major, p);
      }
      refreshRefs(career, major);
      announce(career, major);
      engine.save();
    },
    /** Closes every open member (RESOLVED with its reward, or `status`) and ends the major. */
    finishMajor: (status: 'RESOLVED' | 'EXPIRED' = 'RESOLVED') => {
      const career = engine.qa.career();
      const major = active(career);
      if (!major) return null;
      const at = engine.now();
      if (major.firstArrivalAt === null && status === 'RESOLVED') major.firstArrivalAt = at;
      // Entering the last phases may add linked incidents: close whatever is open until the major is over.
      for (let round = 0; round < 6 && major.status === 'ACTIVE'; round++) {
        for (const member of major.members) {
          const incident = openIncident(career, member.incidentId);
          if (!incident) continue;
          if (status === 'RESOLVED') engine.patchIncident(career, incident.id, { coverageRatio: 1 });
          engine.close(
            career,
            career.incidents.find((i) => i.id === incident.id)!,
            status,
            at,
          );
        }
        if (status === 'RESOLVED') major.coverage = { integral: 1, seconds: 1, lastAt: at, last: 1 };
        tick(career, major, at);
      }
      engine.save();
      return toDto(career, major);
    },
    /** Generator state (play accrued, next due) — to check that nothing is generated off duty / below level 5. */
    majorSchedule: () => ({ ...majorState(engine.qa.career()).schedule }),
  };
  const attach = () => Object.assign(engine.qa, helpers as unknown as Partial<QaHelpers>);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}

/** Vehicles of a major's members, for the coordination view helpers in tests. */
export const assignedTo = (career: MockCareer, incidentId: string): VehicleDto[] =>
  career.vehicles.filter((v) => v.incidentId === incidentId);
