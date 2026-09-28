import type { z } from 'zod';
import type {
  MilestoneDto as MilestoneSchema,
  RealtimeEventType,
  ServiceFamily,
  StipendDto as StipendSchema,
} from '@/contracts';
import type { LngLat } from '@/lib/geo';
import {
  ECONOMY,
  FAMILIES,
  LEVELS,
  MILESTONES,
  VEHICLE_TYPES,
  levelRow,
  rankFor,
  resolvedFamilyLevel,
} from '../data/catalog';
import { unlockList } from '../catalog-dto';
import { MockError, iso, text, type MockCareer, type MockEngine } from '../engine';
import { domainState } from './index';
import {
  CLOSURE_MULTIPLIER,
  circlePolygon,
  closureFactor,
  computeCoverage,
  computeStipend,
  corridorPolygon,
  demoClosuresAt,
  timeContext,
  trafficLevelOf,
  trafficMultiplierOf,
  weatherAt,
  type CoverageDto,
  type CoverageFacility,
  type MockClosure,
  type StipendEstimate,
  type WeatherCode,
  type WorldContext,
} from './world-sim';

export type StipendDto = z.infer<typeof StipendSchema>;
export type MilestoneDto = z.infer<typeof MilestoneSchema>;
type StipendHistoryRow = NonNullable<StipendDto['history']>[number];

/** Scheduled action types owned by this domain. */
export const WORLD_ACTION = {
  tick: 'WORLD_TICK',
  closureEnd: 'CLOSURE_END',
  coverage: 'COVERAGE_RECOMPUTE',
  stipend: 'STIPEND',
} as const;

/** One weather / demo-closure slot = 20 game minutes. */
const SLOT_GAME_SECONDS = 1200;
/** Real seconds between a fleet/facility change and the coverage recompute (burst of events → one computation). */
const COVERAGE_DEBOUNCE_SECONDS = 2;
const HISTORY_LIMIT = 12;
/** Vehicles in these states cannot answer a call: their facility does not serve the family through them. */
const NOT_SERVING = new Set(['IN_DELIVERY', 'OUT_OF_SERVICE', 'BROKEN_DOWN', 'BEING_RECOVERED']);

interface WorldState {
  weatherOverride: { code: WeatherCode; degraded: boolean } | null;
  /** Timed closures created by QA / rules (demo and incident closures are derived, not stored). */
  closures: MockClosure[];
  /** Signature of the last world the client was told about: `world.updated` is emitted only on a real change. */
  signature: string;
  coverage: CoverageDto | null;
  coverageSignature: string;
  stipend: { lastIndex: number; history: StipendHistoryRow[] };
  milestones: {
    achieved: Record<string, string>;
    vehiclesPurchased: number;
    personnelHired: number;
    templatesResolved: string[];
    trainings: string[];
    maintenances: string[];
    patients: string[];
    facilityTypes: Record<string, string>;
    promoted: number;
  };
}

export const worldState = (career: MockCareer): WorldState =>
  domainState<WorldState>(career, 'world', () => ({
    weatherOverride: null,
    closures: [],
    signature: '',
    coverage: null,
    coverageSignature: '',
    stipend: { lastIndex: -1, history: [] },
    milestones: {
      achieved: {},
      vehiclesPurchased: 0,
      personnelHired: 0,
      templatesResolved: [],
      trainings: [],
      maintenances: [],
      patients: [],
      facilityTypes: {},
      promoted: 0,
    },
  }));

