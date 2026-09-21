import type { z } from 'zod';
import type {
  CandidateDto as CandidateSchema,
  CourseDto as CourseSchema,
  DepartmentDto as DepartmentSchema,
  EnrollmentDto as EnrollmentSchema,
  FacilityDto,
  I18nText,
  PersonnelDto,
  ServiceFamily,
  TeamDto as TeamSchema,
  VehicleDto,
} from '@/contracts';
import generated from '../data/generated/catalog.json';
import {
  COURSES,
  FEATURES,
  MANAGERIAL_SCALE,
  QUALIFICATIONS,
  RAW,
  ROLES,
  VEHICLE_TYPES,
  resolvedFamilyLevel,
  type MockVehicleType,
} from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockError, iso, text, type MockCareer, type MockDispatchOption, type MockEngine } from '../engine';
import { domainState } from './index';

/**
 * Simulation of the `personnel` area (analisi/03 §5, Spec 09): individual operators with an ANCHORED fatigue value, crews drawn
 * automatically at dispatch, teams with a derived status, departments, quick hire + candidates market, training.
 * No tick: every timer is a scheduled action (ONBOARDING_DONE / REST_DONE / TRAINING_DONE follow the binding conventions table,
 * TRANSFER_DONE / INJURY_RECOVERED / CANDIDATES_REFRESH are private to this module).
 */

type CandidateDto = z.infer<typeof CandidateSchema>;
type CourseDto = z.infer<typeof CourseSchema>;
type DepartmentDto = z.infer<typeof DepartmentSchema>;
type EnrollmentDto = z.infer<typeof EnrollmentSchema>;
type TeamDto = z.infer<typeof TeamSchema>;
export type FatigueBand = PersonnelDto['fatigue']['band'];
export type CrewBlock = 'CREW_INSUFFICIENT' | 'CREW_UNQUALIFIED' | 'CREW_EXHAUSTED';
type LoadClass = 'ROUTINE' | 'MEDIUM' | 'HIGH' | 'EXTREME';

/* ───────────── catalog parameters (typed accessor over the bundled catalog) ───────────── */
interface PersonnelParameters {
  fatigue: {
    bands: { tiredFrom: number; fatiguedFrom: number; restRequiredFrom: number };
    missionLoad: Record<LoadClass, number>;
    nightMultiplier: number;
    consecutiveMissionExtra: number[];
    consecutiveWindowSeconds: number;
    passiveRecoveryPerHour: number;
    restingRecoveryPerHour: number;
    efficiencyByBand: Record<FatigueBand, number>;
  };
  injury: {
    baseRiskByLoad: Record<LoadClass, number>;
    fatigueRiskFactorByBand: Record<FatigueBand, number>;
    severityShare: { MINOR: number; MODERATE: number };
    recoverySeconds: { MINOR: number; MODERATE: number };
    maxInjuredShare: number;
  };
  candidates: {
    poolSizeBase: number;
    poolSizePerFacility: number;
    refreshSeconds: number;
    expirySeconds: number;
    extraQualificationChance: number;
    hireCostVariance: number;
  };
}
const bundled = generated as unknown as {
  personnelParameters: PersonnelParameters;
  vehicleTypes: { code: string; crew: { minCrewEfficiency?: number } }[];
};
export const PERSONNEL_PARAMETERS = bundled.personnelParameters;
const P = PERSONNEL_PARAMETERS;
const MIN_CREW_EFFICIENCY = new Map(
  bundled.vehicleTypes.map((v) => [v.code, v.crew.minCrewEfficiency ?? 0.8] as const),
);
/** Same compression as the other managerial timers of the mock catalog. */
const managerial = (seconds: number) => Math.max(10, Math.round(seconds * MANAGERIAL_SCALE));

export const TEAM_MAX_MEMBERS = 12;
export const BASE_TRAINING_SLOTS = 2;
const TRAINING_SLOTS_PER_ROOM_LEVEL = 2;
const TRANSFER_SECONDS = managerial(600);
const CANCEL_REFUND_SHARE = 0.5;
const HISTORY_LIMIT = 30;
/** Injuries never hit a brand-new career: the first hours must stay friendly (analisi/05 §7). */
const INJURY_MIN_LEVEL = 3;
const BANDS: FatigueBand[] = ['RESTED', 'TIRED', 'FATIGUED', 'REST_REQUIRED'];

export const featureLevel = (feature: string): number =>
  FEATURES.find((f) => f.feature === feature)?.requiredLevel ?? 1;

/* ───────────── state ───────────── */
interface HistoryEntry {
  at: string;
  kind: string;
  text: I18nText;
}
export interface MockOperator extends PersonnelDto {
  history: HistoryEntry[];
  injury: { severity: 'MINOR' | 'MODERATE'; recoversAt: string } | null;
  /** Return times (ms) of the latest missions: consecutive missions tire more. */
  recentMissions: number[];
}
export interface MockTeam {
  id: string;
  name: string;
  facilityId: string;
  departmentId: string | null;
  vehicleId: string | null;
  leaderId: string | null;
  memberIds: string[];
}
export interface PersonnelState {
  seeded: boolean;
  people: MockOperator[];
  teams: MockTeam[];
  departments: DepartmentDto[];
  candidates: CandidateDto[];
  nextRefreshAt: number;
  enrollments: EnrollmentDto[];
  /** vehicle id → operators on board (held from the dispatch until the vehicle is back). */
  crews: Record<string, string[]>;
  /** vehicle id → severity of the incident it was sent to (mission load class on return). */
  missions: Record<string, number>;
}

/* ───────────── pure fatigue helpers ───────────── */
export const bandOf = (value: number): FatigueBand =>
  value >= P.fatigue.bands.restRequiredFrom
    ? 'REST_REQUIRED'
    : value >= P.fatigue.bands.fatiguedFrom
      ? 'FATIGUED'
      : value >= P.fatigue.bands.tiredFrom
        ? 'TIRED'
        : 'RESTED';

export const fatigueAt = (f: PersonnelDto['fatigue'], atMs: number): number =>
  Math.min(100, Math.max(0, f.value + (f.ratePerSecond * (atMs - Date.parse(f.anchorAt))) / 1000));

export const loadClassOf = (severity: number): LoadClass =>
  severity >= 9 ? 'EXTREME' : severity >= 7 ? 'HIGH' : severity >= 4 ? 'MEDIUM' : 'ROUTINE';

const holds = (op: PersonnelDto, qualification: string, now: number): boolean =>
  op.qualifications.some(
    (q) => q.code === qualification && (q.expiresAt === null || Date.parse(q.expiresAt) > now),
  );

/* ───────────── crew selection (pure) ───────────── */
export interface CrewSelection {
  crew: MockOperator[];
  /** Required role / qualification codes that the selection could not satisfy. */
  missing: string[];
  exhausted: number;
  blocked: CrewBlock | null;
  efficiency: number;
  maxFatigueBand: FatigueBand;
}

export function crewQuality(
  type: MockVehicleType,
  crew: PersonnelDto[],
  now: number,
): { efficiency: number; maxFatigueBand: FatigueBand } {
  if (crew.length === 0) return { efficiency: 0, maxFatigueBand: 'RESTED' };
  const bands = crew.map((op) => bandOf(fatigueAt(op.fatigue, now)));
  const floor = MIN_CREW_EFFICIENCY.get(type.code) ?? 0.8;
  const span = type.crewOptimal - type.crewMin;
  const size =
    crew.length >= type.crewOptimal || span <= 0
      ? 1
      : floor + (1 - floor) * Math.max(0, (crew.length - type.crewMin) / span);
  const fatigue = bands.reduce((s, b) => s + P.fatigue.efficiencyByBand[b], 0) / bands.length;
  return {
    efficiency: Math.round(size * fatigue * 100) / 100,
    maxFatigueBand: BANDS[Math.max(...bands.map((b) => BANDS.indexOf(b)))] ?? 'RESTED',
  };
}

