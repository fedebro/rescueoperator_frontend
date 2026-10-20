import type { CareerSummary, IncidentDto } from '@/contracts';

/**
 * Primo turno (D-148, study analisi/studio-2026-10-20-primi-minuti, rules analisi/brief-primo-turno): the first 5 missions of
 * a new career, the same numbers as the server (analisi/note-agenti/primo-turno-server.md) — mock = server.
 *
 * Seconds are SERVER seconds (the mock divides them by its time compression, like every other duration).
 */
export type FirstShiftLesson = NonNullable<IncidentDto['firstShift']>['lesson'];

export interface FirstShiftMission {
  mission: 1 | 2 | 3 | 4 | 5;
  lesson: FirstShiftLesson;
  /** One of these (picked with the random source when more than one). */
  templates: string[];
  severity: number;
  /** Road distance from the first station, metres. */
  distance: [number, number];
  /** Every unit of the career on scene within this many seconds of its departure order. */
  arrivalCapSeconds: number;
  /** On-scene work with the recommended units (rate 1). */
  workSeconds: number;
  /** The next call this many seconds after the outcome; null = the shift ends with this mission. */
  nextCallSeconds: number | null;
  /** Net credits of the outcome (fixed: no travel / scene costs). */
  credits: number;
  xp: number;
}

export const FIRST_SHIFT_MISSIONS: FirstShiftMission[] = [
  {
    mission: 1,
    lesson: 'RESPOND',
    templates: ['FIRE_TRASH_BIN'],
    severity: 1,
    distance: [300, 500],
    arrivalCapSeconds: 20,
    workSeconds: 15,
    nextCallSeconds: 8,
    credits: 120,
    xp: 10,
  },
  {
    mission: 2,
    lesson: 'CHOOSE_VEHICLE',
    templates: ['TECH_FALLEN_TREE'],
    severity: 1,
    distance: [400, 700],
    arrivalCapSeconds: 25,
    workSeconds: 20,
    nextCallSeconds: 10,
    credits: 140,
    xp: 10,
  },
  {
    mission: 3,
    lesson: 'MULTI_VEHICLE',
    templates: ['FIRE_VEHICLE'],
    severity: 3,
    distance: [500, 900],
    arrivalCapSeconds: 30,
    workSeconds: 30,
    // Mission 4 is born while the units of mission 3 are on their way home (their return lasts at least 45 s).
    nextCallSeconds: 3,
    credits: 180,
    xp: 15,
  },
  {
    mission: 4,
    lesson: 'REDIRECT',
    templates: ['FIRE_CHIMNEY'],
    severity: 1,
    distance: [700, 1200],
    arrivalCapSeconds: 30,
    workSeconds: 30,
    nextCallSeconds: 15,
    credits: 160,
    xp: 15,
  },
  {
    mission: 5,
    lesson: 'FREE',
    templates: ['TECH_ELEVATOR', 'TECH_WATER_LEAK'],
    severity: 1,
    distance: [1000, 1500],
    arrivalCapSeconds: 30,
    workSeconds: 40,
    nextCallSeconds: null,
    credits: 200,
    xp: 20,
  },
];

/** The units of mission 3 take at least this long to get home: mission 4 finds them RETURNING (the redirect lesson). */
export const MISSION_3_MIN_RETURN_SECONDS = 45;
/**
 * The way home after a first-shift intervention (not a recall), as the server: home before the next call rings
 * (≤ max(3, next − 2) s: missions 1, 2, 4), still on the way when mission 4 rings (mission 3: ≥ 45 s), normal after mission 5.
 */
export function firstShiftReturnSeconds(mission: number, normal: number): number {
  if (mission === 3) return Math.max(normal, MISSION_3_MIN_RETURN_SECONDS);
  const next = missionRule(mission)?.nextCallSeconds ?? null;
  return next === null ? normal : Math.min(normal, Math.max(3, next - 2));
}

/** A vehicle bought during the first shift is delivered in this many seconds (the server's `tutorialDeliverySeconds`). */
export const FIRST_SHIFT_DELIVERY_SECONDS = 20;
/** After the 5th mission: the normal generator, but for 15 minutes only calls within 2 km and of severity ≤ 2. */
export const GENTLE_PERIOD = { seconds: 15 * 60, maxDistanceMeters: 2000, maxSeverity: 2 };
/** The first call of a career whose tutorial flag is off arrives this many seconds after its creation. */
export const FIRST_CALL_SECONDS = 5;

export const missionRule = (mission: number): FirstShiftMission | undefined =>
  FIRST_SHIFT_MISSIONS.find((m) => m.mission === mission);