export function installWorld(engine: MockEngine): void {
  const slotMs = () => engine.dur(SLOT_GAME_SECONDS);

  /* ───────────── world context ───────────── */
  const incidentClosures = (career: MockCareer): MockClosure[] =>
    career.incidents.flatMap((incident) => {
      if (incident.status !== 'RESOLVING') return [];
      const holding = (incident.externalSupport ?? []).filter(
        (u) => u.keepsRoadClosed && u.status !== 'DONE',
      );
      if (holding.length === 0) return [];
      return [
        {
          id: `rst_${incident.id}`,
          polygon: circlePolygon(incident.position, 90),
          reasonKey: 'world.closure.EXTERNAL_SUPPORT',
          reasonParams: { address: incident.address },
          endsAt: Math.max(...holding.map((u) => Date.parse(u.completeAt))),
          kind: 'PARTIAL' as const,
          multiplier: CLOSURE_MULTIPLIER.PARTIAL,
          incidentId: incident.id,
        },
      ];
    });

  const activeClosures = (career: MockCareer): MockClosure[] => {
    const now = engine.now();
    const state = worldState(career);
    // New players meet closures only after the tutorial: the first dispatch must be as plain as possible.
    const demo = career.summary.tutorial.completed ? demoClosuresAt(now, slotMs()) : [];
    return [...demo, ...state.closures, ...incidentClosures(career)].filter(
      (c) => c.endsAt === null || c.endsAt > now,
    );
  };

  const buildWorld = (career: MockCareer, base: WorldContext): WorldContext => {
    const now = engine.now();
    const state = worldState(career);
    const time = timeContext(now, career.summary.timezone);
    const simulated = weatherAt(now, slotMs(), career.summary.timezone);
    const weather = state.weatherOverride ? { ...simulated, code: state.weatherOverride.code } : simulated;
    const trafficMultiplier = trafficMultiplierOf(time, weather.code);
    return {
      ...base,
      localTime: iso(now),
      timezone: career.summary.timezone,
      dayPhase: time.dayPhase,
      weather: {
        code: weather.code,
        temperatureC: weather.temperatureC,
        windKmh: weather.windKmh,
        degraded: state.weatherOverride?.degraded ?? false,
      },
      trafficLevel: trafficLevelOf(trafficMultiplier),
      closures: activeClosures(career).map((c) => ({
        id: c.id,
        polygon: c.polygon,
        reason: text(c.reasonKey, c.reasonParams),
        endsAt: c.endsAt === null ? null : iso(c.endsAt),
        kind: c.kind,
        multiplier: c.multiplier,
        incidentId: c.incidentId,
      })),
      hourBand: time.hourBand,
      season: time.season,
      weekdayType: time.weekdayType,
      trafficMultiplier,
      weatherCell: null,
      weatherObservedAt: iso(Math.floor(now / slotMs()) * slotMs()),
      weatherSource: 'simulated',
    };
  };
  engine.hooks.world.push(buildWorld);

  /** What the player can perceive of the world: when it changes, the client gets one `world.updated`. */
  const signatureOf = (w: WorldContext): string =>
    JSON.stringify([
      w.dayPhase,
      w.weather,
      w.trafficLevel,
      w.trafficMultiplier,
      w.hourBand,
      w.closures.map((c) => c.id),
    ]);
  const syncWorld = (career: MockCareer, force = false): void => {
    const state = worldState(career);
    state.closures = state.closures.filter((c) => c.endsAt === null || c.endsAt > engine.now());
    const world = engine.world(career);
    const signature = signatureOf(world);
    if (!force && signature === state.signature) return;
    const first = state.signature === '';
    state.signature = signature;
    // The very first computation only records the baseline: the client reads it from the snapshot.
    if (!first || force) engine.emit(career, 'world.updated', { world });
  };

  engine.hooks.travelFactor.push((career, path) => {
    // The tutorial drive is never slowed down (first-session pacing, analisi/05 §5).
    if (!career.summary.tutorial.completed) return 1;
    const world = engine.world(career);
    return (world.trafficMultiplier ?? 1) * closureFactor(path, activeClosures(career));
  });

  const ensureTick = (career: MockCareer): void => {
    if (!engine.findAction(career, [WORLD_ACTION.tick], career.summary.id)) {
      // Aligned to the next slot boundary, so weather and demo closures change exactly when the event goes out.
      // At ×1 a slot is 20 real minutes: day phase and rush hours are re-checked at least every 5 minutes anyway.
      const boundary = (Math.floor(engine.now() / slotMs()) + 1) * slotMs();
      const next = Math.min(boundary, engine.now() + 300_000);
      career.actions.push({
        id: engine.id('act'),
        type: WORLD_ACTION.tick,
        dueAt: next + 50,
        ref: career.summary.id,
      });
    }
  };
  engine.registerExecutor(WORLD_ACTION.tick, (career) => {
    syncWorld(career);
    // Rescheduled from the wall clock (never from the action's due time): after an absence there is one tick, not thousands.
    ensureTick(career);
  });
  engine.registerExecutor(WORLD_ACTION.closureEnd, (career) => syncWorld(career));

  const addClosure = (
    career: MockCareer,
    input: {
      polygon: LngLat[];
      reasonKey: string;
      reasonParams?: Record<string, string | number>;
      seconds: number | null;
      kind?: 'PARTIAL' | 'FULL';
    },
  ): MockClosure => {
    const kind = input.kind ?? 'FULL';
    const closure: MockClosure = {
      id: engine.id('rst'),
      polygon: input.polygon,
      reasonKey: input.reasonKey,
      reasonParams: input.reasonParams ?? {},
      endsAt: input.seconds === null ? null : engine.now() + engine.dur(input.seconds),
      kind,
      multiplier: CLOSURE_MULTIPLIER[kind],
      incidentId: null,
    };
    worldState(career).closures.push(closure);
    if (input.seconds !== null) engine.schedule(career, WORLD_ACTION.closureEnd, input.seconds, closure.id);
    syncWorld(career);
    return closure;
  };

  /* ───────────── coverage ───────────── */
  // Boats never count as land coverage, and a Base nautica (WATER-only) serves no land cell (D-68, coverage.service).
  const coverageFacilities = (career: MockCareer): CoverageFacility[] =>
    career.facilities
      .filter((f) => f.status === 'OPERATIONAL' && !engine.isNauticalFacility(f))
      .map((f) => ({
        id: f.id,
        position: f.position,
        families: [
          ...new Set(
            career.vehicles
              .filter(
                (v) =>
                  v.facilityId === f.id &&
                  !NOT_SERVING.has(v.status) &&
                  VEHICLE_TYPES.find((t) => t.code === v.typeCode)?.domain !== 'WATER',
              )
              .map((v) => v.family),
          ),
        ].sort() as ServiceFamily[],
      }));
  const coverageSignature = (career: MockCareer): string =>
    JSON.stringify([coverageFacilities(career), [...career.summary.unlockedFamilies].sort()]);

  const recomputeCoverage = (career: MockCareer, announce: boolean): CoverageDto => {
    const state = worldState(career);
    const coverage = computeCoverage({
      facilities: coverageFacilities(career),
      unlockedFamilies: career.summary.unlockedFamilies,
      computedAt: iso(engine.now()),
    });
    state.coverage = coverage;
    state.coverageSignature = coverageSignature(career);
    const changed = career.summary.coveragePct !== coverage.overallPct;
    career.summary = { ...career.summary, coveragePct: coverage.overallPct };
    if (announce) {
      if (changed) engine.emit(career, 'career.updated', { career: career.summary });
      // `world.updated` makes the client refetch GET /coverage and the stipend estimate.
      engine.emit(career, 'world.updated', {
        coverage: { overallPct: coverage.overallPct },
        career: career.summary,
      });
    }
    return coverage;
  };
  const checkCoverage = (career: MockCareer): void => {
    const state = worldState(career);
    if (!state.coverage) {
      recomputeCoverage(career, false);
      return;
    }
    if (state.coverageSignature === coverageSignature(career)) return;
    if (engine.findAction(career, [WORLD_ACTION.coverage], career.summary.id)) return;
    state.coverage = { ...state.coverage, stale: true };
    engine.schedule(career, WORLD_ACTION.coverage, COVERAGE_DEBOUNCE_SECONDS, career.summary.id, true);
  };
  engine.registerExecutor(WORLD_ACTION.coverage, (career) => {
    recomputeCoverage(career, true);
  });

  /* ───────────── stipend ───────────── */
  const periodMs = () => engine.dur(ECONOMY.stipend.periodSeconds);
  const createdAt = (career: MockCareer) => Date.parse(career.summary.createdAt);
  const estimateStipend = (career: MockCareer): StipendEstimate =>
    computeStipend({
      base: levelRow(career.summary.level).stipendBase,
      coveragePct: career.summary.coveragePct ?? 0,
      reputation: career.summary.reputation,
      personnelCost: engine.hooks.stipendDeductions.reduce((sum, hook) => sum + hook(career), 0),
    });
  const ensureStipend = (career: MockCareer): void => {
    if (engine.findAction(career, [WORLD_ACTION.stipend], career.summary.id)) return;
    const index = Math.floor((engine.now() - createdAt(career)) / periodMs()) + 1;
    career.actions.push({
      id: engine.id('act'),
      type: WORLD_ACTION.stipend,
      dueAt: createdAt(career) + index * periodMs(),
      ref: career.summary.id,
    });
  };
  engine.registerExecutor(WORLD_ACTION.stipend, (career, action) => {
    const state = worldState(career);
    const at = action.dueAt;
    const period = periodMs();
    const elapsedPeriods = Math.floor((at - createdAt(career)) / period + 1e-6);
    const index = Math.max(state.stipend.lastIndex + 1, elapsedPeriods);
    // D-11: the stipend keeps accruing while the player is away, up to the cap; then the chain stops until they return.
    const accruing = at - career.lastSeenAt <= ECONOMY.stipend.offlineCapPeriods * period;
    const estimate = estimateStipend(career);
    const net = accruing ? estimate.net : 0;
    state.stipend.lastIndex = index;
    state.stipend.history.unshift({
      periodKey: `p${index}`,
      status: accruing ? 'PAID' : 'SKIPPED_INACTIVE',
      net: String(net),
      base: String(estimate.base),
      coveragePct: estimate.coveragePct,
      coverageMultiplier: estimate.coverageMultiplier,
      reputationMultiplier: estimate.reputationMultiplier,
      personnelCost: String(estimate.personnelCost),
      at: iso(at),
    });
    state.stipend.history = state.stipend.history.slice(0, HISTORY_LIMIT);
    if (net > 0) {
      engine.credit(career, net, 'COVERAGE_STIPEND', true);
      career.away.stipend += net;
      engine.emit(career, 'stipend.paid', {
        periodKey: `p${index}`,
        amount: String(net),
        coveragePct: estimate.coveragePct,
        career: career.summary,
      });
      engine.notify(career, {
        category: 'ECONOMY',
        title: text('notifications.stipendPaid', { amount: net }),
        action: { kind: 'NONE', targetId: null },
      });
    }
    if (accruing) {
      let next = createdAt(career) + (elapsedPeriods + 1) * period;
      if (next <= at) next = at + period;
      career.actions.push({ id: engine.id('act'), type: WORLD_ACTION.stipend, dueAt: next, ref: action.ref });
    }
  });

  const stipendView = (career: MockCareer): StipendDto => {
    ensureStipend(career);
    const state = worldState(career);
    const estimate = estimateStipend(career);
    const period = periodMs();
    const cap = ECONOMY.stipend.offlineCapPeriods;
    const next = engine.findAction(career, [WORLD_ACTION.stipend], career.summary.id)!;
    const away = Math.max(0, engine.now() - career.lastSeenAt);
    const lastPaid = state.stipend.history.find((h) => h.status === 'PAID');
    return {
      periodSeconds: Math.round(ECONOMY.stipend.periodSeconds / engine.speed),
      nextPayoutAt: iso(next.dueAt),
      accruedPeriods: Math.min(cap, Math.floor(away / period)),
      maxAccruedPeriods: cap,
      estimate: {
        base: String(estimate.base),
        coverageMultiplier: estimate.coverageMultiplier,
        reputationMultiplier: estimate.reputationMultiplier,
        personnelCost: String(estimate.personnelCost),
        net: String(estimate.net),
      },
      lastPayout: lastPaid ? { at: lastPaid.at, net: lastPaid.net } : null,
      accrualStopsAt: iso(career.lastSeenAt + cap * period),
      coveragePct: estimate.coveragePct,
      bonusMultiplier: estimate.bonusMultiplier,
      history: state.stipend.history,
    };
  };

  /* ───────────── milestones ───────────── */
  const pushUnique = (list: string[], id: unknown): void => {
    if (typeof id === 'string' && !list.includes(id)) list.push(id);
  };
  /** Other domains announce finished trainings / maintenance / deliveries only through their realtime payloads. */
  const sniff = (career: MockCareer, type: string, payload: Record<string, unknown>): void => {
    const m = worldState(career).milestones;
    const rows = (...keys: string[]): Record<string, unknown>[] =>
      keys.flatMap((k) => {
        const value = payload[k];
        return (Array.isArray(value) ? value : value ? [value] : []).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        );
      });
    if (type === 'personnel.updated')
      for (const e of rows('enrollment', 'enrollments'))
        if (e.status === 'COMPLETED') pushUnique(m.trainings, e.id);
    if (type === 'maintenance.updated')
      for (const o of rows('order', 'orders')) if (o.status === 'COMPLETED') pushUnique(m.maintenances, o.id);
    if (type === 'patient.updated')
      for (const p of rows('patient', 'patients')) if (p.status === 'ADMITTED') pushUnique(m.patients, p.id);
  };
  engine.hooks.creditsChanged.push((career, amount, entryType) => {
    const m = worldState(career).milestones;
    if (amount >= 0) return;
    if (entryType === 'VEHICLE_PURCHASE') m.vehiclesPurchased += 1;
    if (entryType === 'PERSONNEL_HIRE') m.personnelHired += 1;
  });
  engine.hooks.incidentClosed.push((career, incident, status) => {
    if (status === 'RESOLVED')
      pushUnique(worldState(career).milestones.templatesResolved, incident.templateCode);
  });

  type Trigger = (typeof MILESTONES)[number]['trigger'] & { value?: number; minPrice?: number };
  const progressOf = (career: MockCareer, trigger: Trigger): { current: number; target: number } => {
    const m = worldState(career).milestones;
    const owned = career.vehicles.filter((v) => v.status !== 'IN_DELIVERY');
    const typeOf = (code: string) => VEHICLE_TYPES.find((t) => t.code === code);
    const activeFamilies = new Set(career.vehicles.map((v) => v.family));
    const target = trigger.count ?? trigger.value ?? 1;
    const current = ((): number => {
      switch (trigger.type) {
        case 'TUTORIAL_COMPLETED':
          return career.summary.tutorial.completed ? 1 : 0;
        case 'INCIDENTS_RESOLVED':
          return career.stats.resolved;
        case 'DISTINCT_INCIDENT_TEMPLATES_RESOLVED':
          return m.templatesResolved.length;
        case 'VEHICLES_PURCHASED':
          return m.vehiclesPurchased;
        case 'VEHICLES_OWNED':
          return owned.length;
        case 'SPECIAL_VEHICLE_OWNED':
          return owned.some((v) => (typeOf(v.typeCode)?.price ?? 0) >= (trigger.minPrice ?? 0)) ? 1 : 0;
        case 'AIR_VEHICLE_OWNED':
          return owned.filter((v) => typeOf(v.typeCode)?.movement === 'AIR').length;
        case 'PERSONNEL_HIRED':
          return m.personnelHired;
        case 'UPGRADES_BUILT':
          return career.facilities.reduce((sum, f) => sum + f.upgrades.reduce((s, u) => s + u.level, 0), 0);
        case 'FACILITIES_OWNED':
          return career.facilities.filter((f) => f.status === 'OPERATIONAL').length;
        case 'FACILITY_PROMOTED':
          return m.promoted;
        case 'TRAININGS_COMPLETED':
          return m.trainings.length;
        case 'MAINTENANCE_COMPLETED':
          return m.maintenances.length;
        case 'PATIENTS_DELIVERED':
          return m.patients.length;
        case 'COVERAGE_MIN':
          return (career.summary.coveragePct ?? 0) / 100;
        case 'REPUTATION_MIN':
          return career.summary.reputation;
        case 'FAMILY_ACTIVE':
          return trigger.family && activeFamilies.has(trigger.family as ServiceFamily) ? 1 : 0;
        case 'FAMILIES_ACTIVE':
          return [...activeFamilies].filter((f) => f !== 'UNG').length;
        default:
          return 0;
      }
    })();
    return { current, target };
  };

  /** Pays every newly reached milestone exactly once. Returns how many were granted. */
  const evaluateMilestones = (career: MockCareer): number => {
    const m = worldState(career).milestones;
    // A facility whose type changed was promoted (the facilities domain owns the process, we only count it).
    for (const f of career.facilities) {
      const known = m.facilityTypes[f.id];
      if (known && known !== f.typeCode) m.promoted += 1;
      m.facilityTypes[f.id] = f.typeCode;
    }
    let granted = 0;
    for (const milestone of MILESTONES) {
      if (m.achieved[milestone.code]) continue;
      const { current, target } = progressOf(career, milestone.trigger);
      if (current < target) continue;
      m.achieved[milestone.code] = iso(engine.now());
      granted += 1;
      // In the mock the core's tutorial bonus (ledger MILESTONE) already stands for the rewards of the milestones
      // reached while the tutorial is running: paying them again would break the first-session economy.
      const partOfTutorial =
        !career.summary.tutorial.completed || milestone.trigger.type === 'TUTORIAL_COMPLETED';
      if (partOfTutorial) continue;
      if (milestone.rewardCredits > 0) engine.credit(career, milestone.rewardCredits, 'MILESTONE');
      if (milestone.rewardXp > 0) engine.awardXp(career, milestone.rewardXp);
      engine.notify(career, {
        category: 'PROGRESSION',
        priority: 'IMPORTANT',
        title: text('notifications.world.milestone'),
        body: text(`milestone.${milestone.code}.title`),
        action: { kind: 'OPEN_PROGRESSION', targetId: null },
      });
    }
    return granted;
  };

  const milestonesView = (career: MockCareer): MilestoneDto[] => {
    const m = worldState(career).milestones;
    return [...MILESTONES]
      .sort((a, b) => a.order - b.order)
      .map((milestone) => {
        const achievedAt = m.achieved[milestone.code] ?? null;
        const progress = progressOf(career, milestone.trigger);
        return {
          code: milestone.code,
          phase: milestone.phase,
          order: milestone.order,
          title: text(`milestone.${milestone.code}.title`),
          description: text(`milestone.${milestone.code}.description`),
          rewardCredits: String(milestone.rewardCredits),
          rewardXp: String(milestone.rewardXp),
          progress: achievedAt
            ? { current: progress.target, target: progress.target }
            : { current: Math.min(progress.current, progress.target), target: progress.target },
          achieved: achievedAt !== null,
          achievedAt,
        };
      });
  };

  /* ───────────── wiring ───────────── */
  /**
   * The core loop has no "something changed" hook, and adding one call per mutation site would touch the whole engine:
   * instead every realtime event is observed AFTER it went out. Closures that follow an incident, the coverage
   * signature and the milestone triggers are all re-checked there (cheap, and idempotent by construction).
   */
  const SELF_EVENTS = new Set<string>(['world.updated', 'notification.created']);
  const emitToClient = engine.emit.bind(engine);
  let settling = false;
  engine.emit = (career: MockCareer, type: RealtimeEventType, payload: Record<string, unknown>): void => {
    emitToClient(career, type, payload);
    if (settling || SELF_EVENTS.has(type)) return;
    settling = true;
    try {
      sniff(career, type, payload);
      if (type.startsWith('incident.')) syncWorld(career);
      // A reward can level the career up, which can unlock a family, which changes coverage and other milestones.
      for (let round = 0; round < 4; round++) {
        checkCoverage(career);
        if (evaluateMilestones(career) === 0) break;
      }
    } finally {
      settling = false;
    }
  };

  engine.hooks.careerCreated.push((career) => {
    recomputeCoverage(career, false);
    syncWorld(career);
    ensureTick(career);
    ensureStipend(career);
  });
  // Older saves (created before this domain existed) and careers whose stipend chain stopped while away (D-11).
  engine.hooks.touched.push((career) => {
    checkCoverage(career);
    ensureTick(career);
    ensureStipend(career);
  });

  /* ───────────── public surface (REST handlers + QA) ───────────── */
  const api: WorldApi = {
    world: (career) => engine.world(career),
    coverage: (career) => {
      checkCoverage(career);
      return worldState(career).coverage ?? recomputeCoverage(career, false);
    },
    stipend: stipendView,
    milestones: (career) => {
      evaluateMilestones(career);
      return milestonesView(career);
    },
    progressionExtras: (career) => {
      const level = career.summary.level;
      const rank = rankFor(level);
      const upcoming = unlockList(career).filter((u) => !u.unlocked);
      const nextLevel = Math.min(...upcoming.map((u) => u.requiredLevel));
      return {
        rank: { code: rank.code, name: text(`rank.${rank.code}.name`) },
        maxLevel: LEVELS.at(-1)!.level,
        maxActiveIncidents: levelRow(level).maxActiveIncidents,
        stipendBase: String(levelRow(level).stipendBase),
        familyLevels: Object.fromEntries(
          FAMILIES.filter((f) => f.playerManaged).map((f) => [f.code, resolvedFamilyLevel(f.code)]),
        ),
        // What the very next rewarding level brings: the carrot shown next to the XP bar.
        nextUnlocks: upcoming
          .filter((u) => u.requiredLevel === nextLevel)
          .map((u) => ({ code: u.code, kind: u.kind, requiredLevel: u.requiredLevel })),
      };
    },
  };
  WORLD_APIS.set(engine, api);

  const helpers = {
    payStipend: () => {
      const career = engine.qa.career();
      ensureStipend(career);
      engine.completeNow(career, engine.findAction(career, [WORLD_ACTION.stipend], career.summary.id)!);
      engine.save();
      return worldState(career).stipend.history[0] ?? null;
    },
    setWeather: (code: WeatherCode | null, degraded = false) => {
      const career = engine.qa.career();
      worldState(career).weatherOverride = code ? { code, degraded } : null;
      syncWorld(career, true);
      engine.save();
    },
    addClosure: (opts: { street?: string; seconds?: number | null; kind?: 'PARTIAL' | 'FULL' } = {}) => {
      const career = engine.qa.career();
      const closure = addClosure(career, {
        polygon: corridorPolygon([14.2098, 42.4668], [14.2109, 42.4631], 28),
        reasonKey: 'world.closure.ROADWORKS',
        reasonParams: { street: opts.street ?? 'Via Nicola Fabrizi' },
        seconds: opts.seconds === undefined ? 1800 : opts.seconds,
        kind: opts.kind,
      });
      engine.save();
      return closure.id;
    },
    recomputeCoverage: () => {
      const career = engine.qa.career();
      const coverage = recomputeCoverage(career, true);
      engine.save();
      return coverage.overallPct;
    },
  };
  // `installQa` runs after the domains and replaces `engine.qa`: attach once it exists (works with either order).
  const attach = () => Object.assign(engine.qa, helpers);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}

export interface WorldApi {
  world: (career: MockCareer) => WorldContext;
  coverage: (career: MockCareer) => CoverageDto;
  stipend: (career: MockCareer) => StipendDto;
  milestones: (career: MockCareer) => MilestoneDto[];
  /** Additive fields of GET /progression (rank, caps, family levels, next unlocks). */
  progressionExtras: (career: MockCareer) => Record<string, unknown>;
}
/** The closures of `installWorld` stay private to their engine; the REST handlers reach them through this registry. */
const WORLD_APIS = new WeakMap<MockEngine, WorldApi>();
export function worldApiOf(engine: MockEngine): WorldApi {
  const api = WORLD_APIS.get(engine);
  if (!api) throw new MockError(500, 'INTERNAL_ERROR', 'world domain not installed');
  return api;
}