/**
 * Draws the crew of a vehicle from `pool` (operators based at the vehicle's facility): members of the vehicle's own team
 * first, then free operators, last the ones assigned to another vehicle's team; required roles and qualifications first,
 * then the freshest and most competent up to `target`. Operators in the REST_REQUIRED band are never drafted.
 */
export function selectCrew(
  type: MockVehicleType,
  pool: MockOperator[],
  opts: { now: number; ownTeam: ReadonlySet<string>; target: 'MIN' | 'OPTIMAL' },
): CrewSelection {
  const { now, ownTeam } = opts;
  const draftable = pool.filter(
    (op) =>
      (op.status === 'AVAILABLE' || op.status === 'ASSIGNED') &&
      (op.family === type.family || ROLES.find((r) => r.code === op.roleCode)?.family === 'SHARED'),
  );
  const fit = draftable.filter((op) => bandOf(fatigueAt(op.fatigue, now)) !== 'REST_REQUIRED');
  const exhausted = draftable.filter((op) => !fit.includes(op));
  const rank = (op: MockOperator) => (ownTeam.has(op.id) ? 0 : op.status === 'ASSIGNED' ? 2 : 1);
  const ordered = [...fit].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      fatigueAt(a.fatigue, now) - fatigueAt(b.fatigue, now) ||
      b.competence - a.competence ||
      a.id.localeCompare(b.id),
  );
  const crew: MockOperator[] = [];
  const take = (pred: (op: MockOperator) => boolean, wanted: number): number => {
    let have = crew.filter(pred).length;
    for (const op of ordered) {
      if (have >= wanted) break;
      if (crew.includes(op) || !pred(op)) continue;
      crew.push(op);
      have += 1;
    }
    return have;
  };
  const missing: string[] = [];
  const recoverable: boolean[] = [];
  for (const r of type.requiredRoles)
    if (take((op) => op.roleCode === r.role, r.count) < r.count) {
      missing.push(r.role);
      recoverable.push(exhausted.some((op) => op.roleCode === r.role));
    }
  for (const q of type.requiredQualifications)
    if (take((op) => holds(op, q.qualification, now), q.count) < q.count) {
      missing.push(q.qualification);
      recoverable.push(exhausted.some((op) => holds(op, q.qualification, now)));
    }
  take(() => true, opts.target === 'MIN' ? type.crewMin : type.crewOptimal);
  const blocked: CrewBlock | null =
    crew.length < type.crewMin
      ? crew.length + exhausted.length >= type.crewMin
        ? 'CREW_EXHAUSTED'
        : 'CREW_INSUFFICIENT'
      : missing.length > 0
        ? recoverable.every(Boolean)
          ? 'CREW_EXHAUSTED'
          : 'CREW_UNQUALIFIED'
        : null;
  return { crew, missing, exhausted: exhausted.length, blocked, ...crewQuality(type, crew, now) };
}

/* ───────────── team status (derived, pure) ───────────── */
export function deriveTeam(
  team: MockTeam,
  people: MockOperator[],
  vehicleType: MockVehicleType | null,
  now: number,
): Pick<TeamDto, 'status' | 'readiness' | 'warnings'> {
  const members = people.filter((op) => team.memberIds.includes(op.id));
  const warnings: string[] = [];
  if (members.length === 0) return { status: 'UNAVAILABLE', readiness: 0, warnings: ['NO_MEMBERS'] };
  if (!team.leaderId) warnings.push('NO_LEADER');
  const band = (op: MockOperator) => bandOf(fatigueAt(op.fatigue, now));
  const ready = members.filter(
    (op) => (op.status === 'AVAILABLE' || op.status === 'ASSIGNED') && band(op) !== 'REST_REQUIRED',
  );
  if (members.some((op) => op.status === 'INJURED')) warnings.push('INJURED_MEMBERS');
  if (members.some((op) => band(op) === 'FATIGUED' || band(op) === 'REST_REQUIRED'))
    warnings.push('FATIGUED_MEMBERS');
  const fatigueFactor =
    members.reduce((s, op) => s + P.fatigue.efficiencyByBand[band(op)], 0) / members.length;

  let requirementFactor = 1;
  let headcount = ready.length / members.length;
  let crewable = ready.length > 0;
  if (!vehicleType) warnings.push('NO_VEHICLE');
  else {
    const selection = selectCrew(vehicleType, ready, {
      now,
      ownTeam: new Set(team.memberIds),
      target: 'OPTIMAL',
    });
    const required = vehicleType.requiredRoles.length + vehicleType.requiredQualifications.length;
    requirementFactor = required === 0 ? 1 : (required - selection.missing.length) / required;
    headcount = Math.min(1, selection.crew.length / vehicleType.crewOptimal);
    crewable = selection.blocked === null;
    if (selection.crew.length < vehicleType.crewMin) warnings.push('BELOW_MIN_CREW');
    else if (selection.crew.length < vehicleType.crewOptimal) warnings.push('BELOW_OPTIMAL_CREW');
    for (const code of selection.missing)
      warnings.push(
        `${ROLES.some((r) => r.code === code) ? 'MISSING_ROLE' : 'MISSING_QUALIFICATION'}:${code}`,
      );
  }
  const readiness = Math.round(Math.max(0, headcount * requirementFactor * fatigueFactor) * 100) / 100;
  const status: TeamDto['status'] = members.some((op) => op.status === 'ON_MISSION')
    ? 'ON_MISSION'
    : !crewable
      ? members.some((op) => op.status === 'RESTING')
        ? 'RESTING'
        : 'UNAVAILABLE'
      : ready.length === members.length && !warnings.includes('BELOW_OPTIMAL_CREW')
        ? 'READY'
        : 'PARTIAL';
  return { status, readiness, warnings };
}

/* ───────────── names ───────────── */
// prettier-ignore
const FIRST_NAMES = [
  'Alessandro', 'Giulia', 'Marco', 'Francesca', 'Luca', 'Sara', 'Matteo', 'Chiara', 'Davide', 'Elena', 'Simone',
  'Martina', 'Andrea', 'Valentina', 'Stefano', 'Federica', 'Paolo', 'Silvia', 'Riccardo', 'Alessia', 'Giorgio',
  'Marta', 'Antonio', 'Laura', 'Nicola', 'Ilaria', 'Roberto', 'Elisa', 'Fabio', 'Camilla', 'Emanuele', 'Beatrice',
];
// prettier-ignore
const LAST_NAMES = [
  'Rossi', 'Bianchi', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo',
  'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana',
  'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Di Marco', 'Serra',
];

/* ───────────── the module ───────────── */
export interface PersonnelDomain {
  state(career: MockCareer): PersonnelState;
  list(career: MockCareer): PersonnelDto[];
  detail(career: MockCareer, id: string): PersonnelDto & Pick<MockOperator, 'history' | 'injury'>;
  quickHire(career: MockCareer, body: Record<string, unknown>): PersonnelDto[];
  dismiss(career: MockCareer, id: string): void;
  rest(career: MockCareer, id: string): PersonnelDto;
  transfer(career: MockCareer, id: string, facilityId: unknown): PersonnelDto;
  candidates(career: MockCareer): { candidates: CandidateDto[]; nextRefreshAt: string };
  hireCandidate(career: MockCareer, id: string, facilityId: unknown): PersonnelDto;
  teams(career: MockCareer): TeamDto[];
  createTeam(career: MockCareer, body: Record<string, unknown>): TeamDto;
  updateTeam(career: MockCareer, id: string, body: Record<string, unknown>): TeamDto;
  setTeamMembers(career: MockCareer, id: string, body: Record<string, unknown>): TeamDto;
  setTeamVehicle(career: MockCareer, id: string, vehicleId: unknown): TeamDto;
  departments(career: MockCareer): DepartmentDto[];
  createDepartment(career: MockCareer, body: Record<string, unknown>): DepartmentDto;
  training(career: MockCareer): {
    courses: CourseDto[];
    enrollments: EnrollmentDto[];
    slots: { facilityId: string; total: number; used: number }[];
  };
  enroll(career: MockCareer, body: Record<string, unknown>): EnrollmentDto[];
  cancelEnrollment(career: MockCareer, id: string): EnrollmentDto;
  staffAll(career: MockCareer): void;
}
const domains = new WeakMap<MockEngine, PersonnelDomain>();
/** The REST handlers reach the module installed on their engine through this accessor. */
export function personnelDomain(engine: MockEngine): PersonnelDomain {
  const domain = domains.get(engine);
  if (!domain) throw new Error('personnel domain not installed');
  return domain;
}