/** The DTO a first-shift incident carries. */
export const incidentFirstShift = (rule: FirstShiftMission): NonNullable<IncidentDto['firstShift']> => ({
  mission: rule.mission,
  lesson: rule.lesson,
  arrivalCapSeconds: rule.arrivalCapSeconds,
});

/** A call protected like the tutorial: no expiry, no escalation, no breakdowns, free fuel. */
export const isProtectedIncident = (incident: Pick<IncidentDto, 'isTutorial' | 'firstShift'>): boolean =>
  incident.isTutorial || !!incident.firstShift;

/**
 * Preparation and travel compressed proportionally so the unit is on scene within the cap (seconds from the departure order).
 * Returns the factor (≤ 1) to apply to both.
 */
export function arrivalFactor(
  capSeconds: number | undefined,
  prepSeconds: number,
  travelSeconds: number,
): number {
  if (!capSeconds) return 1;
  const total = prepSeconds + travelSeconds;
  return total > capSeconds ? capSeconds / total : 1;
}

/** Per-career simulation state of the first shift (kept next to `summary.firstShift`, which is the wire view). */
export interface MockFirstShiftState {
  /** Missions completed, 0..5. */
  completed: number;
  /** Real epoch ms of the next call (null while one is open / after the shift). */
  nextCallAt: number | null;
  /** Real epoch ms until which the gentle period lasts (set at the 5th outcome). */
  gentleUntil: number | null;
  /** The tutorial bonus is paid once (BUY_VEHICLE, skip, or when mission 3 is born). */
  bonusPaid: boolean;
  /** Departure factor per vehicle id (set at the dispatch, read at the departure). */
  factors: Record<string, number>;
  /** Measures for the admin (GET /admin/analytics/first-shift): real epoch ms. */
  startedAt?: number;
  firstCallAt?: number | null;
  finishedAt?: number | null;
  /** Normal calls received after the shift (the «6th call» measure). */
  laterCalls?: number;
  /** The tutorial was skipped before the guided part ended. */
  skipped?: boolean;
  /** The call came due while the player was off duty / away: it rings 3 s after the return. */
  callOnReturn?: boolean;
  /** Mission number of each first-shift incident by id (kept after it closes: its units' way home). */
  missions: Record<string, number>;
}

export const firstShiftView = (
  state: MockFirstShiftState,
  tutorial: CareerSummary['tutorial'],
  iso: (ms: number) => string,
): CareerSummary['firstShift'] =>
  state.completed >= 5
    ? null
    : {
        mission: Math.min(5, state.completed + 1),
        completed: state.completed,
        guided: !tutorial.completed,
        nextCallAt: state.nextCallAt === null ? null : iso(state.nextCallAt),
      };

/** The careers a report reads (structural: the mock career). */
interface ReportCareer {
  summary: Pick<CareerSummary, 'id' | 'directorName' | 'tutorial'>;
  lastSeenAt: number;
  firstShift?: MockFirstShiftState;
}

/** GET /admin/analytics/first-shift — the measures of the first shift (study §3.4), as the server computes them. */
export function firstShiftReport(
  careers: ReportCareer[],
  now: number,
  sinceDays: number,
  iso: (ms: number) => string,
) {
  const from = now - sinceDays * 86_400_000;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const rows = careers
    .filter((c) => c.firstShift?.startedAt !== undefined && c.firstShift.startedAt >= from)
    .map((c) => {
      const fs = c.firstShift!;
      const startedAt = fs.startedAt!;
      return {
        careerId: c.summary.id,
        directorName: c.summary.directorName,
        startedAt: iso(startedAt),
        firstCallSeconds:
          fs.firstCallAt === null || fs.firstCallAt === undefined
            ? null
            : Math.max(0, Math.round((fs.firstCallAt - startedAt) / 1000)),
        completed: fs.completed,
        finishedAt: fs.finishedAt ? iso(fs.finishedAt) : null,
        laterCalls: fs.laterCalls ?? 0,
        returnedNextDay: day(c.lastSeenAt) > day(startedAt),
        guided: !fs.skipped,
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const firstCalls = rows
    .map((r) => r.firstCallSeconds)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
  return {
    from: iso(from),
    to: iso(now),
    careers: rows.length,
    medianFirstCallSeconds: firstCalls.length ? firstCalls[Math.floor((firstCalls.length - 1) / 2)]! : null,
    completedByMission: FIRST_SHIFT_MISSIONS.map((m) => ({
      mission: m.mission,
      completed: rows.filter((r) => r.completed >= m.mission).length,
    })),
    finished: rows.filter((r) => r.completed >= 5).length,
    reachedSixthCall: rows.filter((r) => r.laterCalls > 0).length,
    returnedNextDay: rows.filter((r) => r.returnedNextDay).length,
    skippedTutorial: rows.filter((r) => !r.guided).length,
    recent: rows.slice(0, 50),
  };
}