export function installPersonnel(engine: MockEngine): void {
  if (domains.has(engine)) return;

  /* ── basics ── */
  const recoveryRate = (perHour: number) => -(perHour / 3600 / MANAGERIAL_SCALE) * engine.speed;
  const rateFor = (status: PersonnelDto['status']): number =>
    status === 'ON_MISSION'
      ? 0
      : status === 'RESTING'
        ? recoveryRate(P.fatigue.restingRecoveryPerHour)
        : recoveryRate(P.fatigue.passiveRecoveryPerHour);
  const settle = (op: MockOperator, now: number, delta = 0): void => {
    const value = Math.min(100, Math.max(0, fatigueAt(op.fatigue, now) + delta));
    op.fatigue = { value, ratePerSecond: rateFor(op.status), anchorAt: iso(now), band: bandOf(value) };
  };
  const remember = (op: MockOperator, kind: string, params?: Record<string, string | number>): void => {
    op.history.unshift({
      at: iso(engine.now()),
      kind,
      text: text(`personnel.history.${kind}`, params),
    });
    op.history = op.history.slice(0, HISTORY_LIMIT);
  };
  const setStatus = (
    op: MockOperator,
    status: PersonnelDto['status'],
    busy: { reason: PersonnelDto['busyReason']; until: number | null } = { reason: null, until: null },
  ): void => {
    const now = engine.now();
    settle(op, now);
    op.status = status;
    op.busyReason = busy.reason;
    op.busyUntil = busy.until === null ? null : iso(busy.until);
    op.fatigue = { ...op.fatigue, ratePerSecond: rateFor(status) };
  };
  const toDto = (op: MockOperator): PersonnelDto => {
    const { history: _h, injury: _i, recentMissions: _r, ...dto } = op;
    void _h;
    void _i;
    void _r;
    return { ...dto, fatigue: { ...dto.fatigue, band: bandOf(fatigueAt(dto.fatigue, engine.now())) } };
  };
  const fullName = (op: { firstName: string; lastName: string }) => `${op.firstName} ${op.lastName}`;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(engine.random() * list.length) % list.length]!;

  const createOperator = (
    career: MockCareer,
    o: {
      roleCode: string;
      facility: FacilityDto;
      qualifications?: string[];
      competence?: number;
      firstName?: string;
      lastName?: string;
      costPerPeriod?: number;
      onboardingSeconds?: number;
    },
  ): MockOperator => {
    const role = ROLES.find((r) => r.code === o.roleCode);
    if (!role) throw new MockError(404, 'NOT_FOUND', 'Unknown role');
    const now = engine.now();
    const family: ServiceFamily =
      role.family === 'SHARED' ? (o.facility.family === 'SHARED' ? 'FIRE' : o.facility.family) : role.family;
    const codes = [...new Set([...role.startingQualifications, ...(o.qualifications ?? [])])];
    const onboarding = o.onboardingSeconds ?? 0;
    const op: MockOperator = {
      id: engine.id('per'),
      firstName: o.firstName ?? pick(FIRST_NAMES),
      lastName: o.lastName ?? pick(LAST_NAMES),
      roleCode: role.code,
      family,
      facilityId: o.facility.id,
      teamId: null,
      status: onboarding > 0 ? 'ONBOARDING' : 'AVAILABLE',
      competence: Math.round(o.competence ?? 30 + engine.random() * 25),
      fatigue: { value: 0, ratePerSecond: rateFor('AVAILABLE'), anchorAt: iso(now), band: 'RESTED' },
      qualifications: codes.map((code) => ({ code, obtainedAt: iso(now), expiresAt: null })),
      missions: 0,
      hiredAt: iso(now),
      busyUntil: onboarding > 0 ? iso(now + engine.dur(onboarding)) : null,
      busyReason: onboarding > 0 ? 'ONBOARDING' : null,
      costPerPeriod: String(o.costPerPeriod ?? role.costPerPeriod),
      history: [],
      injury: null,
      recentMissions: [],
    };
    state(career).people.push(op);
    remember(op, 'HIRED');
    if (onboarding > 0) engine.schedule(career, 'ONBOARDING_DONE', onboarding, op.id);
    return op;
  };

  /* ── state + seeding ── */
  function state(career: MockCareer): PersonnelState {
    const s = domainState<PersonnelState>(career, 'personnel', () => ({
      seeded: false,
      people: [],
      teams: [],
      departments: [],
      candidates: [],
      nextRefreshAt: 0,
      enrollments: [],
      crews: {},
      missions: {},
    }));
    if (!s.seeded) {
      s.seeded = true;
      seed(career);
    }
    return s;
  }
  /** Starter crew at the headquarters; saves older than this module also get a minimum crew for every owned vehicle. */
  function seed(career: MockCareer): void {
    const hq = career.facilities.find((f) => f.headquarters) ?? career.facilities[0];
    if (!hq) return;
    for (const row of RAW.starterPackage.personnel)
      for (let i = 0; i < row.count; i++)
        createOperator(career, {
          roleCode: row.role,
          facility: hq,
          qualifications: row.qualifications,
          competence: 40 + engine.random() * 15,
        });
    staffVehicles(career, 'MIN');
    publish(career);
  }

  const baseRoleOf = (family: ServiceFamily): string =>
    (ROLES.find((r) => r.family === family && !r.specialist && r.quickHire) ?? ROLES[0]!).code;

  /** Creates, already onboarded, whatever each owned vehicle still lacks (QA helper + lazy seed of old saves). */
  function staffVehicles(career: MockCareer, target: 'MIN' | 'OPTIMAL'): void {
    const s = state(career);
    const now = engine.now();
    const taken = new Set<string>(Object.values(s.crews).flat());
    for (const vehicle of career.vehicles) {
      const type = VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode);
      const facility = career.facilities.find((f) => f.id === vehicle.facilityId);
      if (!type || !facility || s.crews[vehicle.id]) continue;
      const size = target === 'MIN' ? type.crewMin : type.crewOptimal;
      const pool = () => s.people.filter((op) => op.facilityId === facility.id && !taken.has(op.id));
      const select = () => selectCrew(type, pool(), { now, ownTeam: ownTeamOf(career, vehicle.id), target });
      let selection = select();
      for (const r of type.requiredRoles) {
        const have = selection.crew.filter((op) => op.roleCode === r.role).length;
        for (let i = have; i < r.count; i++) createOperator(career, { roleCode: r.role, facility });
      }
      selection = select();
      for (let i = selection.crew.length; i < size; i++)
        createOperator(career, { roleCode: baseRoleOf(type.family), facility });
      selection = select();
      for (const q of type.requiredQualifications) {
        const lacking = selection.crew.filter((op) => !holds(op, q.qualification, now));
        const have = selection.crew.length - lacking.length;
        for (const op of lacking.slice(0, Math.max(0, q.count - have)))
          op.qualifications.push({ code: q.qualification, obtainedAt: iso(now), expiresAt: null });
      }
      for (const op of select().crew) taken.add(op.id);
    }
  }

  /* ── derived data kept in sync after every change ── */
  const ownTeamOf = (career: MockCareer, vehicleId: string): Set<string> =>
    new Set(state(career).teams.find((t) => t.vehicleId === vehicleId)?.memberIds ?? []);
  const previewFor = (career: MockCareer, vehicle: VehicleDto, type: MockVehicleType): CrewSelection => {
    const s = state(career);
    return selectCrew(
      type,
      s.people.filter((op) => op.facilityId === vehicle.facilityId),
      { now: engine.now(), ownTeam: ownTeamOf(career, vehicle.id), target: 'OPTIMAL' },
    );
  };

  /**
   * One place that re-derives everything other areas read: ASSIGNED ⇄ AVAILABLE, the PERSONNEL capacity row of the
   * facilities, `vehicle.crew.assigned`; then tells the client (`personnel.updated` also patches the snapshot).
   */
  function publish(career: MockCareer, extra: Record<string, unknown> = {}): void {
    const s = state(career);
    for (const op of s.people) {
      if (op.status !== 'AVAILABLE' && op.status !== 'ASSIGNED') continue;
      const team = s.teams.find((t) => t.id === op.teamId);
      op.status = team?.vehicleId ? 'ASSIGNED' : 'AVAILABLE';
    }
    const facilities: FacilityDto[] = [];
    career.facilities = career.facilities.map((f) => {
      const used = s.people.filter((op) => op.facilityId === f.id).length;
      const row = f.capacities.find((c) => c.domain === 'PERSONNEL');
      if (!row || (row.used === used && row.total >= used)) return f;
      const next = {
        ...f,
        capacities: f.capacities.map((c) =>
          // QA staffing may exceed the quarters: the total follows so that `used ≤ total` always holds.
          c.domain === 'PERSONNEL' ? { ...c, used, total: Math.max(c.total, used) } : c,
        ),
      };
      facilities.push(next);
      return next;
    });
    const vehicles: VehicleDto[] = [];
    for (const vehicle of career.vehicles) {
      const type = VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode);
      if (!type) continue;
      const assigned = s.crews[vehicle.id]?.length ?? previewFor(career, vehicle, type).crew.length;
      if (assigned === vehicle.crew.assigned) continue;
      const patched = engine.patchVehicle(career, vehicle.id, { crew: { ...vehicle.crew, assigned } });
      if (patched) vehicles.push(patched);
    }
    engine.emit(career, 'personnel.updated', { vehicles, facilities, ...extra });
  }

  /** Crews of vehicles that are no longer out (recalled while preparing, blocked dispatch…) go back on duty, untired. */
  const OUT = ['PREPARING', 'EN_ROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_HOSPITAL', 'RETURNING'];
  function reconcile(career: MockCareer): void {
    const s = state(career);
    let changed = false;
    for (const [vehicleId, ids] of Object.entries(s.crews)) {
      const vehicle = career.vehicles.find((v) => v.id === vehicleId);
      if (vehicle && OUT.includes(vehicle.status)) continue;
      for (const op of s.people.filter((x) => ids.includes(x.id) && x.status === 'ON_MISSION'))
        setStatus(op, 'AVAILABLE');
      delete s.crews[vehicleId];
      delete s.missions[vehicleId];
      changed = true;
    }
    if (changed) publish(career);
  }

  /* ── lookups + guards ── */
  const operator = (career: MockCareer, id: string): MockOperator => {
    const op = state(career).people.find((x) => x.id === id);
    if (!op) throw new MockError(404, 'NOT_FOUND', 'Operator not found');
    return op;
  };
  const facilityOf = (career: MockCareer, id: unknown): FacilityDto => {
    const facility = career.facilities.find((f) => f.id === id);
    if (!facility) throw new MockError(404, 'NOT_FOUND', 'Facility not found');
    return facility;
  };
  const requireFeature = (career: MockCareer, feature: string): void => {
    const requiredLevel = featureLevel(feature);
    if (career.summary.level < requiredLevel)
      throw new MockError(422, 'LEVEL_TOO_LOW', `${feature} unlocks at level ${requiredLevel}`, {
        requiredLevel,
        feature,
      });
  };
  const requireRoom = (career: MockCareer, facility: FacilityDto, count: number): void => {
    if (facility.status !== 'OPERATIONAL')
      throw new MockError(422, 'INVALID_STATE_TRANSITION', 'Facility is not operational');
    const row = facility.capacities.find((c) => c.domain === 'PERSONNEL');
    const used = state(career).people.filter((op) => op.facilityId === facility.id).length;
    if (!row || row.total - used < count)
      throw new MockError(422, 'CAPACITY_EXCEEDED', 'No room for more operators in this facility', {
        domain: 'PERSONNEL',
        free: Math.max(0, (row?.total ?? 0) - used),
      });
  };
  const requireRole = (career: MockCareer, roleCode: unknown, facility: FacilityDto) => {
    const role = ROLES.find((r) => r.code === roleCode);
    if (!role) throw new MockError(404, 'NOT_FOUND', 'Unknown role');
    if (role.family !== 'SHARED' && !career.summary.unlockedFamilies.includes(role.family))
      throw new MockError(422, 'NOT_UNLOCKED', 'Family not unlocked', {
        requiredLevel: resolvedFamilyLevel(role.family),
      });
    if (role.requiredLevel > career.summary.level)
      throw new MockError(422, 'LEVEL_TOO_LOW', 'Level too low', { requiredLevel: role.requiredLevel });
    if (role.family !== 'SHARED' && facility.family !== 'SHARED' && facility.family !== role.family)
      throw new MockError(422, 'VALIDATION_ERROR', 'This role cannot be based at this facility', {
        reason: 'FAMILY_MISMATCH',
      });
    return role;
  };
  const leaveTeam = (career: MockCareer, op: MockOperator): void => {
    for (const team of state(career).teams) {
      if (!team.memberIds.includes(op.id)) continue;
      team.memberIds = team.memberIds.filter((id) => id !== op.id);
      if (team.leaderId === op.id) team.leaderId = null;
    }
    op.teamId = null;
  };
  const idle = (op: MockOperator) => op.status === 'AVAILABLE' || op.status === 'ASSIGNED';

  /* ── hiring ── */
  function quickHire(career: MockCareer, body: Record<string, unknown>): PersonnelDto[] {
    const count = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > 10)
      throw new MockError(422, 'VALIDATION_ERROR', 'count must be between 1 and 10');
    const facility = facilityOf(career, body.facilityId);
    const role = requireRole(career, body.roleCode, facility);
    if (!role.quickHire)
      throw new MockError(422, 'VALIDATION_ERROR', 'Specialists are hired from the candidates market', {
        reason: 'NOT_QUICK_HIRE',
      });
    requireRoom(career, facility, count);
    engine.credit(
      career,
      -role.hireCost * count,
      'PERSONNEL_HIRE',
      false,
      text('ledger.PERSONNEL_HIRE', { item: role.code, count }),
    );
    const hired = Array.from({ length: count }, () =>
      createOperator(career, { roleCode: role.code, facility, onboardingSeconds: role.onboardingSeconds }),
    );
    publish(career, { career: career.summary });
    return hired.map(toDto);
  }

  function generateCandidate(career: MockCareer): CandidateDto | null {
    const level = career.summary.level;
    const roles = ROLES.filter(
      (r) =>
        r.requiredLevel <= level &&
        (r.family === 'SHARED' || career.summary.unlockedFamilies.includes(r.family)),
    );
    // Specialists are the point of the market; base roles appear with better competence and extra qualifications.
    const weighted = roles.flatMap((r) => (r.specialist ? [r, r, r] : [r]));
    if (weighted.length === 0) return null;
    const role = pick(weighted);
    const roll = engine.random();
    const potential: CandidateDto['potential'] =
      roll < 0.05 ? 'EXCEPTIONAL' : roll < 0.3 ? 'PROMISING' : 'STANDARD';
    const extras = QUALIFICATIONS.filter(
      (q) =>
        q.roles.includes(role.code) &&
        !role.startingQualifications.includes(q.code) &&
        (COURSES.find((c) => c.grants === q.code)?.requiredLevel ?? 99) <= level + 3,
    ).filter(() => engine.random() < P.candidates.extraQualificationChance);
    const extraCost = extras.reduce(
      (sum, q) => sum + (COURSES.find((c) => c.grants === q.code)?.cost ?? 0) * 0.4,
      0,
    );
    const variance = 1 + (engine.random() * 2 - 1) * P.candidates.hireCostVariance;
    const premium = { STANDARD: 1, PROMISING: 1.25, EXCEPTIONAL: 1.6 }[potential];
    const family: ServiceFamily =
      role.family === 'SHARED' ? (career.summary.unlockedFamilies[0] ?? 'FIRE') : role.family;
    return {
      id: engine.id('cnd'),
      firstName: pick(FIRST_NAMES),
      lastName: pick(LAST_NAMES),
      roleCode: role.code,
      family,
      competence: Math.round(
        45 + engine.random() * 30 + (potential === 'EXCEPTIONAL' ? 12 : potential === 'PROMISING' ? 5 : 0),
      ),
      qualifications: [...role.startingQualifications, ...extras.map((q) => q.code)],
      potential,
      hireCost: String(Math.round((role.hireCost * variance * premium + extraCost) / 5) * 5),
      costPerPeriod: String(role.costPerPeriod + (potential === 'STANDARD' ? 0 : 1)),
      onboardingSeconds: Math.round(role.onboardingSeconds / engine.speed),
      expiresAt: iso(engine.now() + engine.dur(managerial(P.candidates.expirySeconds))),
    };
  }
  /** The pool only ever renews with TIME (analisi/05 §7: no purchasable random mechanics). */
  function refreshCandidates(career: MockCareer): void {
    const s = state(career);
    const now = engine.now();
    const size = P.candidates.poolSizeBase + P.candidates.poolSizePerFacility * career.facilities.length;
    // Half of the still-valid candidates stay, so a refresh never wipes the one the player was saving for.
    const kept = s.candidates.filter((c) => Date.parse(c.expiresAt) > now).slice(0, Math.floor(size / 2));
    const fresh: CandidateDto[] = [];
    for (let i = kept.length; i < size; i++) {
      const candidate = generateCandidate(career);
      if (candidate) fresh.push(candidate);
    }
    s.candidates = [...kept, ...fresh];
    const seconds = managerial(P.candidates.refreshSeconds);
    s.nextRefreshAt = now + engine.dur(seconds);
    engine.cancelActions(career, (a) => a.type === 'CANDIDATES_REFRESH');
    engine.schedule(career, 'CANDIDATES_REFRESH', seconds, career.summary.id);
  }
  function candidates(career: MockCareer) {
    const s = state(career);
    if (!engine.findAction(career, ['CANDIDATES_REFRESH'], career.summary.id)) refreshCandidates(career);
    const now = engine.now();
    return {
      candidates: s.candidates.filter((c) => Date.parse(c.expiresAt) > now),
      nextRefreshAt: iso(s.nextRefreshAt),
    };
  }
  function hireCandidate(career: MockCareer, id: string, facilityId: unknown): PersonnelDto {
    const s = state(career);
    const candidate = s.candidates.find((c) => c.id === id);
    if (!candidate || Date.parse(candidate.expiresAt) <= engine.now())
      throw new MockError(404, 'NOT_FOUND', 'Candidate no longer available');
    const facility = facilityOf(career, facilityId);
    const role = requireRole(career, candidate.roleCode, facility);
    requireRoom(career, facility, 1);
    engine.credit(
      career,
      -Number(candidate.hireCost),
      'PERSONNEL_HIRE',
      false,
      text('ledger.PERSONNEL_HIRE', { item: role.code, count: 1 }),
    );
    s.candidates = s.candidates.filter((c) => c.id !== id);
    const op = createOperator(career, {
      roleCode: role.code,
      facility,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      competence: candidate.competence,
      qualifications: candidate.qualifications,
      costPerPeriod: Number(candidate.costPerPeriod),
      onboardingSeconds: role.onboardingSeconds,
    });
    publish(career, { career: career.summary });
    return toDto(op);
  }

  /* ── operator commands ── */
  function dismiss(career: MockCareer, id: string): void {
    const s = state(career);
    const op = operator(career, id);
    if (['ON_MISSION', 'TRAINING', 'TRANSFERRING'].includes(op.status))
      throw new MockError(409, 'INVALID_STATE_TRANSITION', 'Operator is busy and cannot be dismissed now');
    leaveTeam(career, op);
    engine.cancelActions(career, (a) => a.ref === op.id);
    s.people = s.people.filter((x) => x.id !== op.id);
    publish(career);
  }
  function rest(career: MockCareer, id: string): PersonnelDto {
    const op = operator(career, id);
    const now = engine.now();
    const value = fatigueAt(op.fatigue, now);
    if (!idle(op) || value < 5)
      throw new MockError(409, 'INVALID_STATE_TRANSITION', 'Operator cannot rest now', {
        status: op.status,
      });
    const perGameSecond = P.fatigue.restingRecoveryPerHour / 3600 / MANAGERIAL_SCALE;
    const seconds = Math.max(20, Math.ceil(value / perGameSecond));
    setStatus(op, 'RESTING', { reason: 'REST', until: now + engine.dur(seconds) });
    engine.schedule(career, 'REST_DONE', seconds, op.id);
    remember(op, 'REST_STARTED');
    publish(career);
    return toDto(op);
  }
  function transfer(career: MockCareer, id: string, facilityId: unknown): PersonnelDto {
    const op = operator(career, id);
    const destination = facilityOf(career, facilityId);
    if (!idle(op) || destination.id === op.facilityId)
      throw new MockError(409, 'INVALID_STATE_TRANSITION', 'Operator cannot be transferred now', {
        status: op.status,
      });
    requireRole(career, op.roleCode, destination);
    requireRoom(career, destination, 1);
    leaveTeam(career, op);
    // The bed at the destination is reserved from now on, so two transfers can never overbook it.
    op.facilityId = destination.id;
    setStatus(op, 'TRANSFERRING', {
      reason: 'TRANSFER',
      until: engine.now() + engine.dur(TRANSFER_SECONDS),
    });
    engine.schedule(career, 'TRANSFER_DONE', TRANSFER_SECONDS, op.id);
    remember(op, 'TRANSFER_STARTED', { facility: destination.name });
    publish(career);
    return toDto(op);
  }

  /* ── teams & departments ── */
  const teamDto = (career: MockCareer, team: MockTeam): TeamDto => {
    const vehicle = career.vehicles.find((v) => v.id === team.vehicleId);
    const type = vehicle ? (VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode) ?? null) : null;
    return { ...team, ...deriveTeam(team, state(career).people, type, engine.now()) };
  };
  const teamOf = (career: MockCareer, id: string): MockTeam => {
    const team = state(career).teams.find((t) => t.id === id);
    if (!team) throw new MockError(404, 'NOT_FOUND', 'Team not found');
    return team;
  };
  const validName = (value: unknown, max: number): string => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name.length < 2 || name.length > max)
      throw new MockError(422, 'VALIDATION_ERROR', 'Invalid name', { fields: ['name'] });
    return name;
  };
  const departmentIdOf = (career: MockCareer, value: unknown, facilityId: string): string | null => {
    if (value === null || value === undefined) return null;
    requireFeature(career, 'DEPARTMENTS');
    const department = state(career).departments.find((d) => d.id === value);
    if (!department || department.facilityId !== facilityId)
      throw new MockError(422, 'VALIDATION_ERROR', 'Department does not belong to this facility', {
        fields: ['departmentId'],
      });
    return department.id;
  };
  function createTeam(career: MockCareer, body: Record<string, unknown>): TeamDto {
    requireFeature(career, 'TEAMS');
    const facility = facilityOf(career, body.facilityId);
    const team: MockTeam = {
      id: engine.id('tem'),
      name: validName(body.name, 40),
      facilityId: facility.id,
      departmentId: departmentIdOf(career, body.departmentId, facility.id),
      vehicleId: null,
      leaderId: null,
      memberIds: [],
    };
    state(career).teams.push(team);
    publish(career);
    return teamDto(career, team);
  }
  function updateTeam(career: MockCareer, id: string, body: Record<string, unknown>): TeamDto {
    const team = teamOf(career, id);
    if (body.name !== undefined) team.name = validName(body.name, 40);
    if (body.departmentId !== undefined)
      team.departmentId = departmentIdOf(career, body.departmentId, team.facilityId);
    publish(career);
    return teamDto(career, team);
  }
  function setTeamMembers(career: MockCareer, id: string, body: Record<string, unknown>): TeamDto {
    requireFeature(career, 'TEAMS');
    const s = state(career);
    const team = teamOf(career, id);
    const ids = Array.isArray(body.memberIds) ? [...new Set(body.memberIds.map(String))] : null;
    if (!ids || ids.length > TEAM_MAX_MEMBERS)
      throw new MockError(422, 'VALIDATION_ERROR', `A team has at most ${TEAM_MAX_MEMBERS} members`, {
        fields: ['memberIds'],
      });
    const members = ids.map((memberId) => operator(career, memberId));
    if (members.some((op) => op.facilityId !== team.facilityId || op.status === 'TRANSFERRING'))
      throw new MockError(422, 'VALIDATION_ERROR', 'Members must be based at the facility of the team', {
        fields: ['memberIds'],
      });
    const leaderId =
      body.leaderId === undefined
        ? ids.includes(team.leaderId ?? '')
          ? team.leaderId
          : null
        : body.leaderId === null
          ? null
          : String(body.leaderId);
    if (leaderId !== null && !ids.includes(leaderId))
      throw new MockError(422, 'VALIDATION_ERROR', 'The leader must be a member of the team', {
        fields: ['leaderId'],
      });
    for (const op of s.people.filter((x) => x.teamId === team.id && !ids.includes(x.id))) op.teamId = null;
    for (const op of members) {
      if (op.teamId !== team.id) {
        leaveTeam(career, op);
        remember(op, 'TEAM_JOINED', { team: team.name });
      }
      op.teamId = team.id;
    }
    team.memberIds = ids;
    team.leaderId = leaderId;
    publish(career);
    return teamDto(career, team);
  }
  function setTeamVehicle(career: MockCareer, id: string, vehicleId: unknown): TeamDto {
    requireFeature(career, 'TEAMS');
    const team = teamOf(career, id);
    if (vehicleId === null || vehicleId === undefined) team.vehicleId = null;
    else {
      const vehicle = career.vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
      if (vehicle.facilityId !== team.facilityId)
        throw new MockError(422, 'VALIDATION_ERROR', 'The vehicle is based at another facility', {
          fields: ['vehicleId'],
        });
      // One team per vehicle: the previous one is released.
      for (const other of state(career).teams) if (other.vehicleId === vehicle.id) other.vehicleId = null;
      team.vehicleId = vehicle.id;
    }
    publish(career);
    return teamDto(career, team);
  }
  function createDepartment(career: MockCareer, body: Record<string, unknown>): DepartmentDto {
    requireFeature(career, 'DEPARTMENTS');
    const facility = facilityOf(career, body.facilityId);
    const family = String(body.family) as ServiceFamily;
    if (!career.summary.unlockedFamilies.includes(family))
      throw new MockError(422, 'NOT_UNLOCKED', 'Family not unlocked', {
        requiredLevel: resolvedFamilyLevel(family),
      });
    const department: DepartmentDto = {
      id: engine.id('dep'),
      name: validName(body.name, 40),
      family,
      facilityId: facility.id,
    };
    state(career).departments.push(department);
    publish(career);
    return department;
  }

  /* ── training ── */
  const trainingRoomLevel = (facility: FacilityDto): number =>
    facility.upgrades.find((u) => u.code === 'TRAINING_ROOM')?.level ?? 0;
  function training(career: MockCareer) {
    const s = state(career);
    const level = career.summary.level;
    const featureOpen = level >= featureLevel('TRAINING');
    const courses: CourseDto[] = COURSES.map((c) => {
      const families = (QUALIFICATIONS.find((q) => q.code === c.grants)?.families ?? []).filter(
        (f) => f !== 'SHARED',
      );
      return {
        code: c.code,
        name: text(`course.${c.code}.name`),
        description: text(`course.${c.code}.description`),
        family: families.length === 1 ? (families[0] as ServiceFamily) : null,
        grantsQualification: c.grants,
        prerequisites: c.prerequisites.qualifications,
        eligibleRoles: c.prerequisites.roles,
        cost: String(c.cost),
        durationSeconds: Math.round(c.durationSeconds / engine.speed),
        requiredLevel: Math.max(c.requiredLevel, featureLevel('TRAINING')),
        unlocked: featureOpen && c.requiredLevel <= level,
      };
    });
    const slots = career.facilities.map((f) => ({
      facilityId: f.id,
      total: BASE_TRAINING_SLOTS + TRAINING_SLOTS_PER_ROOM_LEVEL * trainingRoomLevel(f),
      used: s.people.filter((op) => op.facilityId === f.id && op.status === 'TRAINING').length,
    }));
    return { courses, enrollments: s.enrollments, slots };
  }
  function enroll(career: MockCareer, body: Record<string, unknown>): EnrollmentDto[] {
    requireFeature(career, 'TRAINING');
    const s = state(career);
    const course = COURSES.find((c) => c.code === body.courseCode);
    if (!course) throw new MockError(404, 'NOT_FOUND', 'Unknown course');
    if (course.requiredLevel > career.summary.level)
      throw new MockError(422, 'LEVEL_TOO_LOW', 'Level too low', { requiredLevel: course.requiredLevel });
    const ids = Array.isArray(body.personnelIds) ? [...new Set(body.personnelIds.map(String))] : [];
    if (ids.length < 1 || ids.length > 20)
      throw new MockError(422, 'VALIDATION_ERROR', 'Enroll between 1 and 20 operators', {
        fields: ['personnelIds'],
      });
    const now = engine.now();
    const trainees = ids.map((personnelId) => operator(career, personnelId));
    const refuse = (op: MockOperator, reason: string) =>
      new MockError(422, 'VALIDATION_ERROR', `${fullName(op)} cannot attend this course`, {
        personnelId: op.id,
        reason,
      });
    for (const op of trainees) {
      if (!idle(op))
        throw new MockError(409, 'INVALID_STATE_TRANSITION', `${fullName(op)} is busy`, {
          personnelId: op.id,
          status: op.status,
        });
      if (!course.prerequisites.roles.includes(op.roleCode)) throw refuse(op, 'ROLE_NOT_ELIGIBLE');
      if (holds(op, course.grants, now)) throw refuse(op, 'ALREADY_QUALIFIED');
      if (!course.prerequisites.qualifications.every((q) => holds(op, q, now)))
        throw refuse(op, 'MISSING_PREREQUISITE');
      if (trainingRoomLevel(facilityOf(career, op.facilityId)) < course.prerequisites.trainingRoomLevel)
        throw refuse(op, 'TRAINING_ROOM_REQUIRED');
    }
    for (const slot of training(career).slots) {
      const wanted = trainees.filter((op) => op.facilityId === slot.facilityId).length;
      if (wanted > slot.total - slot.used)
        throw new MockError(422, 'CAPACITY_EXCEEDED', 'Not enough training slots in this facility', {
          domain: 'TRAINING',
          facilityId: slot.facilityId,
          free: slot.total - slot.used,
        });
    }
    engine.credit(
      career,
      -course.cost * trainees.length,
      'TRAINING',
      false,
      text('ledger.TRAINING', { item: course.code, count: trainees.length }),
    );
    const endsAt = now + engine.dur(course.durationSeconds);
    const created = trainees.map((op): EnrollmentDto => {
      const enrollment: EnrollmentDto = {
        id: engine.id('trn'),
        courseCode: course.code,
        personnelId: op.id,
        status: 'IN_PROGRESS',
        startedAt: iso(now),
        endsAt: iso(endsAt),
      };
      setStatus(op, 'TRAINING', { reason: 'TRAINING', until: endsAt });
      remember(op, 'TRAINING_STARTED', { course: course.code });
      engine.schedule(career, 'TRAINING_DONE', course.durationSeconds, enrollment.id);
      return enrollment;
    });
    s.enrollments = [...created, ...s.enrollments].slice(0, 60);
    publish(career, { career: career.summary });
    return created;
  }
  function cancelEnrollment(career: MockCareer, id: string): EnrollmentDto {
    const s = state(career);
    const enrollment = s.enrollments.find((e) => e.id === id);
    if (!enrollment) throw new MockError(404, 'NOT_FOUND', 'Enrollment not found');
    if (enrollment.status !== 'IN_PROGRESS')
      throw new MockError(409, 'INVALID_STATE_TRANSITION', 'Enrollment is not in progress');
    enrollment.status = 'CANCELLED';
    engine.cancelActions(career, (a) => a.type === 'TRAINING_DONE' && a.ref === id);
    const op = s.people.find((x) => x.id === enrollment.personnelId);
    if (op?.status === 'TRAINING') {
      setStatus(op, 'AVAILABLE');
      remember(op, 'TRAINING_CANCELLED', { course: enrollment.courseCode });
    }
    const course = COURSES.find((c) => c.code === enrollment.courseCode);
    const refund = Math.floor((course?.cost ?? 0) * CANCEL_REFUND_SHARE);
    if (refund > 0) engine.credit(career, refund, 'REFUND', false, text('ledger.REFUND'));
    publish(career, { career: career.summary });
    return enrollment;
  }

  /* ── scheduled actions ── */
  engine.registerExecutor('ONBOARDING_DONE', (career, action) => {
    const op = state(career).people.find((x) => x.id === action.ref);
    if (!op || op.status !== 'ONBOARDING') return;
    setStatus(op, 'AVAILABLE');
    remember(op, 'ONBOARDED');
    publish(career);
    engine.notify(career, {
      category: 'PERSONNEL',
      title: text('notifications.personnel.onboarded', { name: fullName(op) }),
      action: { kind: 'OPEN_PERSONNEL', targetId: op.id },
    });
  });
  engine.registerExecutor('REST_DONE', (career, action) => {
    const op = state(career).people.find((x) => x.id === action.ref);
    if (!op || op.status !== 'RESTING') return;
    setStatus(op, 'AVAILABLE');
    // A speed-up ends the rest early: the operator is fully recovered anyway (that is what was paid for).
    settle(op, engine.now(), -100);
    remember(op, 'REST_DONE');
    publish(career);
  });
  engine.registerExecutor('TRANSFER_DONE', (career, action) => {
    const op = state(career).people.find((x) => x.id === action.ref);
    if (!op || op.status !== 'TRANSFERRING') return;
    setStatus(op, 'AVAILABLE');
    remember(op, 'TRANSFERRED');
    publish(career);
  });
  engine.registerExecutor('INJURY_RECOVERED', (career, action) => {
    const op = state(career).people.find((x) => x.id === action.ref);
    if (!op || op.status !== 'INJURED') return;
    op.injury = null;
    setStatus(op, 'AVAILABLE');
    remember(op, 'RECOVERED');
    publish(career);
    engine.notify(career, {
      category: 'PERSONNEL',
      title: text('notifications.personnel.recovered', { name: fullName(op) }),
      action: { kind: 'OPEN_PERSONNEL', targetId: op.id },
    });
  });
  engine.registerExecutor('TRAINING_DONE', (career, action) => {
    const s = state(career);
    const enrollment = s.enrollments.find((e) => e.id === action.ref);
    if (!enrollment || enrollment.status !== 'IN_PROGRESS') return;
    enrollment.status = 'COMPLETED';
    const course = COURSES.find((c) => c.code === enrollment.courseCode);
    const op = s.people.find((x) => x.id === enrollment.personnelId);
    if (!op || !course) return;
    const now = engine.now();
    if (!holds(op, course.grants, now))
      op.qualifications.push({ code: course.grants, obtainedAt: iso(now), expiresAt: null });
    if (op.status === 'TRAINING') setStatus(op, 'AVAILABLE');
    remember(op, 'TRAINING_DONE', { course: course.code });
    publish(career);
    engine.notify(career, {
      category: 'PERSONNEL',
      title: text('notifications.personnel.trainingDone', { name: fullName(op) }),
      action: { kind: 'OPEN_PERSONNEL', targetId: op.id },
    });
  });
  engine.registerExecutor('CANDIDATES_REFRESH', (career) => {
    refreshCandidates(career);
    engine.emit(career, 'personnel.updated', {});
  });

  /* ── engine hooks ── */
  engine.hooks.careerCreated.push((career) => void state(career));

  engine.hooks.dispatchOption.push((career, vehicle, option): MockDispatchOption => {
    reconcile(career);
    const type = VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode);
    if (!type) return option;
    const s = state(career);
    const now = engine.now();
    const held = s.crews[vehicle.id];
    if (held) {
      const crew = s.people.filter((op) => held.includes(op.id));
      return {
        ...option,
        crew: {
          available: crew.length,
          min: type.crewMin,
          optimal: type.crewOptimal,
          missingQualifications: [],
          // The simulator does not model a separate RECOMMENDED-role gap or a per-operator fatigue-recovery ETA.
          missingRoles: [],
          restUntilSeconds: null,
          ...crewQuality(type, crew, now),
        },
      };
    }
    const selection = previewFor(career, vehicle, type);
    const warnings = option.warnings.filter((w) => w !== 'CREW_BELOW_OPTIMAL' && w !== 'CREW_TIRED');
    if (!selection.blocked && selection.crew.length < type.crewOptimal) warnings.push('CREW_BELOW_OPTIMAL');
    if (!selection.blocked && BANDS.indexOf(selection.maxFatigueBand) >= BANDS.indexOf('FATIGUED'))
      warnings.push('CREW_TIRED');
    const blocks = option.dispatchable && selection.blocked !== null;
    return {
      ...option,
      warnings,
      dispatchable: option.dispatchable && !blocks,
      blockedReason: blocks ? selection.blocked : option.blockedReason,
      crew: {
        available: selection.crew.length,
        min: type.crewMin,
        optimal: type.crewOptimal,
        missingQualifications: selection.missing,
        // Ditto: no role/qualification split or recovery-time projection in the simulator's simplified model.
        missingRoles: [],
        restUntilSeconds: null,
        maxFatigueBand: selection.maxFatigueBand,
        efficiency: selection.efficiency,
      },
    };
  });

  /**
   * Draws the crews of the whole dispatch: first the MINIMUM crew of every vehicle (so one vehicle never starves the
   * others), then each is topped up to its optimal size with whoever is left.
   */
  engine.hooks.dispatchCheck.push((career, incident, vehicles) => {
    reconcile(career);
    const s = state(career);
    const now = engine.now();
    const taken = new Set<string>();
    const plan = vehicles.flatMap((vehicle) => {
      const type = VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode);
      return type ? [{ vehicle, type, crew: [] as MockOperator[] }] : [];
    });
    const poolOf = (facilityId: string) =>
      s.people.filter((op) => op.facilityId === facilityId && !taken.has(op.id));
    for (const row of plan) {
      const selection = selectCrew(row.type, poolOf(row.vehicle.facilityId), {
        now,
        ownTeam: ownTeamOf(career, row.vehicle.id),
        target: 'MIN',
      });
      if (selection.blocked)
        throw new MockError(409, selection.blocked, `No crew for ${row.vehicle.callSign}`, {
          vehicleIds: [row.vehicle.id],
          missing: selection.missing,
        });
      row.crew = selection.crew;
      for (const op of selection.crew) taken.add(op.id);
    }
    for (const row of plan) {
      const extra = selectCrew(row.type, poolOf(row.vehicle.facilityId), {
        now,
        ownTeam: ownTeamOf(career, row.vehicle.id),
        target: 'OPTIMAL',
      }).crew.slice(0, Math.max(0, row.type.crewOptimal - row.crew.length));
      row.crew = [...row.crew, ...extra];
      for (const op of extra) taken.add(op.id);
    }
    for (const row of plan) {
      s.crews[row.vehicle.id] = row.crew.map((op) => op.id);
      s.missions[row.vehicle.id] = incident.severity;
      for (const op of row.crew) setStatus(op, 'ON_MISSION', { reason: 'MISSION', until: null });
    }
    publish(career);
  });

  engine.hooks.vehicleReturned.push((career, vehicle) => {
    const s = state(career);
    const ids = s.crews[vehicle.id];
    if (!ids) return;
    const now = engine.now();
    const load = loadClassOf(s.missions[vehicle.id] ?? 1);
    delete s.crews[vehicle.id];
    delete s.missions[vehicle.id];
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: PESCARA.timezone }).format(
        now,
      ),
    );
    const night = hour >= 21 || hour < 5 ? P.fatigue.nightMultiplier : 1;
    const window = engine.dur(managerial(P.fatigue.consecutiveWindowSeconds));
    for (const op of s.people.filter((x) => ids.includes(x.id) && x.status === 'ON_MISSION')) {
      op.recentMissions = op.recentMissions.filter((at) => now - at < window);
      const extras = P.fatigue.consecutiveMissionExtra;
      const consecutive = extras[Math.min(op.recentMissions.length, extras.length - 1)] ?? 0;
      const before = bandOf(fatigueAt(op.fatigue, now));
      setStatus(op, 'AVAILABLE');
      settle(op, now, (P.fatigue.missionLoad[load] + consecutive) * night);
      op.recentMissions.push(now);
      op.missions += 1;
      // Experience: competence grows slowly with missions (no power creep: +1 every 4 missions, capped).
      if (op.missions % 4 === 0) op.competence = Math.min(100, op.competence + 1);
      remember(op, 'MISSION', { vehicle: vehicle.callSign });
      if (rollInjury(career, op, load, before)) continue;
      if (op.fatigue.band === 'REST_REQUIRED' && before !== 'REST_REQUIRED')
        engine.notify(career, {
          category: 'PERSONNEL',
          priority: 'IMPORTANT',
          title: text('notifications.personnel.restRequired', { name: fullName(op) }),
          action: { kind: 'OPEN_PERSONNEL', targetId: op.id },
        });
    }
    publish(career);
  });

  /** Low-probability injury on return (MINOR / MODERATE only, never fatal — D-31). Returns true when injured. */
  function rollInjury(career: MockCareer, op: MockOperator, load: LoadClass, band: FatigueBand): boolean {
    const s = state(career);
    if (career.summary.level < INJURY_MIN_LEVEL) return false;
    const injured = s.people.filter((x) => x.status === 'INJURED').length;
    if ((injured + 1) / s.people.length > P.injury.maxInjuredShare) return false;
    // Never take away the only operator of a role at a facility: a required role must not vanish by bad luck.
    const sameRole = s.people.filter(
      (x) => x.facilityId === op.facilityId && x.roleCode === op.roleCode && x.status !== 'INJURED',
    );
    if (sameRole.length <= 1) return false;
    const risk = P.injury.baseRiskByLoad[load] * P.injury.fatigueRiskFactorByBand[band];
    if (engine.random() >= risk) return false;
    injure(career, op, engine.random() < P.injury.severityShare.MINOR ? 'MINOR' : 'MODERATE');
    return true;
  }
  function injure(career: MockCareer, op: MockOperator, severity: 'MINOR' | 'MODERATE'): void {
    const seconds = managerial(P.injury.recoverySeconds[severity]);
    const until = engine.now() + engine.dur(seconds);
    op.injury = { severity, recoversAt: iso(until) };
    setStatus(op, 'INJURED', { reason: 'INJURY', until });
    engine.cancelActions(career, (a) => a.type === 'INJURY_RECOVERED' && a.ref === op.id);
    engine.schedule(career, 'INJURY_RECOVERED', seconds, op.id);
    remember(op, 'INJURED', { severity });
    engine.notify(career, {
      category: 'PERSONNEL',
      priority: 'IMPORTANT',
      title: text('notifications.personnel.injured', { name: fullName(op) }),
      action: { kind: 'OPEN_PERSONNEL', targetId: op.id },
    });
  }

  // Personnel cost is deducted from the stipend and only there (D-41).
  engine.hooks.stipendDeductions.push((career) =>
    state(career).people.reduce((sum, op) => sum + Number(op.costPerPeriod), 0),
  );
  engine.hooks.touched.push((career) => reconcile(career));
  // A new level may open roles for the market: nothing to do now, the next timed refresh picks them up.

  const domain: PersonnelDomain = {
    state,
    list: (career) => {
      reconcile(career);
      return state(career).people.map(toDto);
    },
    detail: (career, id) => {
      const op = operator(career, id);
      return { ...toDto(op), history: op.history, injury: op.injury };
    },
    quickHire,
    dismiss,
    rest,
    transfer,
    candidates,
    hireCandidate,
    teams: (career) => {
      reconcile(career);
      return state(career).teams.map((team) => teamDto(career, team));
    },
    createTeam,
    updateTeam,
    setTeamMembers,
    setTeamVehicle,
    departments: (career) => state(career).departments,
    createDepartment,
    training,
    enroll,
    cancelEnrollment,
    staffAll: (career) => {
      staffVehicles(career, 'OPTIMAL');
      publish(career);
      engine.save();
    },
  };
  domains.set(engine, domain);

  /* ── QA helpers (installQa runs after the domains: extend `engine.qa` as soon as it exists) ── */
  const helpers = {
    staffAll: () => domain.staffAll(engine.qa.career()),
    personnel: () => domain.list(engine.qa.career()),
    /** Sets the fatigue of one operator (0–100) to reach tired / rest-required states at once. */
    tire: (personnelId: string, value: number) => {
      const career = engine.qa.career();
      const op = operator(career, personnelId);
      settle(op, engine.now(), -100);
      settle(op, engine.now(), value);
      publish(career);
      engine.save();
    },
    tireAll: (value: number) => {
      const career = engine.qa.career();
      for (const op of state(career).people) {
        settle(op, engine.now(), -100);
        settle(op, engine.now(), value);
      }
      publish(career);
      engine.save();
    },
    injure: (personnelId: string, severity: 'MINOR' | 'MODERATE' = 'MINOR') => {
      const career = engine.qa.career();
      const op = operator(career, personnelId);
      leaveMission(career, op);
      injure(career, op, severity);
      publish(career);
      engine.save();
    },
    refreshCandidates: () => {
      const career = engine.qa.career();
      refreshCandidates(career);
      engine.emit(career, 'personnel.updated', {});
      engine.save();
    },
  };
  function leaveMission(career: MockCareer, op: MockOperator): void {
    const s = state(career);
    for (const [vehicleId, ids] of Object.entries(s.crews))
      s.crews[vehicleId] = ids.filter((id) => id !== op.id);
  }
  extendQa(engine, helpers as unknown as Record<string, (...args: never[]) => unknown>);
}

/**
 * `engine.qa` is assigned by `installQa`, which runs AFTER the domain modules: trap the assignment (chaining any trap a
 * sibling domain installed the same way) so the helpers — and the `staffAll` override — survive it.
 */
function extendQa(engine: MockEngine, helpers: Record<string, (...args: never[]) => unknown>): void {
  if ((engine.qa as unknown) !== undefined) {
    Object.assign(engine.qa, helpers);
    return;
  }
  const previous = Object.getOwnPropertyDescriptor(engine, 'qa');
  let current: MockEngine['qa'] | undefined;
  Object.defineProperty(engine, 'qa', {
    configurable: true,
    enumerable: true,
    get: () => (previous?.get ? (previous.get.call(engine) as MockEngine['qa']) : current),
    set: (next: MockEngine['qa']) => {
      const extended = Object.assign(next, helpers);
      if (previous?.set) previous.set.call(engine, extended);
      else current = extended;
    },
  });
}
