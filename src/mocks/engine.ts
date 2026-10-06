import type {
  CareerSummary,
  FacilityDto,
  I18nText,
  TimelineEntryDto,
  IncidentDto,
  IncidentOutcomeDto,
  RealtimeEnvelope,
  RealtimeEventType,
  SyncDelta,
  SyncSnapshot,
  UserDto,
  VehicleDto,
} from '@/contracts';
import type { z } from 'zod';
import type { NotificationDto as NotificationSchema } from '@/contracts';
import { haversineMeters, movementPoint, pathLengthMeters, type LngLat } from '@/lib/geo';
import {
  FACILITY_TYPES,
  INCIDENT_TEMPLATES,
  type MockIncidentTemplate,
  TUTORIAL_TEMPLATE,
  UNG_TYPES,
  UPGRADE_TYPES,
  VEHICLE_TYPES,
  bandFor,
  levelForXp,
  levelRow,
  resolvedFamilyLevel,
  upgradeBuildSeconds,
  upgradePrice,
  xpThreshold,
  FAMILIES,
  ECONOMY,
  MAJOR_SETTINGS,
  MAX_VEHICLES_PER_DISPATCH,
} from './data/catalog';
import { INCIDENT_SPOTS, PESCARA, STARTER_SITES, mockRoute } from './data/pescara';
import { newId } from './ulid';
import type { QaHelpers } from './qa';

/**
 * In-browser simulation of the server core loop. Mirrors the backend design: no tick-driven state,
 * every future event is a scheduled action with a due time; `process(now)` executes what is due
 * (also after a reload, so the world catches up while the tab was closed).
 */

export class MockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type NotificationDto = z.infer<typeof NotificationSchema>;
/** Core action types; domain modules (src/mocks/domains/*) register their own with `engine.registerExecutor`. */
type CoreActionType =
  | 'INCIDENT_SPAWN'
  | 'VEHICLE_DEPART'
  | 'VEHICLE_ARRIVE'
  | 'INCIDENT_WORK_DONE'
  | 'VEHICLE_RETURNED'
  | 'VEHICLE_DELIVERED'
  | 'UPGRADE_DONE'
  | 'INCIDENT_EXPIRE'
  | 'INCIDENT_ESCALATE'
  | 'UNG_ARRIVE'
  | 'UNG_DONE';
export type ActionType = CoreActionType | (string & {});
export interface Action {
  id: string;
  type: ActionType;
  dueAt: number;
  ref: string;
}
export type ActionExecutor = (career: MockCareer, action: Action) => void;

/**
 * Extension points used by the domain modules so that the core loop never imports them:
 * every hook is optional and additive. See src/mocks/domains/README in the agent notes.
 */
export interface EngineHooks {
  /** After a career is created (seed personnel, stock, hospitals…). */
  careerCreated: ((career: MockCareer) => void)[];
  /** Extra validation before a dispatch is accepted: throw MockError to block. */
  dispatchCheck: ((career: MockCareer, incident: IncidentDto, vehicles: VehicleDto[]) => void)[];
  /** Decorate a dispatch option (crew preview, blocking reasons, warnings). Return the (possibly replaced) option. */
  dispatchOption: ((
    career: MockCareer,
    vehicle: VehicleDto,
    option: MockDispatchOption,
    incident: IncidentDto,
  ) => MockDispatchOption)[];
  /** A vehicle is leaving its facility for an incident. Return 'BREAKDOWN' to abort the departure (the hook owns the vehicle from there). */
  vehicleDeparting: ((career: MockCareer, vehicle: VehicleDto, at: number) => 'OK' | 'BREAKDOWN')[];
  vehicleArrived: ((career: MockCareer, vehicle: VehicleDto, incident: IncidentDto, at: number) => void)[];
  /**
   * A vehicle is back at its facility (wear, resupply stop, fatigue, crew release). `at` = the arrival instant (absent when
   * a domain replays the hook for a vehicle towed home).
   */
  vehicleReturned: ((
    career: MockCareer,
    vehicle: VehicleDto,
    leg: DispatchLeg | null,
    at?: number,
  ) => void)[];
  /** A vehicle heads home (scene left, recall on the way, hospital hand-off done): `before` = what it was doing. */
  vehicleSentHome: ((career: MockCareer, before: VehicleDto, after: VehicleDto, at: number) => void)[];
  /** A vehicle broke down where it was (`before` = its state just before): the domains close what it was doing. */
  vehicleBrokeDown: ((career: MockCareer, before: VehicleDto, at: number) => void)[];
  /**
   * Seconds a dispatched vehicle still spends at base before it leaves (the reload before departure of D-22). Called once
   * per vehicle by `dispatch`, after the dispatch checks: the hook applies what it announces.
   */
  departureDelay: ((career: MockCareer, vehicle: VehicleDto, incident: IncidentDto, at: number) => number)[];
  /** The on-scene work of an incident is complete (reward time), before any vehicle is sent home. */
  workDone: ((career: MockCareer, incident: IncidentDto, at: number) => void)[];
  /**
   * Decorates a vehicle DTO on every way out of the engine (snapshot, events, REST) with derived read-model fields — the
   * autonomy block (D-22). Must be pure and cheap: it runs on every patch.
   */
  vehicleView: ((career: MockCareer, vehicle: VehicleDto) => VehicleDto)[];
  /** A new incident exists (create patients, reserve stock…). */
  incidentSpawned: ((career: MockCareer, incident: IncidentDto) => void)[];
  /** On-scene work finished. Return true while something still keeps the incident RESOLVING (patients to transport…). */
  resolvingBlockers: ((career: MockCareer, incident: IncidentDto) => boolean)[];
  /** On-scene work finished: vehicles listed here are NOT sent home by the core (e.g. ambulances that will transport). */
  retainVehicles: ((career: MockCareer, incident: IncidentDto) => string[])[];
  /** The incident left the world (any final status). */
  incidentClosed: ((career: MockCareer, incident: IncidentDto, status: string) => void)[];
  /** Patient outcome factor for the reward quality (null = no patients). */
  patientOutcome: ((career: MockCareer, incident: IncidentDto) => number | null)[];
  levelReached: ((career: MockCareer, level: number, before: number) => void)[];
  /** Successful spend of credits with its ledger entry type (organic purchase tracking, analytics…). */
  creditsChanged: ((career: MockCareer, amount: number, entryType: string) => void)[];
  /** Lets the world domain replace the `world` section of the snapshot. */
  world: ((career: MockCareer, base: SyncSnapshot['world']) => SyncSnapshot['world'])[];
  /** Travel time multiplier for a road path (traffic, weather, closures). */
  travelFactor: ((career: MockCareer, path: LngLat[], vehicleTypeCode: string) => number)[];
  /** Extra fields of GET /facilities/:id (promotion offer…). */
  facilityDetail: ((career: MockCareer, facility: FacilityDto) => Record<string, unknown>)[];
  /** Called on every /sync heartbeat. */
  touched: ((career: MockCareer) => void)[];
  /** Amounts deducted from the periodic stipend (personnel cost per period, D-41). Never makes it negative. */
  stipendDeductions: ((career: MockCareer) => number)[];
  /**
   * Where a new incident of this template happens (water scene, D-68): the first non-null answer wins, `null` = the core's
   * land spots. Throw a MockError when the template cannot be placed at all (a water template without a water point).
   */
  spawnPlace: ((
    career: MockCareer,
    template: MockIncidentTemplate,
    opts: SpawnOptions,
  ) => SpawnPlace | null)[];
  /** Weight multiplier of a template in the organic spawn pool (0 = never now): the water spawn gate. */
  spawnWeight: ((career: MockCareer, template: MockIncidentTemplate) => number)[];
  /** The outbound leg of a vehicle to an incident when it is not a plain road/air trip (a boat's mixed leg). */
  planLeg: ((career: MockCareer, vehicle: VehicleDto, incident: IncidentDto) => MockLeg | null)[];
  /** The way home of a vehicle leaving `from` when it is not a plain road/air trip (a boat on the water). */
  planHome: ((career: MockCareer, vehicle: VehicleDto, from: LngLat, at: number) => MockLeg | null)[];
  /** What a vehicle brings to THIS incident (a land unit at a water incident: its shore-side capabilities only). */
  sceneCapabilities: ((
    career: MockCareer,
    vehicle: VehicleDto,
    incident: IncidentDto,
    capabilities: VehicleDto['capabilities'],
  ) => VehicleDto['capabilities'])[];
  /**
   * A dispatch was undone for free (★POST /dispatches/:id/cancel): `vehicles` are AVAILABLE again exactly as before — the
   * domains give back what the dispatch took (crew, the reload before departure).
   */
  dispatchCancelled: ((
    career: MockCareer,
    vehicles: VehicleDto[],
    incident: IncidentDto,
    at: number,
  ) => void)[];
  /** Decorates the sync snapshot (e.g. `activeMajorIncidentId`). */
  snapshotView: ((career: MockCareer, snapshot: SyncSnapshot) => SyncSnapshot)[];
}

/** Options of `spawnIncident` (QA, admin, domains). */
export interface SpawnOptions {
  severity?: number;
  /** Admin / QA: place it here (a water template: the nearest water point to it). */
  position?: LngLat;
  address?: string;
  /** QA only: the nearest spot at or beyond that distance from the headquarters. */
  minDistanceMeters?: number;
  /** Set by the organic spawn loop: the water domain then keeps to the waters the career can handle. */
  organic?: boolean;
  /** QA: the kind of water of a water template (else any the template allows). */
  waterBody?: 'SEA' | 'LAKE' | 'RIVER';
  /**
   * Runs once the incident exists, BEFORE its `incident.created` is announced (a major incident attaches `major` here, like
   * the backend's `createIncident({ beforeAnnounce })`): the event already carries what it sets.
   */
  beforeAnnounce?: (career: MockCareer, incident: IncidentDto) => void;
}
/**
 * A place chosen by a domain (water scene, D-68). `position` is where land units stop (the meeting point on the shore
 * road); a water incident also has its `scene` on the water, the water body and the water's edge where boats land people.
 */
export interface SpawnPlace {
  position: LngLat;
  address: string;
  municipality?: string;
  scene?: LngLat;
  waterBody?: { type: 'SEA' | 'LAKE' | 'RIVER'; id: string; name: string | null };
  /** Called once the incident exists, before `incidentSpawned` (the domain keeps what the DTO does not carry). */
  onCreated?: (career: MockCareer, incident: IncidentDto) => void;
}
/** One piece of a planned leg; offsets are server seconds from the departure (like `travelSeconds`, before `speed`). */
export interface MockLegSegment {
  mode: 'ROAD' | 'LAUNCH' | 'WATER' | 'RECOVERY';
  path: LngLat[];
  meters: number;
  startSeconds: number;
  endSeconds: number;
}
/** A planned leg: path + server seconds (before the demo `speed`), with a boat's segments when it has any. */
export interface MockLeg {
  path: LngLat[];
  distanceMeters: number;
  seconds: number;
  segments?: MockLegSegment[];
  /** Metres that burn fuel (a boat: the water only — the trailer tows it on the road). Default: `distanceMeters`. */
  fuelMeters?: number;
  /** Where the vehicle ends up (default: the last point of `path`). */
  end?: LngLat;
}
export interface MockDispatchOption {
  vehicleId: string;
  etaSeconds: number;
  distanceMeters: number;
  dispatchable: boolean;
  blockedReason: string | null;
  warnings: string[];
  contributes: { code: string; value: number }[];
  recommended: boolean;
  crew?: {
    available: number;
    min: number;
    optimal: number;
    missingQualifications: string[];
    missingRoles: string[];
    maxFatigueBand: 'RESTED' | 'TIRED' | 'FATIGUED' | 'REST_REQUIRED';
    efficiency: number;
    restUntilSeconds: number | null;
  };
  /** Autonomy for THIS incident (D-22), set by the autonomy domain for AVAILABLE vehicles once something is tracked. */
  autonomy?: {
    fuelNeededKm: number | null;
    fuelKm: number | null;
    enoughFuel: boolean;
    resupplyBeforeDepartureSeconds: number;
    lastMissionBeforeResupply: boolean;
    /** Unit of `fuelNeededKm` / `fuelKm`: `MIN` = minutes of flight of an aircraft. */
    fuelUnit?: 'KM' | 'MIN';
    /** Aircraft: REAL minutes it can stay over the scene before turning back to refuel. */
    onSceneMinutes?: number | null;
  };
  /** Water incidents: where this vehicle goes — the scene on the water (boats, aircraft) or the meeting point (land). */
  destination?: 'SCENE' | 'MEETING_POINT';
  /** Boats: how they get there (from the berth, by trailer to a launch point, or launched from the bank). */
  boatRoute?: {
    kind: 'DIRECT' | 'TRAILER' | 'BANK';
    roadMeters: number;
    waterMeters: number;
    launchSeconds: number;
    launchPoint: { name: string | null; position: LngLat } | null;
  };
  /** Internal: flagged (reserve, range) — never recommended, still selectable. Stripped from the response. */
  notRecommended?: boolean;
}

interface LedgerRow {
  id: string;
  amount: string;
  balanceAfter: string;
  entryType: string;
  description: I18nText;
  createdAt: string;
}
export interface DispatchLeg {
  vehicleId: string;
  incidentId: string;
  path: LngLat[];
  distanceMeters: number;
  dispatchedAt: number;
  arrivedAt: number | null;
  /** Metres that burn fuel when they differ from `distanceMeters` (a boat: the water part only). */
  fuelMeters?: number;
  /** A boat's outbound pieces (D-68): where the trailer launched it, for the way back. */
  segments?: MockLegSegment[];
}

/**
 * A player dispatch, kept for the free undo (`★POST /dispatches/:id/cancel`, air-endurance.md §5): what the incident was
 * before it (status, expiry, escalation and the due times of their pending actions) so a cancel restores it exactly.
 */
export interface MockDispatchRecord {
  id: string;
  incidentId: string;
  vehicleIds: string[];
  at: number;
  origin: 'PLAYER' | 'QUEUE' | 'REDIRECT';
  /** Epoch ms; null = no free undo (tutorial). */
  cancellableUntil: number | null;
  prior: {
    status: IncidentDto['status'];
    expiresAt: string | null;
    nextEscalationAt: string | null;
    escalating: boolean;
    expireDueAt: number | null;
    escalateDueAt: number | null;
  };
  cancelled: boolean;
}

export interface MockCareer {
  summary: CareerSummary;
  userId: string;
  seq: number;
  facilities: FacilityDto[];
  facilityAddress: Record<string, string>;
  vehicles: VehicleDto[];
  incidents: IncidentDto[];
  legs: DispatchLeg[];
  firstArrival: Record<string, number>;
  timelines: Record<string, TimelineEntryDto[]>;
  pendingOutcomes: IncidentOutcomeDto[];
  ledger: LedgerRow[];
  notifications: NotificationDto[];
  actions: Action[];
  callSignCounters: Record<string, number>;
  stats: { resolved: number; failed: number; earned: number; spent: number };
  away: { since: number; resolved: number; failed: number; credits: number; xp: number; stipend: number };
  lastSeenAt: number;
  awayFrom: number | null;
  idempotency: Record<string, unknown>;
  /** Domain module state, keyed by domain name (personnel, medical, logistics, world, business…). */
  ext: Record<string, unknown>;
  /** Pending external-support units by id → incident id (core: RESOLVING phase). */
  ung: Record<string, string>;
  /** Rewarded incidents still RESOLVING: the outcome was already paid. */
  rewarded: Record<string, true>;
  /** Ring buffer of the last emitted envelopes, so `GET /sync?since=` can replay them like the real outbox does. */
  outbox?: RealtimeEnvelope[];
  /** The last player dispatches (free undo), newest last. Optional: older saves have none. */
  dispatches?: MockDispatchRecord[];
}

interface MockUser {
  user: UserDto;
  marketingConsent: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';
  sessions: { id: string; userAgent: string | null; createdAt: string; lastUsedAt: string }[];
}

export interface MockState {
  version: 4;
  users: Record<string, MockUser>; // by email
  challenges: Record<string, { email: string; expiresAt: number; attempts: number }>;
  currentSession: { email: string; sessionId: string } | null;
  careers: Record<string, MockCareer>;
  sites: Record<string, string>; // siteId → starter key
  featureFlags: Record<string, boolean>;
  /** Cross-career domain state (admin config versions, audit log, referral codes…). */
  ext: Record<string, unknown>;
}

export interface MockStorage {
  load(): MockState | null;
  save(state: MockState): void;
}
export interface EngineOptions {
  storage: MockStorage;
  now?: () => number;
  random?: () => number;
  speed?: number;
  emit?: (e: RealtimeEnvelope) => void;
}

const STORAGE_KEY = 'rc-mock-db-v4';
/**
 * The mock stands in for the server, including its readable session flag (`SESSION_FLAG_COOKIE`): without it the
 * client would skip the boot refresh and a mock session would never be restored on a reload.
 */
function sessionFlagCookie(present: boolean): void {
  try {
    if (typeof document === 'undefined') return;
    document.cookie = present
      ? `rc_session=1; path=/; max-age=${60 * 60 * 24 * 60}`
      : 'rc_session=; path=/; max-age=0';
  } catch {
    /* no document (node tests): the localStorage hint covers it */
  }
}
/** How many envelopes a career keeps for `?since=` replay. The real outbox replays at most 500 events too. */
const OUTBOX_WINDOW = 500;
export const localStorageAdapter = (): MockStorage => ({
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MockState;
      return parsed.version === 4 ? parsed : null;
    } catch {
      return null;
    }
  },
  save(state) {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode */
    }
  },
});
export const memoryStorage = (): MockStorage => {
  let s: MockState | null = null;
  return {
    load: () => s,
    save: (n) => {
      s = JSON.parse(JSON.stringify(n)) as MockState;
    },
  };
};

export const iso = (ms: number) => new Date(ms).toISOString();
export const text = (key: string, params?: Record<string, string | number>): I18nText =>
  params ? { key, params } : { key };
export const OTP_CODE = '123456';
/** Enough, with the starting credits and the first reward, for the tutorial's "buy a second vehicle" step (a second fire engine). */
export const TUTORIAL_BONUS = 450;
/** Mock accounts with a platform role (any OTP = 123456). */
export const STAFF_ROLES: Record<string, UserDto['roles']> = {
  'admin@rescue-control.test': ['USER', 'SUPER_ADMIN'],
  'gameadmin@rescue-control.test': ['USER', 'GAME_ADMIN'],
  'support@rescue-control.test': ['USER', 'SUPPORT'],
};
export const DEFAULT_FLAGS: Record<string, boolean> = {
  rewardedAds: true,
  creditShop: true,
  referrals: true,
  soundEffects: true,
  analytics: true,
  /**
   * Alliances (study 2026-10-06; production code defaults are OFF, brief §2). The mock turns the section on so the game
   * can be developed and tested; the parts not built yet stay off and the tabs show their flag-off state.
   */
  alliances: true,
  alliance_board: true,
  alliance_chat: true,
  alliance_aid: true,
  alliance_objectives: false,
  alliance_ranking: false,
  alliance_operations: false,
};
const emptyHooks = (): EngineHooks => ({
  careerCreated: [],
  dispatchCheck: [],
  dispatchOption: [],
  vehicleDeparting: [],
  vehicleArrived: [],
  vehicleReturned: [],
  vehicleSentHome: [],
  vehicleBrokeDown: [],
  departureDelay: [],
  workDone: [],
  vehicleView: [],
  incidentSpawned: [],
  resolvingBlockers: [],
  retainVehicles: [],
  incidentClosed: [],
  patientOutcome: [],
  levelReached: [],
  creditsChanged: [],
  world: [],
  travelFactor: [],
  facilityDetail: [],
  touched: [],
  stipendDeductions: [],
  spawnPlace: [],
  spawnWeight: [],
  planLeg: [],
  planHome: [],
  sceneCapabilities: [],
  dispatchCancelled: [],
  snapshotView: [],
});

/** `dispatch.cancelGraceSeconds` (6 REAL seconds): the free undo window of a dispatch — wall time, whatever the demo speed. */
export const CANCEL_GRACE_MS = 6000;
/** `notifications.severeIncidentMinSeverity` of the backend config: from this severity a new call is also notified. */
export const SEVERE_INCIDENT_MIN_SEVERITY = 7;

/** Where an incident really is: on the water for a water incident (D-68), its position otherwise. */
export const sceneOf = (incident: Pick<IncidentDto, 'position' | 'scenePosition'>): LngLat =>
  incident.scenePosition ?? incident.position;

/** Capacity rows of a facility type; GROUND may be overridden by the real site's capacity points. */
export function capacitiesFor(base: Record<string, number>, ground?: number): FacilityDto['capacities'] {
  return (['GROUND', 'AIR', 'WATER', 'PERSONNEL', 'STORAGE', 'WORKSHOP'] as const).map((domain) => ({
    domain,
    total:
      domain === 'GROUND' && ground !== undefined ? Math.max(ground, base[domain] ?? 0) : (base[domain] ?? 0),
    used: 0,
  }));
}

export class MockEngine {
  state: MockState;
  private readonly storage: MockStorage;
  readonly now: () => number;
  readonly random: () => number;
  readonly speed: number;
  private readonly emitFn: (e: RealtimeEnvelope) => void;
  accessTokens = new Map<string, string>(); // token → email
  readonly hooks: EngineHooks = emptyHooks();
  /** QA / demo helpers, see src/mocks/qa.ts (installed by `installDomains`). */
  qa: QaHelpers = {} as QaHelpers;
  private readonly executors = new Map<string, ActionExecutor>();
  /** Domain modules register the executor of their own scheduled action types. */
  registerExecutor(type: string, fn: ActionExecutor): void {
    this.executors.set(type, fn);
  }

  constructor(opts: EngineOptions) {
    this.storage = opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.speed = opts.speed ?? 1;
    this.emitFn = opts.emit ?? (() => undefined);
    const loaded = this.storage.load();
    // Like production (brief §2 rule 6): a flag unknown to a saved state takes the code default; known rows keep their value.
    this.state = loaded
      ? { ...loaded, featureFlags: { ...DEFAULT_FLAGS, ...loaded.featureFlags } }
      : {
          version: 4,
          users: {},
          challenges: {},
          currentSession: null,
          careers: {},
          sites: {},
          featureFlags: { ...DEFAULT_FLAGS },
          ext: {},
        };
  }

  save(): void {
    this.storage.save(this.state);
  }
  reset(): void {
    this.state = {
      version: 4,
      users: {},
      challenges: {},
      currentSession: null,
      careers: {},
      sites: {},
      featureFlags: this.state.featureFlags,
      ext: {},
    };
    this.accessTokens.clear();
    this.save();
  }
  dur(seconds: number): number {
    return Math.max(250, (seconds * 1000) / this.speed);
  }
  id(prefix: string): string {
    return newId(prefix, this.now(), this.random);
  }

  /* ───────────── auth ───────────── */
  requestOtp(email: string) {
    const normalized = email.trim().toLowerCase();
    const challengeId = `chl_${this.id('x').slice(2)}`;
    const now = this.now();
    this.state.challenges[challengeId] = { email: normalized, expiresAt: now + 600_000, attempts: 0 };
    this.save();
    const [name = '', domain = ''] = normalized.split('@');
    return {
      challengeId,
      maskedEmail: `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`,
      expiresAt: iso(now + 600_000),
      resendAvailableAt: iso(now + 60_000),
    };
  }

  verifyOtp(
    body: {
      challengeId: string;
      code: string;
      directorName?: string;
      acceptTerms?: boolean;
      confirmAge?: boolean;
      marketingConsent?: boolean;
      /** Account lifecycle (account.ts): an account waiting for deletion signs in only with this, which cancels the deletion. */
      cancelDeletion?: boolean;
    },
    userAgent: string | null,
  ) {
    const ch = this.state.challenges[body.challengeId];
    const now = this.now();
    if (!ch || ch.expiresAt < now) throw new MockError(400, 'OTP_EXPIRED', 'Code expired');
    if (ch.attempts >= 5) throw new MockError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many attempts');
    if (body.code !== OTP_CODE) {
      ch.attempts += 1;
      this.save();
      throw new MockError(400, 'OTP_INVALID', 'Invalid code');
    }
    let account = this.state.users[ch.email];
    let isNewUser = false;
    if (!account) {
      // The challenge is NOT consumed here: the client re-submits the same code together with the director name.
      if (!body.directorName) throw new MockError(422, 'DIRECTOR_NAME_REQUIRED', 'Director name required');
      if (!body.acceptTerms || !body.confirmAge)
        throw new MockError(422, 'VALIDATION_ERROR', 'Consents required', {
          fields: ['acceptTerms', 'confirmAge'],
        });
      if (
        Object.values(this.state.users).some(
          (u) => u.user.directorName.toLowerCase() === body.directorName!.toLowerCase(),
        )
      )
        throw new MockError(409, 'DIRECTOR_NAME_INVALID', 'Director name already taken');
      isNewUser = true;
      account = {
        user: {
          id: this.id('usr'),
          email: ch.email,
          directorName: body.directorName,
          locale: 'it',
          roles: STAFF_ROLES[ch.email] ?? ['USER'],
          createdAt: iso(now),
          activeCareerId: null,
        },
        marketingConsent: !!body.marketingConsent,
        status: 'ACTIVE',
        sessions: [],
      };
      this.state.users[ch.email] = account;
    }
    if (account.status === 'DELETION_REQUESTED') {
      const deletion = (
        this.state.ext.community as { deletions?: Record<string, { scheduledAt: string }> } | undefined
      )?.deletions?.[ch.email];
      if (!body.cancelDeletion)
        throw new MockError(403, 'ACCOUNT_DELETING', 'Account waiting for deletion', {
          scheduledAt: deletion?.scheduledAt ?? null,
        });
      account.status = 'ACTIVE';
      const community = this.state.ext.community as { deletions?: Record<string, unknown> } | undefined;
      if (community?.deletions) delete community.deletions[ch.email];
    }
    delete this.state.challenges[body.challengeId];
    const sessionId = `ses_${this.id('x').slice(2)}`;
    account.sessions.push({ id: sessionId, userAgent, createdAt: iso(now), lastUsedAt: iso(now) });
    this.state.currentSession = { email: ch.email, sessionId };
    sessionFlagCookie(true);
    this.save();
    return this.issue(account, isNewUser);
  }

  private issue(account: MockUser, isNewUser: boolean) {
    const token = `mock.${this.id('tok')}`;
    this.accessTokens.set(token, account.user.email);
    return {
      accessToken: token,
      accessTokenExpiresAt: iso(this.now() + 15 * 60_000),
      user: account.user,
      isNewUser,
    };
  }

  refresh() {
    const s = this.state.currentSession;
    const account = s ? this.state.users[s.email] : undefined;
    if (!s || !account || !account.sessions.some((x) => x.id === s.sessionId))
      throw new MockError(401, 'UNAUTHENTICATED', 'No session');
    const session = account.sessions.find((x) => x.id === s.sessionId)!;
    session.lastUsedAt = iso(this.now());
    this.save();
    return this.issue(account, false);
  }

  logout(): void {
    const s = this.state.currentSession;
    if (s) {
      const a = this.state.users[s.email];
      if (a) a.sessions = a.sessions.filter((x) => x.id !== s.sessionId);
    }
    this.state.currentSession = null;
    sessionFlagCookie(false);
    this.save();
  }

  authenticate(authorization: string | null): MockUser {
    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const email = this.accessTokens.get(token);
    const account = email ? this.state.users[email] : undefined;
    if (!account) throw new MockError(401, 'UNAUTHENTICATED', 'Missing or expired access token');
    return account;
  }

  /* ───────────── onboarding ───────────── */
  starterSites() {
    return STARTER_SITES.map((s) => {
      let id = Object.entries(this.state.sites).find(([, key]) => key === s.key)?.[0];
      if (!id) {
        id = this.id('sit');
        this.state.sites[id] = s.key;
      }
      const { key: _key, ...rest } = s;
      void _key;
      return { id, facilityTypeCode: 'FIRE_STATION_LOCAL', ...rest };
    });
  }

  createCareer(account: MockUser, body: { locationId: string; siteId: string }): CareerSummary {
    if (account.user.activeCareerId)
      throw new MockError(409, 'CAREER_ALREADY_EXISTS', 'Career already exists');
    if (body.locationId !== PESCARA.id)
      throw new MockError(422, 'LOCATION_NOT_PLAYABLE', 'Location not playable yet');
    const site = STARTER_SITES.find((s) => s.key === this.state.sites[body.siteId]);
    if (!site) throw new MockError(422, 'SITE_NOT_AVAILABLE', 'Site not available');
    const now = this.now();
    const careerId = this.id('car');
    const facilityId = this.id('fac');
    const type = FACILITY_TYPES.find((f) => f.code === 'FIRE_LOCAL_STATION') ?? FACILITY_TYPES[0]!;
    const facility: FacilityDto = {
      id: facilityId,
      typeCode: type.code,
      family: 'FIRE',
      name: site.name,
      position: site.position,
      status: 'OPERATIONAL',
      capacities: capacitiesFor(type.baseCapacity, site.capacityPoints),
      upgrades: [],
      address: site.address,
      headquarters: true,
      operationalAt: null,
      promotion: null,
    };
    const career: MockCareer = {
      userId: account.user.id,
      seq: 0,
      summary: {
        id: careerId,
        directorName: account.user.directorName,
        locationId: PESCARA.id,
        locationName: PESCARA.name,
        timezone: PESCARA.timezone,
        center: PESCARA.center,
        bounds: PESCARA.bounds,
        onDuty: true,
        level: 1,
        xp: '0',
        xpForCurrentLevel: '0',
        xpForNextLevel: String(xpThreshold(2)),
        reputation: 50,
        credits: '0',
        coveragePct: site.coveragePopulationPct,
        unlockedFamilies: ['FIRE'],
        tutorial: { completed: false, step: 'WELCOME' },
        createdAt: iso(now),
      },
      facilities: [facility],
      facilityAddress: { [facilityId]: site.address },
      vehicles: [],
      incidents: [],
      legs: [],
      firstArrival: {},
      timelines: {},
      pendingOutcomes: [],
      ledger: [],
      notifications: [],
      actions: [],
      callSignCounters: {},
      stats: { resolved: 0, failed: 0, earned: 0, spent: 0 },
      away: { since: now, resolved: 0, failed: 0, credits: 0, xp: 0, stipend: 0 },
      lastSeenAt: now,
      awayFrom: null,
      idempotency: {},
      ext: {},
      ung: {},
      rewarded: {},
    };
    this.state.careers[careerId] = career;
    account.user.activeCareerId = careerId;
    this.credit(career, ECONOMY.startingCredits, 'STARTER_GRANT', true);
    this.addVehicle(career, 'FIRE_APS', facilityId, true);
    for (const hook of this.hooks.careerCreated) hook(career);
    this.spawnIncident(career, TUTORIAL_TEMPLATE, true);
    this.save();
    return career.summary;
  }

  career(account: MockUser, careerId: string): MockCareer {
    const career = this.state.careers[careerId];
    if (!career) throw new MockError(404, 'NOT_FOUND', 'Career not found');
    if (career.userId !== account.user.id && !account.user.roles.some((r) => r !== 'USER'))
      throw new MockError(403, 'FORBIDDEN', 'Not your career');
    return career;
  }

  /* ───────────── scheduling ───────────── */
  schedule(career: MockCareer, type: ActionType, seconds: number, ref: string, realTime = false): void {
    career.actions.push({
      id: this.id('act'),
      type,
      dueAt: this.now() + (realTime ? seconds * 1000 : this.dur(seconds)),
      ref,
    });
  }
  cancelActions(career: MockCareer, pred: (a: Action) => boolean): void {
    career.actions = career.actions.filter((a) => !pred(a));
  }

  /** Pending managerial timer of the given type(s) for `ref` (speed-ups, admin inspection). */
  findAction(career: MockCareer, types: string[], ref: string): Action | undefined {
    return career.actions.find((a) => types.includes(a.type) && a.ref === ref);
  }
  /** Finish a pending timer right now (speed-up): the normal executor runs, so every side effect is identical. */
  completeNow(career: MockCareer, action: Action): void {
    action.dueAt = this.now();
    this.process();
  }

  /**
   * Freezes the simulation: the wall-clock driver in `browser.ts` stops calling `process()`, so e2e tests can
   * inspect a transient phase (an incident in RESOLVING, a vehicle mid-route) without racing the clock. Anchored
   * values the UI derives from wall time keep moving; only state transitions are held.
   *
   * It deliberately does NOT disable `process()` itself: an explicit test step (`qa.fastForward`,
   * `engine.completeNow`) must still be able to advance the simulation one deterministic step at a time while the
   * clock is frozen. That is what makes "freeze, then step to exactly this phase" possible instead of racing.
   */
  paused = false;

  /** Execute everything that is due, oldest first, using each action's own due time as "now". */
  process(): void {
    const wall = this.now();
    let dirty = false;
    for (const career of Object.values(this.state.careers)) {
      for (let guard = 0; guard < 500; guard++) {
        const due = career.actions.filter((a) => a.dueAt <= wall).sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!due) break;
        career.actions = career.actions.filter((a) => a.id !== due.id);
        this.execute(career, due);
        dirty = true;
      }
    }
    if (dirty) this.save();
  }

  private execute(career: MockCareer, action: Action): void {
    const at = action.dueAt;
    switch (action.type) {
      case 'INCIDENT_SPAWN':
        this.onSpawn(career);
        break;
      case 'VEHICLE_DEPART':
        this.onDepart(career, action.ref, at);
        break;
      case 'VEHICLE_ARRIVE':
        this.onArrive(career, action.ref, at);
        break;
      case 'INCIDENT_WORK_DONE':
        this.onWorkDone(career, action.ref, at);
        break;
      case 'VEHICLE_RETURNED':
        this.onReturned(career, action.ref, at);
        break;
      case 'VEHICLE_DELIVERED':
        this.onDelivered(career, action.ref);
        break;
      case 'UPGRADE_DONE':
        this.onUpgradeDone(career, action.ref);
        break;
      case 'INCIDENT_EXPIRE':
        this.onExpire(career, action.ref, at);
        break;
      case 'INCIDENT_ESCALATE':
        this.onEscalate(career, action.ref, at);
        break;
      case 'UNG_ARRIVE':
        this.onUngArrive(career, action.ref, at);
        break;
      case 'UNG_DONE':
        this.onUngDone(career, action.ref, at);
        break;
      default:
        this.executors.get(action.type)?.(career, action);
        break;
    }
  }

  /* ───────────── events ───────────── */
  /** A vehicle as the outside world sees it: the stored DTO + the derived read-model fields of the domains. */
  view(career: MockCareer, vehicle: VehicleDto): VehicleDto {
    return this.hooks.vehicleView.reduce((v, hook) => hook(career, v), vehicle);
  }

  emit(career: MockCareer, type: RealtimeEventType, payload: Record<string, unknown>): void {
    // Every vehicle leaving the engine carries its read model as of NOW (e.g. the autonomy left after a mission).
    const isVehicle = (v: unknown): v is VehicleDto =>
      typeof v === 'object' && v !== null && 'id' in v && 'typeCode' in v && 'status' in v;
    if (isVehicle(payload.vehicle)) payload = { ...payload, vehicle: this.view(career, payload.vehicle) };
    if (Array.isArray(payload.vehicles))
      payload = {
        ...payload,
        vehicles: payload.vehicles.map((v: unknown) => (isVehicle(v) ? this.view(career, v) : v)),
      };
    career.seq += 1;
    const now = iso(this.now());
    const envelope: RealtimeEnvelope = {
      type,
      v: 1,
      careerId: career.summary.id,
      seq: career.seq,
      occurredAt: now,
      serverTime: now,
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
    };
    (career.outbox ??= []).push(envelope);
    if (career.outbox.length > OUTBOX_WINDOW) career.outbox.splice(0, career.outbox.length - OUTBOX_WINDOW);
    this.emitFn(envelope);
  }

  /**
   * `GET /sync?since=<seq>` — the same contract as the server's outbox replay: the missed events when they are all
   * still in the window, otherwise a full snapshot with `resyncRequired`.
   */
  delta(career: MockCareer, since: number): SyncDelta {
    const buffered = career.outbox ?? [];
    const missed = buffered.filter((e) => e.seq > since);
    const replayable = since <= career.seq && missed.length === career.seq - since;
    if (!replayable)
      return { seq: career.seq, events: [], resyncRequired: true, snapshot: this.snapshot(career) };
    return {
      seq: missed.length > 0 ? missed[missed.length - 1]!.seq : since,
      events: missed,
      resyncRequired: false,
      snapshot: null,
    };
  }
  log(
    career: MockCareer,
    incidentId: string,
    type: string,
    t: I18nText,
    at: number,
    vehicleId?: string,
  ): void {
    (career.timelines[incidentId] ??= []).push({
      id: this.id('tl'),
      at: iso(at),
      type,
      text: t,
      vehicleId: vehicleId ?? null,
    });
  }
  notify(
    career: MockCareer,
    n0: {
      category: NotificationDto['category'];
      priority?: NotificationDto['priority'];
      title: I18nText;
      body?: I18nText;
      action?: NotificationDto['action'];
    },
  ): void {
    const n: NotificationDto = {
      id: this.id('ntf'),
      category: n0.category,
      priority: n0.priority ?? 'INFO',
      title: n0.title,
      body: n0.body ?? n0.title,
      createdAt: iso(this.now()),
      readAt: null,
      action: n0.action ?? { kind: 'NONE', targetId: null },
    };
    career.notifications.unshift(n);
    career.notifications = career.notifications.slice(0, 80);
    this.emit(career, 'notification.created', {
      notification: n,
      unreadNotifications: career.notifications.filter((x) => !x.readAt).length,
    });
  }

  /* ───────────── economy ───────────── */
  credit(
    career: MockCareer,
    amount: number,
    entryType: string,
    silent = false,
    description?: I18nText,
  ): void {
    const balance = BigInt(career.summary.credits) + BigInt(amount);
    if (balance < 0n)
      throw new MockError(422, 'INSUFFICIENT_CREDITS', 'Not enough credits', { missing: String(-balance) });
    career.summary = { ...career.summary, credits: String(balance) };
    career.ledger.unshift({
      id: this.id('led'),
      amount: String(amount),
      balanceAfter: String(balance),
      entryType,
      description: description ?? text(`ledger.${entryType}`),
      createdAt: iso(this.now()),
    });
    if (amount > 0) career.stats.earned += amount;
    else career.stats.spent += -amount;
    for (const hook of this.hooks.creditsChanged) hook(career, amount, entryType);
    if (!silent) this.emit(career, 'credits.changed', { credits: String(balance), career: career.summary });
  }

  awardXp(career: MockCareer, xp: number): void {
    const total = Number(career.summary.xp) + xp;
    const before = career.summary.level;
    const level = levelForXp(total);
    const unlocked = FAMILIES.filter((f) => f.playerManaged && resolvedFamilyLevel(f.code) <= level).map(
      (f) => f.code,
    );
    career.summary = {
      ...career.summary,
      xp: String(total),
      level,
      xpForCurrentLevel: String(xpThreshold(level)),
      xpForNextLevel: String(xpThreshold(level + 1)),
      unlockedFamilies: unlocked,
    };
    this.emit(career, 'xp.awarded', { career: career.summary, amount: String(xp) });
    if (level > before) {
      this.emit(career, 'level.reached', { level, career: career.summary });
      const codes = [
        ...VEHICLE_TYPES.filter((v) => v.requiredLevel > before && v.requiredLevel <= level).map(
          (v) => v.code,
        ),
        ...FAMILIES.filter(
          (f) =>
            f.playerManaged && resolvedFamilyLevel(f.code) > before && resolvedFamilyLevel(f.code) <= level,
        ).map((f) => f.code),
      ];
      if (codes.length) this.emit(career, 'unlock.granted', { unlocks: codes });
      let bonus = 0;
      for (let l = before + 1; l <= level; l++) bonus += levelRow(l).levelUpCredits;
      if (bonus > 0) this.credit(career, bonus, 'MILESTONE', false, text('ledger.LEVEL_UP', { level }));
      this.notify(career, {
        category: 'PROGRESSION',
        priority: 'IMPORTANT',
        title: text('notifications.levelUp', { level }),
        action: { kind: 'OPEN_PROGRESSION', targetId: null },
      });
      for (const hook of this.hooks.levelReached) hook(career, level, before);
    }
  }

  /* ───────────── vehicles & shop ───────────── */
  addVehicle(career: MockCareer, typeCode: string, facilityId: string, instant: boolean): VehicleDto {
    const type = VEHICLE_TYPES.find((t) => t.code === typeCode)!;
    const facility = career.facilities.find((f) => f.id === facilityId)!;
    const n = (career.callSignCounters[typeCode] = (career.callSignCounters[typeCode] ?? 0) + 1);
    const short = typeCode.split('_').slice(1).join('') || typeCode;
    const busyUntil = instant ? null : iso(this.now() + this.dur(type.deliverySeconds));
    const vehicle: VehicleDto = {
      id: this.id('veh'),
      typeCode,
      family: type.family,
      callSign: `${short} ${n}`,
      facilityId,
      status: instant ? 'AVAILABLE' : 'IN_DELIVERY',
      position: this.homePositionOf(facility, typeCode),
      movement: null,
      incidentId: null,
      capabilities: Object.entries(type.caps).map(([code, value]) => ({ code, value })),
      health: 100,
      healthBand: 'EXCELLENT',
      crew: { min: type.crewMin, optimal: type.crewOptimal, assigned: type.crewOptimal },
      busyUntil,
    };
    career.vehicles.push(this.view(career, vehicle));
    const domain = type.domain;
    career.facilities = career.facilities.map((f) =>
      f.id !== facilityId
        ? f
        : {
            ...f,
            capacities: f.capacities.map((c) =>
              c.domain === domain ? { ...c, used: c.used + type.capacityPoints } : c,
            ),
          },
    );
    if (!instant) this.schedule(career, 'VEHICLE_DELIVERED', type.deliverySeconds, vehicle.id);
    return career.vehicles.find((v) => v.id === vehicle.id) ?? vehicle;
  }

  buyVehicle(career: MockCareer, body: { vehicleTypeCode: string; facilityId: string }): VehicleDto {
    const type = VEHICLE_TYPES.find((t) => t.code === body.vehicleTypeCode);
    const facility = career.facilities.find((f) => f.id === body.facilityId);
    if (!type || !facility) throw new MockError(404, 'NOT_FOUND', 'Unknown vehicle type or facility');
    if (!career.summary.unlockedFamilies.includes(type.family))
      throw new MockError(422, 'NOT_UNLOCKED', 'Family not unlocked', {
        requiredLevel: resolvedFamilyLevel(type.family),
      });
    if (type.requiredLevel > career.summary.level)
      throw new MockError(422, 'LEVEL_TOO_LOW', 'Level too low', { requiredLevel: type.requiredLevel });
    this.assertCanHost(type, facility);
    this.credit(
      career,
      -type.price,
      'VEHICLE_PURCHASE',
      true,
      text('ledger.VEHICLE_PURCHASE', { item: type.code }),
    );
    const vehicle = this.addVehicle(career, type.code, facility.id, false);
    this.emit(career, 'vehicle.updated', {
      vehicle,
      career: career.summary,
      facility: career.facilities.find((f) => f.id === facility.id),
    });
    if (career.summary.tutorial.step === 'BUY_VEHICLE') this.advanceTutorial(career, 'DONE');
    this.save();
    return vehicle;
  }

  private onDelivered(career: MockCareer, vehicleId: string): void {
    const v = this.patchVehicle(career, vehicleId, { status: 'AVAILABLE', busyUntil: null });
    if (!v) return;
    this.emit(career, 'vehicle.delivered', { vehicle: v });
    this.notify(career, {
      category: 'FLEET',
      title: text('notifications.vehicleDelivered', { callSign: v.callSign }),
      action: { kind: 'OPEN_VEHICLE', targetId: v.id },
    });
  }

  /** A Base nautica (D-23): the facility type that keeps boats — the only one whose domains include WATER. */
  isNauticalFacility(facility: Pick<FacilityDto, 'typeCode'>): boolean {
    return FACILITY_TYPES.find((f) => f.code === facility.typeCode)?.domains.includes('WATER') ?? false;
  }

  /** Where a vehicle rests at its facility: a boat at a Base nautica on its berth (on the water), everything else at the door. */
  homePositionOf(facility: Pick<FacilityDto, 'position' | 'nautical'>, typeCode: string): LngLat {
    const boat = VEHICLE_TYPES.find((t) => t.code === typeCode)?.domain === 'WATER';
    return boat && facility.nautical ? facility.nautical.berth : facility.position;
  }

  /**
   * The shop / transfer gate, as the backend's `ShopService`: a boat only into a Base nautica (`NEEDS_NAUTICAL_BASE`, before
   * anything else, so the player gets the real reason), then compatibility and construction (`CAPACITY_EXCEEDED` with
   * `reason` INCOMPATIBLE_FACILITY / FACILITY_NOT_OPERATIONAL), then room (`NO_ROOM` + the upgrade that adds it).
   */
  assertCanHost(
    type: (typeof VEHICLE_TYPES)[number],
    facility: FacilityDto,
    points: number = type.capacityPoints,
  ): void {
    if (type.domain === 'WATER' && !this.isNauticalFacility(facility))
      throw new MockError(409, 'NEEDS_NAUTICAL_BASE', 'Boats can only be kept at a Base nautica', {
        reason: 'NEEDS_NAUTICAL_BASE',
        facilityTypeCode: facility.typeCode,
      });
    if (facility.status !== 'OPERATIONAL' || !type.compatibleFacilityTypes.includes(facility.typeCode))
      throw new MockError(409, 'CAPACITY_EXCEEDED', 'This facility cannot host that vehicle', {
        reason: facility.status !== 'OPERATIONAL' ? 'FACILITY_NOT_OPERATIONAL' : 'INCOMPATIBLE_FACILITY',
      });
    const cap = facility.capacities.find((c) => c.domain === type.domain);
    if (!cap || cap.total - cap.used < points)
      throw new MockError(409, 'CAPACITY_EXCEEDED', 'No room in this facility', {
        reason: 'NO_ROOM',
        domain: type.domain,
        total: cap?.total ?? 0,
        used: cap?.used ?? 0,
        needed: points,
        upgrade: type.domain === 'WATER' ? 'PIER' : type.domain === 'AIR' ? 'HELIPAD' : 'GARAGE',
      });
  }

  /** Where a vehicle of this type goes for this incident: boats and aircraft to the scene, land units to `position`. */
  destinationOf(vehicle: Pick<VehicleDto, 'typeCode'>, incident: IncidentDto): LngLat {
    const type = VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode);
    return type && type.domain !== 'GROUND' ? sceneOf(incident) : incident.position;
  }

  /** The outbound leg of a vehicle (a domain may plan it, e.g. a boat's trailer + water leg), else road / air. */
  legFor(career: MockCareer, vehicle: VehicleDto, incident: IncidentDto): MockLeg {
    for (const hook of this.hooks.planLeg) {
      const leg = hook(career, vehicle, incident);
      if (leg) return leg;
    }
    const to = this.destinationOf(vehicle, incident);
    const { path, distanceMeters } = this.route(
      vehicle.position,
      to,
      vehicle.id + incident.id,
      vehicle.typeCode,
    );
    return {
      path,
      distanceMeters,
      seconds: this.travelSeconds(distanceMeters, vehicle.typeCode, career, path),
    };
  }

  /** What a vehicle brings to this incident (a land unit at a water incident: its shore-side capabilities only). */
  sceneCapabilities(
    career: MockCareer,
    vehicle: VehicleDto,
    incident: IncidentDto,
  ): VehicleDto['capabilities'] {
    return this.hooks.sceneCapabilities.reduce(
      (caps, hook) => hook(career, vehicle, incident, caps),
      vehicle.capabilities,
    );
  }

  /** The movement DTO of a planned leg departing at `at`: its segments tile [departAt, arriveAt] exactly. */
  movementOf(leg: MockLeg, at: number, purpose: NonNullable<VehicleDto['movement']>['purpose']) {
    const arriveAt = at + this.dur(leg.seconds);
    const span = arriveAt - at;
    const total = Math.max(1e-6, leg.segments?.reduce((m, s) => Math.max(m, s.endSeconds), 0) ?? 0);
    const movement: NonNullable<VehicleDto['movement']> = {
      path: leg.path.length >= 2 ? leg.path : [leg.path[0]!, leg.path[0]!],
      departAt: iso(at),
      arriveAt: iso(arriveAt),
      distanceMeters: leg.distanceMeters,
      purpose,
      ...(leg.segments && leg.segments.length > 0
        ? {
            segments: leg.segments.map((s) => ({
              mode: s.mode,
              path: s.path,
              departAt: iso(at + (span * s.startSeconds) / total),
              arriveAt: iso(at + (span * s.endSeconds) / total),
              distanceMeters: s.meters,
            })),
          }
        : {}),
    };
    return { movement, arriveAt };
  }

  patchVehicle(career: MockCareer, id: string, patch: Partial<VehicleDto>): VehicleDto | null {
    let out: VehicleDto | null = null;
    career.vehicles = career.vehicles.map((v) =>
      v.id === id ? (out = this.view(career, { ...v, ...patch })) : v,
    );
    return out;
  }
  patchIncident(career: MockCareer, id: string, patch: Partial<IncidentDto>): IncidentDto | null {
    let out: IncidentDto | null = null;
    career.incidents = career.incidents.map((i) => (i.id === id ? (out = { ...i, ...patch }) : i));
    return out;
  }

  facilityDetail(career: MockCareer, facilityId: string) {
    const facility = career.facilities.find((f) => f.id === facilityId);
    if (!facility) throw new MockError(404, 'NOT_FOUND', 'Facility not found');
    const facilityType = FACILITY_TYPES.find((f) => f.code === facility.typeCode);
    // Like the backend: a facility type offers exactly the upgrades of its `upgradeCaps` (the Base nautica its Pontile,
    // no garage; a fire station no pier).
    const availableUpgrades = UPGRADE_TYPES.filter((u) =>
      facilityType ? (facilityType.upgradeCaps[u.code] ?? 0) > 0 : u.maxLevel > 0,
    ).map((u) => {
      const current = facility.upgrades.find((x) => x.code === u.code);
      const level = current?.level ?? 0;
      const building = !!current?.buildingUntil;
      const maxLevel = Math.min(u.maxLevel, facilityType?.upgradeCaps[u.code] ?? u.maxLevel);
      const lockedReason = building
        ? 'UPGRADE_IN_PROGRESS'
        : facility.status !== 'OPERATIONAL'
          ? 'FACILITY_NOT_OPERATIONAL'
          : level >= maxLevel
            ? 'MAX_LEVEL'
            : u.requiredLevel > career.summary.level
              ? 'LEVEL_TOO_LOW'
              : null;
      return {
        code: u.code,
        name: text(`upgrade.${u.code}.name`),
        description: text(`upgrade.${u.code}.description`),
        currentLevel: level,
        maxLevel,
        price: String(upgradePrice(u, level + 1)),
        requiredLevel: u.requiredLevel,
        buildSeconds: Math.round(upgradeBuildSeconds(u, level + 1) / this.speed),
        effect: { domain: u.domain, delta: u.delta },
        available: lockedReason === null,
        lockedReason,
      };
    });
    const extra = Object.assign({}, ...this.hooks.facilityDetail.map((h) => h(career, facility))) as Record<
      string,
      unknown
    >;
    return {
      ...facility,
      address: facility.address ?? career.facilityAddress[facilityId] ?? null,
      availableUpgrades,
      ...extra,
    };
  }

  buyUpgrade(career: MockCareer, facilityId: string, upgradeCode: string): FacilityDto {
    const offer = this.facilityDetail(career, facilityId).availableUpgrades.find(
      (u) => u.code === upgradeCode,
    );
    if (!offer) throw new MockError(404, 'NOT_FOUND', 'Unknown upgrade');
    if (!offer.available)
      throw new MockError(
        422,
        offer.lockedReason === 'LEVEL_TOO_LOW' ? 'LEVEL_TOO_LOW' : 'INVALID_STATE_TRANSITION',
        'Upgrade not available',
        { requiredLevel: offer.requiredLevel },
      );
    this.credit(
      career,
      -Number(offer.price),
      'FACILITY_UPGRADE',
      true,
      text('ledger.FACILITY_UPGRADE', { item: upgradeCode }),
    );
    const u = UPGRADE_TYPES.find((x) => x.code === upgradeCode)!;
    const buildSeconds = upgradeBuildSeconds(u, offer.currentLevel + 1);
    const until = iso(this.now() + this.dur(buildSeconds));
    career.facilities = career.facilities.map((f) =>
      f.id !== facilityId
        ? f
        : {
            ...f,
            upgrades: f.upgrades.some((x) => x.code === upgradeCode)
              ? f.upgrades.map((x) => (x.code === upgradeCode ? { ...x, buildingUntil: until } : x))
              : [...f.upgrades, { code: upgradeCode, level: 0, buildingUntil: until }],
          },
    );
    this.schedule(career, 'UPGRADE_DONE', buildSeconds, `${facilityId}|${upgradeCode}`);
    const facility = career.facilities.find((f) => f.id === facilityId)!;
    this.emit(career, 'facility.updated', { facility, career: career.summary });
    this.save();
    return facility;
  }

  private onUpgradeDone(career: MockCareer, ref: string): void {
    const [facilityId, code] = ref.split('|');
    const u = UPGRADE_TYPES.find((x) => x.code === code);
    if (!u) return;
    career.facilities = career.facilities.map((f) =>
      f.id !== facilityId
        ? f
        : {
            ...f,
            upgrades: f.upgrades.map((x) =>
              x.code === code ? { ...x, level: x.level + 1, buildingUntil: null } : x,
            ),
            capacities:
              u.domain === 'TRAINING'
                ? f.capacities
                : f.capacities.some((c) => c.domain === u.domain)
                  ? f.capacities.map((c) => (c.domain === u.domain ? { ...c, total: c.total + u.delta } : c))
                  : [...f.capacities, { domain: u.domain as 'AIR', total: u.delta, used: 0 }],
          },
    );
    const facility = career.facilities.find((f) => f.id === facilityId);
    if (facility) {
      this.emit(career, 'facility.updated', { facility });
      this.notify(career, {
        category: 'FACILITIES',
        title: text('notifications.upgradeDone', { facility: facility.name }),
        action: { kind: 'OPEN_FACILITY', targetId: facility.id },
      });
    }
  }

  /* ───────────── incidents ───────────── */
  activeCap(career: MockCareer): number {
    return levelRow(career.summary.level).maxActiveIncidents;
  }

  /**
   * Incidents that count in the active cap: the members of a major incident do not (D-69 — the major is its own event,
   * outside the cap), exactly like the backend's `countActive`.
   */
  activeCount(career: MockCareer): number {
    return career.incidents.filter((i) => !i.major).length;
  }

  scheduleSpawn(career: MockCareer): void {
    if (career.actions.some((a) => a.type === 'INCIDENT_SPAWN')) return;
    if (!career.summary.onDuty || !['BUY_VEHICLE', 'DONE', null].includes(career.summary.tutorial.step))
      return;
    // While a major incident runs, normal calls keep coming but `spawnSlowdown` (2.5×) slower (D-69).
    const slowdown = career.incidents.some((i) => i.major) ? MAJOR_SETTINGS.spawnSlowdown : 1;
    this.schedule(career, 'INCIDENT_SPAWN', (35 + this.random() * 50) * slowdown, career.summary.id);
  }

  private onSpawn(career: MockCareer): void {
    // D-11: nothing new while the player is away (no /sync for 3 real minutes) or off duty.
    const away = this.now() - career.lastSeenAt > 180_000;
    if (career.summary.onDuty && !away && this.activeCount(career) < this.activeCap(career)) {
      const pool = INCIDENT_TEMPLATES.filter(
        (t) =>
          !t.tutorial &&
          t.minLevel <= career.summary.level &&
          // Incidents of a family appear only after its unlock; the OTHER families of a mixed incident may still be locked:
          // their part is covered by external support (analisi/05 §4).
          career.summary.unlockedFamilies.includes(t.primaryFamily),
      )
        // Domain gates (water: only what the career's boats — or the Coast Guard — can handle, D-68).
        .map((t) => ({
          t,
          weight: this.hooks.spawnWeight.reduce((w, hook) => w * hook(career, t), t.weight),
        }))
        .filter((x) => x.weight > 0);
      const total = pool.reduce((s, x) => s + x.weight, 0);
      let r = this.random() * total;
      const picked = pool.find((x) => (r -= x.weight) <= 0) ?? pool[0];
      if (picked) this.spawnIncident(career, picked.t.code, false, { organic: true });
    }
    if (!away) this.scheduleSpawn(career);
  }

  spawnIncident(
    career: MockCareer,
    templateCode: string,
    tutorial: boolean,
    opts: SpawnOptions = {},
  ): IncidentDto {
    const t = INCIDENT_TEMPLATES.find((x) => x.code === templateCode);
    if (!t) throw new MockError(404, 'NOT_FOUND', 'Unknown incident template');
    // A domain may place it (a water template goes on the water, with its meeting point on the shore road).
    let place: SpawnPlace | null = null;
    for (const hook of this.hooks.spawnPlace) {
      place = hook(career, t, opts);
      if (place) break;
    }
    const base = career.facilities[0]!.position;
    const spots = INCIDENT_SPOTS.filter((s) => !career.incidents.some((i) => i.address === s.address));
    const sorted = [...spots].sort(
      (a, b) => haversineMeters(base, a.position) - haversineMeters(base, b.position),
    );
    const spot = place
      ? place
      : opts.position
        ? { position: opts.position, address: opts.address ?? INCIDENT_SPOTS[0]!.address }
        : tutorial
          ? (sorted.find((s) => haversineMeters(base, s.position) > 900) ?? sorted[0]!)
          : // `minDistanceMeters` (QA only): the nearest spot at or beyond that distance, so a test that needs an
            // OBSERVABLE travel phase does not depend on which random spot came out.
            opts.minDistanceMeters !== undefined
            ? (sorted.find((s) => haversineMeters(base, s.position) >= opts.minDistanceMeters!) ??
              sorted[sorted.length - 1]!)
            : (spots[Math.floor(this.random() * spots.length)] ?? INCIDENT_SPOTS[0]!);
    const municipality = place?.municipality ?? PESCARA.name;
    // Like the backend's `reportPlaceParams`: the report and radio say "{street}, {municipality}" — never the town twice.
    const suffix = `, ${municipality}`;
    const street = spot.address.endsWith(suffix) ? spot.address.slice(0, -suffix.length) : spot.address;
    // Severity: weighted by the template distribution, limited to bands the career level allows.
    const allowed = Object.entries(t.distribution).filter(
      ([sev]) => bandFor(t, Number(sev)).minLevel <= career.summary.level,
    );
    const pool = allowed.length ? allowed : Object.entries(t.distribution).slice(0, 1);
    let r = this.random() * pool.reduce((sum, [, w]) => sum + w, 0);
    const drawn = Number((pool.find(([, w]) => (r -= w) <= 0) ?? pool[0]!)[0]);
    const severity = opts.severity ?? (tutorial ? t.severity[0] : drawn);
    const band = bandFor(t, severity);
    const now = this.now();
    const reward = Math.round(t.baseReward * t.complexity * (0.7 + 0.1 * severity));
    const externalFamilies = t.families.filter(
      (f) => f !== 'UNG' && !career.summary.unlockedFamilies.includes(f),
    );
    const blocks = (n: number) => Math.floor(this.random() * n);
    const incident: IncidentDto = {
      id: this.id('inc'),
      templateCode: t.code,
      category: t.category,
      families: t.families,
      title: text(`incident.${t.code}.title`),
      // Block-composed text: the client picks intros[intro] + details[detail] + … from the catalog i18n bundle.
      report: text(`incident.${t.code}.report`, {
        intro: blocks(5),
        detail: blocks(4),
        condition: blocks(3),
        closing: blocks(3),
        address: street,
        municipality,
      }),
      summary: text(`incident.${t.code}.summary`),
      radio: text(`incident.${t.code}.radio`, { address: street, municipality }),
      icon: t.icon,
      municipality,
      street: spot.address,
      address: spot.address,
      position: spot.position,
      status: 'PENDING_RESPONSE',
      severity,
      escalating: false,
      createdAt: iso(now),
      expiresAt: tutorial ? null : iso(now + this.dur(600)),
      nextEscalationAt: tutorial ? null : iso(now + this.dur(240)),
      work: {
        total: band.workSeconds,
        remaining: band.workSeconds,
        ratePerSecond: 0,
        anchorAt: iso(now),
        estimatedEndAt: null,
      },
      coverageRatio: 0,
      requirements: band.requirements.map((req) => ({
        capability: req.capability,
        level: req.level,
        required: req.threshold,
        onScene: 0,
        enRoute: 0,
        family: req.family,
        external: externalFamilies.includes(req.family),
        externalSource: externalFamilies.includes(req.family) ? ('FAMILY' as const) : null,
      })),
      assignedVehicleIds: [],
      patientCount: 0,
      estimatedReward: { min: String(Math.round(reward * 0.5)), max: String(Math.round(reward * 1.2)) },
      isTutorial: tutorial,
      externalFamilies,
      externalSupport: [],
      rewardedAt: null,
      // Water scene (D-68): the marker on the water, land units at the meeting point (`position`) on the shore road.
      domain: place?.waterBody ? 'WATER' : 'LAND',
      waterBody: place?.waterBody ?? null,
      scenePosition: place?.scene ?? spot.position,
      meetingPoint: place?.waterBody ? spot.position : null,
      waterSupport: null,
    };
    career.incidents.push(incident);
    place?.onCreated?.(career, incident);
    this.log(career, incident.id, 'incident.created', text('timeline.incident_created'), now);
    if (!tutorial) {
      this.schedule(career, 'INCIDENT_EXPIRE', 600, incident.id);
      this.schedule(career, 'INCIDENT_ESCALATE', 240, incident.id);
    }
    for (const hook of this.hooks.incidentSpawned) hook(career, incident);
    opts.beforeAnnounce?.(career, career.incidents.find((i) => i.id === incident.id) ?? incident);
    const created = career.incidents.find((i) => i.id === incident.id) ?? incident;
    this.emit(career, 'incident.created', { incident: created });
    // A severe call is also traced in the notification centre (the backend's `fromDomainEvent`, `incident.created`):
    // never the tutorial nor a major's member (the major has its own alert).
    if (!tutorial && !created.major && created.severity >= SEVERE_INCIDENT_MIN_SEVERITY)
      this.notify(career, {
        category: 'OPERATIONS',
        priority: created.severity >= 9 ? 'CRITICAL' : 'IMPORTANT',
        title: { key: 'notification.SEVERE_INCIDENT.title', params: { fallback: 'Emergenza grave' } },
        body: {
          key: 'notification.SEVERE_INCIDENT.body',
          params: {
            severity: created.severity,
            address: created.address,
            fallback: `Nuova emergenza di gravità ${created.severity}: ${created.address}`,
          },
        },
        action: { kind: 'OPEN_INCIDENT', targetId: created.id },
      });
    return created;
  }

  /** Recompute requirement coverage + the anchored work model after any arrival/departure. */
  recompute(career: MockCareer, incidentId: string, at: number): IncidentDto | null {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) return null;
    const assigned = career.vehicles.filter((v) => v.incidentId === incidentId);
    // A land unit at a water incident counts only for what it does at the meeting point (D-68).
    const sum = (list: VehicleDto[], cap: string) =>
      list.reduce(
        (s, v) => s + (this.sceneCapabilities(career, v, incident).find((c) => c.code === cap)?.value ?? 0),
        0,
      );
    const onScene = assigned.filter((v) => v.status === 'ON_SCENE');
    const enRoute = assigned.filter((v) => v.status === 'PREPARING' || v.status === 'EN_ROUTE');
    const requirements = incident.requirements.map((r) => ({
      ...r,
      onScene: sum(onScene, r.capability),
      enRoute: sum(enRoute, r.capability),
    }));
    // Allied columns on scene (D-102) count like own units for the coverage and the work, never for the transport.
    const covered = (r: IncidentDto['requirements'][number]) => r.onScene + (r.allied ?? 0);
    const anyAllied = requirements.some((r) => (r.allied ?? 0) > 0);
    // Needs of a still-locked family are handled by external support: they never count against the player.
    const required = requirements.filter((r) => r.level === 'REQUIRED' && !r.external);
    const coverageRatio = required.length
      ? Math.min(...required.map((r) => Math.min(1, covered(r) / Math.max(1, r.required))))
      : onScene.length || anyAllied
        ? 1
        : 0;
    const recommended = requirements.filter((r) => r.level === 'RECOMMENDED' && !r.external);
    const bonus = recommended.length
      ? recommended.reduce((s, r) => s + Math.min(1, covered(r) / Math.max(1, r.required)), 0) /
        recommended.length
      : 0;
    // settle the work done since the previous anchor
    const elapsed = Math.max(0, (at - Date.parse(incident.work.anchorAt)) / 1000) * this.speed;
    const remaining = Math.max(0, incident.work.remaining - incident.work.ratePerSecond * elapsed);
    const rate = onScene.length || anyAllied ? Math.max(0.15, coverageRatio) * (1 + 0.3 * bonus) : 0;
    const endAt = rate > 0 ? at + this.dur(remaining / rate) : null;
    this.cancelActions(career, (a) => a.type === 'INCIDENT_WORK_DONE' && a.ref === incidentId);
    if (endAt !== null)
      career.actions.push({ id: this.id('act'), type: 'INCIDENT_WORK_DONE', dueAt: endAt, ref: incidentId });
    if (incident.status === 'RESOLVING') return incident;
    const status =
      onScene.length || anyAllied ? 'ON_SCENE' : enRoute.length ? 'RESPONDING' : 'PENDING_RESPONSE';
    return this.patchIncident(career, incidentId, {
      requirements,
      coverageRatio,
      status,
      assignedVehicleIds: assigned.map((v) => v.id),
      work: {
        ...incident.work,
        remaining,
        ratePerSecond: rate,
        anchorAt: iso(at),
        estimatedEndAt: endAt ? iso(endAt) : null,
      },
    });
  }

  route(
    from: LngLat,
    to: LngLat,
    seedText: string,
    typeCode?: string,
  ): { path: LngLat[]; distanceMeters: number } {
    // AIR vehicles fly straight at their own speed (analisi/07 §3).
    if (VEHICLE_TYPES.find((t) => t.code === typeCode)?.movement === 'AIR')
      return { path: [from, to], distanceMeters: haversineMeters(from, to) };
    let seed = 7;
    for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const path = mockRoute(from, to, seed);
    return { path, distanceMeters: pathLengthMeters(path) };
  }
  /** Travel seconds in game time: 42 km/h urban average × time compression 0.25 (D-63). */
  travelSeconds(distanceMeters: number, typeCode: string, career?: MockCareer, path?: LngLat[]): number {
    const type = VEHICLE_TYPES.find((t) => t.code === typeCode);
    if (type?.movement === 'AIR' && type.airSpeedKmh)
      return Math.max(8, Math.round((distanceMeters / (type.airSpeedKmh / 3.6)) * 0.25));
    const factor =
      career && path ? this.hooks.travelFactor.reduce((f, h) => f * h(career, path, typeCode), 1) : 1;
    return Math.max(8, Math.round((distanceMeters / (11.7 * (type?.speedFactor ?? 1))) * 0.25 * factor));
  }

  dispatchOptions(career: MockCareer, incidentId: string) {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
    const needed = incident.requirements.filter((r) => r.level !== 'OPTIONAL' && !r.external);
    const options: MockDispatchOption[] = career.vehicles
      .filter((v) => v.incidentId !== incidentId)
      .map((v) => {
        // Boats and aircraft go to the scene, land units to the meeting point of a water incident (D-68).
        const leg = this.legFor(career, v, incident);
        const dispatchable = v.status === 'AVAILABLE';
        const contributes = this.sceneCapabilities(career, v, incident).filter((c) =>
          incident.requirements.some((r) => r.capability === c.code),
        );
        const warnings: string[] = [];
        if (v.crew.assigned < v.crew.optimal) warnings.push('CREW_BELOW_OPTIMAL');
        if (v.health < 50) warnings.push('HEALTH_LOW');
        if (contributes.length === 0) warnings.push('NO_RELEVANT_CAPABILITY');
        const prep = VEHICLE_TYPES.find((t) => t.code === v.typeCode)?.preparationSeconds ?? 12;
        const option: MockDispatchOption = {
          vehicleId: v.id,
          etaSeconds: Math.round((prep + leg.seconds) / this.speed),
          distanceMeters: Math.round(leg.distanceMeters),
          dispatchable,
          blockedReason: dispatchable ? null : 'VEHICLE_NOT_AVAILABLE',
          warnings,
          contributes,
          recommended: false,
        };
        return this.hooks.dispatchOption.reduce((o, hook) => hook(career, v, o, incident), option);
      })
      .sort((a, b) => Number(b.dispatchable) - Number(a.dispatchable) || a.etaSeconds - b.etaSeconds);
    // greedy recommendation: fastest vehicles that still add missing REQUIRED/RECOMMENDED capability
    const missing = new Map(
      needed.map((r) => [r.capability, Math.max(0, r.required - r.onScene - r.enRoute)]),
    );
    const recommendedVehicleIds: string[] = [];
    // Never recommend more than one dispatch command may send (a major's scaled scene can ask for more: send the rest later).
    const perDispatch = this.maxVehiclesPerDispatch(incident);
    // A vehicle flagged by a domain (fuel reserve, out of range) stays selectable but is never recommended.
    for (const o of options.filter((x) => x.dispatchable && !x.notRecommended)) {
      if (recommendedVehicleIds.length >= perDispatch) break;
      const useful = o.contributes.some((c) => (missing.get(c.code) ?? 0) > 0);
      if (!useful) continue;
      recommendedVehicleIds.push(o.vehicleId);
      o.recommended = true;
      for (const c of o.contributes) missing.set(c.code, Math.max(0, (missing.get(c.code) ?? 0) - c.value));
    }
    const recommendationCoversRequired = incident.requirements
      .filter((r) => r.level === 'REQUIRED' && !r.external)
      .every((r) => (missing.get(r.capability) ?? 0) === 0);
    for (const o of options) delete o.notRecommended;
    return {
      options,
      recommendedVehicleIds,
      recommendationCoversRequired,
      maxVehiclesPerDispatch: perDispatch,
    };
  }

  /** How many vehicles ONE dispatch may send to this incident: 12 for a normal call, 24 on a major's incidents (D-69). */
  maxVehiclesPerDispatch(incident: Pick<IncidentDto, 'major'>): number {
    return incident.major ? MAJOR_SETTINGS.maxVehiclesPerDispatch : MAX_VEHICLES_PER_DISPATCH;
  }

  dispatch(
    career: MockCareer,
    incidentId: string,
    vehicleIds: string[],
    origin: MockDispatchRecord['origin'] = 'PLAYER',
  ) {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
    // A RESOLVING incident still accepts vehicles while a domain queue keeps it open (a patient waiting for an ambulance).
    const openQueue =
      incident.status === 'RESOLVING' && this.hooks.resolvingBlockers.some((h) => h(career, incident));
    if (!['PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE'].includes(incident.status) && !openQueue)
      throw new MockError(409, 'INCIDENT_NOT_DISPATCHABLE', 'Incident cannot receive vehicles');
    if (vehicleIds.length > this.maxVehiclesPerDispatch(incident))
      throw new MockError(400, 'VALIDATION_ERROR', 'Too many vehicles in one dispatch', {
        max: this.maxVehiclesPerDispatch(incident),
      });
    const vehicles = vehicleIds.map((id) => career.vehicles.find((v) => v.id === id));
    if (vehicles.some((v) => !v || v.status !== 'AVAILABLE'))
      throw new MockError(409, 'VEHICLE_NOT_AVAILABLE', 'One or more vehicles are not available', {
        vehicleIds: vehicleIds.filter((id, i) => vehicles[i]?.status !== 'AVAILABLE'),
      });
    for (const hook of this.hooks.dispatchCheck) hook(career, incident, vehicles as VehicleDto[]);
    const now = this.now();
    // What the free undo restores: the incident as it was, with the due times of its expiry / escalation actions.
    const dueOf = (type: string) =>
      career.actions.find((a) => a.type === type && a.ref === incidentId)?.dueAt ?? null;
    const prior: MockDispatchRecord['prior'] = {
      status: incident.status,
      expiresAt: incident.expiresAt,
      nextEscalationAt: incident.nextEscalationAt,
      escalating: incident.escalating,
      expireDueAt: dueOf('INCIDENT_EXPIRE'),
      escalateDueAt: dueOf('INCIDENT_ESCALATE'),
    };
    let firstDeparture = Number.POSITIVE_INFINITY;
    const updated: VehicleDto[] = [];
    for (const v of vehicles as VehicleDto[]) {
      this.log(
        career,
        incidentId,
        'dispatch.created',
        text('timeline.vehicle_dispatched', { callSign: v.callSign }),
        now,
        v.id,
      );
      // A vehicle at base that must reload first (D-22) leaves later: the seconds are already in its option's ETA.
      const reload = this.hooks.departureDelay.reduce((s, hook) => s + hook(career, v, incident, now), 0);
      const prep = (VEHICLE_TYPES.find((t) => t.code === v.typeCode)?.preparationSeconds ?? 12) + reload;
      const patched = this.patchVehicle(career, v.id, {
        status: 'PREPARING',
        incidentId,
        busyUntil: iso(now + this.dur(prep)),
      })!;
      updated.push(patched);
      this.schedule(career, 'VEHICLE_DEPART', prep, v.id);
      firstDeparture = Math.min(firstDeparture, now + this.dur(prep));
    }
    this.cancelActions(
      career,
      (a) => (a.type === 'INCIDENT_EXPIRE' || a.type === 'INCIDENT_ESCALATE') && a.ref === incidentId,
    );
    this.patchIncident(career, incidentId, { expiresAt: null, nextEscalationAt: null, escalating: false });
    const next = this.recompute(career, incidentId, now)!;
    this.emit(career, 'incident.updated', { incident: next, vehicles: updated });
    if (
      career.summary.tutorial.step === 'DISPATCH' ||
      career.summary.tutorial.step === 'SELECT_INCIDENT' ||
      career.summary.tutorial.step === 'WELCOME'
    )
      if (incident.isTutorial) this.advanceTutorial(career, 'WATCH_ARRIVAL');
    const record = this.recordDispatch(career, {
      incidentId,
      vehicleIds: updated.map((v) => v.id),
      at: now,
      origin,
      // Free undo: `cancelGraceSeconds` after the dispatch, or sooner when a vehicle leaves its origin sooner; never on the
      // tutorial, never for a dispatch the player did not make (a queue, a redirect).
      cancellableUntil:
        incident.isTutorial || origin !== 'PLAYER' ? null : Math.min(now + CANCEL_GRACE_MS, firstDeparture),
      prior,
    });
    this.save();
    return {
      dispatchId: record.id,
      incident: next,
      vehicles: updated,
      cancellableUntil: record.cancellableUntil === null ? null : iso(record.cancellableUntil),
    };
  }

  private recordDispatch(
    career: MockCareer,
    record: Omit<MockDispatchRecord, 'id' | 'cancelled'>,
  ): MockDispatchRecord {
    const full: MockDispatchRecord = { ...record, id: this.id('dsp'), cancelled: false };
    career.dispatches = [...(career.dispatches ?? []), full].slice(-50);
    return full;
  }

  /**
   * ★POST /dispatches/:id/cancel — the free undo (air-endurance.md §5): within `cancellableUntil`, and only while every
   * vehicle of the dispatch is still at its origin (PREPARING). Each one is AVAILABLE again as before (the domains give back
   * the crew and the reload before departure), the incident gets back its ORIGINAL expiry and escalation — never a new
   * window —, the timeline gets a neutral line, nothing is charged. A replay on a cancelled dispatch answers the same.
   */
  cancelDispatch(career: MockCareer, dispatchId: string) {
    const record = (career.dispatches ?? []).find((d) => d.id === dispatchId);
    if (!record) throw new MockError(404, 'NOT_FOUND', 'Dispatch not found');
    const incident = career.incidents.find((i) => i.id === record.incidentId);
    const result = () => ({
      dispatchId: record.id,
      status: 'CANCELLED' as const,
      incident: career.incidents.find((i) => i.id === record.incidentId) ?? incident!,
      vehicles: record.vehicleIds.flatMap((id) => {
        const v = career.vehicles.find((x) => x.id === id);
        return v ? [this.view(career, v)] : [];
      }),
    });
    if (record.cancelled && incident) return result();
    if (record.origin !== 'PLAYER')
      throw new MockError(409, 'DISPATCH_NOT_CANCELLABLE', 'Not a player dispatch', {
        reason: 'NOT_A_PLAYER_DISPATCH',
      });
    if (!incident)
      throw new MockError(409, 'DISPATCH_NOT_CANCELLABLE', 'The incident is closed', {
        reason: 'DISPATCH_CLOSED',
      });
    if (incident.isTutorial)
      throw new MockError(409, 'DISPATCH_NOT_CANCELLABLE', 'The tutorial dispatch stays', {
        reason: 'TUTORIAL',
      });
    const now = this.now();
    if (record.cancellableUntil === null || now > record.cancellableUntil)
      throw new MockError(409, 'CANCEL_WINDOW_EXPIRED', 'Too late to cancel: recall the vehicles instead', {
        dispatchedAt: iso(record.at),
        cancellableUntil: record.cancellableUntil === null ? null : iso(record.cancellableUntil),
      });
    // A vehicle recalled meanwhile (AVAILABLE again) does not stop the others from being cancelled.
    const vehicles = record.vehicleIds
      .map((id) => career.vehicles.find((v) => v.id === id))
      .filter((v): v is VehicleDto => !!v && v.incidentId === incident.id);
    const departed = vehicles.filter((v) => v.status !== 'PREPARING');
    if (departed.length > 0)
      throw new MockError(409, 'DISPATCH_NOT_CANCELLABLE', 'A vehicle has already left', {
        reason: 'VEHICLE_DEPARTED',
        vehicles: departed.map((v) => ({ id: v.id, status: v.status })),
      });
    const restored: VehicleDto[] = [];
    for (const v of vehicles) {
      this.cancelActions(career, (a) => a.ref === v.id && a.type === 'VEHICLE_DEPART');
      restored.push(
        this.patchVehicle(career, v.id, { status: 'AVAILABLE', incidentId: null, busyUntil: null })!,
      );
      this.log(
        career,
        incident.id,
        'vehicle.dispatch_cancelled',
        text('timeline.vehicle_dispatch_cancelled', { callSign: v.callSign }),
        now,
        v.id,
      );
    }
    for (const hook of this.hooks.dispatchCancelled) hook(career, restored, incident, now);
    record.cancelled = true;
    let next = this.recompute(career, incident.id, now) ?? incident;
    if (next.status === 'PENDING_RESPONSE' && record.prior.status === 'PENDING_RESPONSE') {
      // The ORIGINAL deadline (re-armed at the same instant, or at once if it passed meanwhile), never a new window.
      this.cancelActions(
        career,
        (a) => (a.type === 'INCIDENT_EXPIRE' || a.type === 'INCIDENT_ESCALATE') && a.ref === incident.id,
      );
      if (record.prior.expireDueAt !== null)
        career.actions.push({
          id: this.id('act'),
          type: 'INCIDENT_EXPIRE',
          dueAt: Math.max(now, record.prior.expireDueAt),
          ref: incident.id,
        });
      if (record.prior.escalateDueAt !== null)
        career.actions.push({
          id: this.id('act'),
          type: 'INCIDENT_ESCALATE',
          dueAt: Math.max(now, record.prior.escalateDueAt),
          ref: incident.id,
        });
      next =
        this.patchIncident(career, incident.id, {
          expiresAt: record.prior.expiresAt,
          nextEscalationAt: record.prior.nextEscalationAt,
          escalating: record.prior.escalating,
        }) ?? next;
    }
    this.emit(career, 'vehicle.updated', {
      vehicles: restored.map((v) => career.vehicles.find((x) => x.id === v.id) ?? v),
      dispatchCancelled: true,
    });
    this.emit(career, 'incident.updated', { incident: next });
    this.save();
    return result();
  }

  private onDepart(career: MockCareer, vehicleId: string, at: number): void {
    const v = career.vehicles.find((x) => x.id === vehicleId);
    const incident = v?.incidentId ? career.incidents.find((i) => i.id === v.incidentId) : undefined;
    if (!v || v.status !== 'PREPARING' || !incident) return;
    if (this.hooks.vehicleDeparting.some((hook) => hook(career, v, at) === 'BREAKDOWN')) {
      const next = this.recompute(career, incident.id, at);
      if (next) this.emit(career, 'incident.updated', { incident: next });
      return;
    }
    // A boat's leg may be mixed (trailer on the road, launch, water: D-68); everything else drives or flies straight.
    const leg = this.legFor(career, v, incident);
    const { movement, arriveAt } = this.movementOf(leg, at, 'TO_INCIDENT');
    const patched = this.patchVehicle(career, v.id, {
      status: 'EN_ROUTE',
      busyUntil: iso(arriveAt),
      movement,
    })!;
    career.legs.push({
      vehicleId: v.id,
      incidentId: incident.id,
      path: leg.path,
      distanceMeters: leg.distanceMeters,
      dispatchedAt: at,
      arrivedAt: null,
      ...(leg.fuelMeters !== undefined ? { fuelMeters: leg.fuelMeters } : {}),
      ...(leg.segments ? { segments: leg.segments } : {}),
    });
    career.actions.push({ id: this.id('act'), type: 'VEHICLE_ARRIVE', dueAt: arriveAt, ref: v.id });
    this.log(
      career,
      incident.id,
      'vehicle.departed',
      text('timeline.vehicle_departed', { callSign: v.callSign }),
      at,
      v.id,
    );
    this.emit(career, 'vehicle.departed', { vehicle: patched });
  }

  private onArrive(career: MockCareer, vehicleId: string, at: number): void {
    const v = career.vehicles.find((x) => x.id === vehicleId);
    if (!v || v.status !== 'EN_ROUTE' || !v.incidentId) return;
    const incident = career.incidents.find((i) => i.id === v.incidentId);
    if (!incident) {
      this.sendHome(career, v, at);
      return;
    }
    const patched = this.patchVehicle(career, v.id, {
      status: 'ON_SCENE',
      // Boats and aircraft work on the scene (on the water), land units at the meeting point (D-68).
      position: this.destinationOf(v, incident),
      movement: null,
      busyUntil: null,
    })!;
    const leg = career.legs.find(
      (l) => l.vehicleId === v.id && l.incidentId === incident.id && l.arrivedAt === null,
    );
    if (leg) leg.arrivedAt = at;
    career.firstArrival[incident.id] ??= at;
    this.log(
      career,
      incident.id,
      'vehicle.arrived',
      text('timeline.vehicle_arrived', { callSign: v.callSign }),
      at,
      v.id,
    );
    for (const hook of this.hooks.vehicleArrived) hook(career, patched, incident, at);
    const next = this.recompute(career, incident.id, at)!;
    this.emit(career, 'vehicle.arrived', { vehicle: patched, incident: next });
  }

  sendHome(career: MockCareer, v: VehicleDto, at: number, from?: LngLat): VehicleDto {
    const facility = career.facilities.find((f) => f.id === v.facilityId)!;
    const start = from ?? v.position;
    // A boat on the water goes home by water (landing the rescued first), then its trailer if it came by road (D-68).
    let home: MockLeg | null = null;
    for (const hook of this.hooks.planHome) {
      home = hook(career, v, start, at);
      if (home) break;
    }
    if (!home) {
      const { path, distanceMeters } = this.route(
        start,
        facility.position,
        v.id + 'home' + String(at),
        v.typeCode,
      );
      home = { path, distanceMeters, seconds: this.travelSeconds(distanceMeters, v.typeCode, career, path) };
    }
    const { movement, arriveAt } = this.movementOf(home, at, 'TO_BASE');
    this.cancelActions(
      career,
      (a) =>
        a.ref === v.id &&
        (a.type === 'VEHICLE_ARRIVE' || a.type === 'VEHICLE_DEPART' || a.type === 'VEHICLE_RETURNED'),
    );
    career.actions.push({ id: this.id('act'), type: 'VEHICLE_RETURNED', dueAt: arriveAt, ref: v.id });
    const returning = this.patchVehicle(career, v.id, {
      status: 'RETURNING',
      incidentId: null,
      position: start,
      busyUntil: iso(arriveAt),
      movement,
    })!;
    // Domains account the leg that just ended (fuel on scene / on the way) and may reshape the way home (fuel stop).
    for (const hook of this.hooks.vehicleSentHome) hook(career, v, returning, at);
    return career.vehicles.find((x) => x.id === v.id) ?? returning;
  }

  private onReturned(career: MockCareer, vehicleId: string, at: number = this.now()): void {
    const v = career.vehicles.find((x) => x.id === vehicleId);
    if (!v || v.status !== 'RETURNING') return;
    const facility = career.facilities.find((f) => f.id === v.facilityId)!;
    this.patchVehicle(career, v.id, {
      status: 'AVAILABLE',
      // A boat moors at its berth, on the water (D-68).
      position: this.homePositionOf(facility, v.typeCode),
      movement: null,
      busyUntil: null,
    });
    const leg = [...career.legs].reverse().find((l) => l.vehicleId === v.id) ?? null;
    // Wear, the resupply stop (D-22), crew fatigue and release are owned by the domain modules.
    for (const hook of this.hooks.vehicleReturned)
      hook(
        career,
        career.vehicles.find((x) => x.id === v.id)!,
        leg,
        at,
      );
    this.emit(career, 'vehicle.returned', { vehicle: career.vehicles.find((x) => x.id === v.id)! });
  }

  recall(career: MockCareer, vehicleId: string): VehicleDto {
    const v = career.vehicles.find((x) => x.id === vehicleId);
    if (!v) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
    if (!['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(v.status))
      throw new MockError(409, 'VEHICLE_NOT_RECALLABLE', 'Vehicle cannot be recalled now');
    const now = this.now();
    const incidentId = v.incidentId;
    let patched: VehicleDto;
    if (v.status === 'PREPARING') {
      this.cancelActions(career, (a) => a.ref === v.id && a.type === 'VEHICLE_DEPART');
      patched = this.patchVehicle(career, v.id, { status: 'AVAILABLE', incidentId: null, busyUntil: null })!;
    } else {
      // Where it is now — inside the current segment of a boat's mixed leg.
      const from = v.movement ? movementPoint(v.movement, now).position : v.position;
      patched = this.sendHome(career, v, now, from);
    }
    if (incidentId) {
      this.log(
        career,
        incidentId,
        'vehicle.recalled',
        text('timeline.vehicle_recalled', { callSign: v.callSign }),
        now,
        v.id,
      );
      const incident = this.recompute(career, incidentId, now);
      if (incident && incident.status === 'PENDING_RESPONSE' && !incident.isTutorial)
        this.schedule(career, 'INCIDENT_EXPIRE', 600, incidentId);
      this.emit(career, 'vehicle.returning', { vehicle: patched, ...(incident ? { incident } : {}) });
    } else this.emit(career, 'vehicle.updated', { vehicle: patched });
    this.save();
    return patched;
  }

  private onWorkDone(career: MockCareer, incidentId: string, at: number): void {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident || incident.status !== 'ON_SCENE') return;
    this.finishWork(career, incident, at);
  }

  /**
   * On-scene work is over. The reward is paid NOW (once); if queues remain — patients still to be transported, system
   * units (UNG) to call in — the incident stays RESOLVING until they are done, then leaves the world as RESOLVED.
   */
  finishWork(career: MockCareer, incident: IncidentDto, at: number): void {
    // The mission's consumption (D-22) is taken now, from the vehicles still on the incident.
    for (const hook of this.hooks.workDone) hook(career, incident, at);
    const t = INCIDENT_TEMPLATES.find((x) => x.code === incident.templateCode);
    const band = t ? bandFor(t, incident.severity) : null;
    const support = (band?.ung ?? [])
      .filter((u) => this.random() < u.probability)
      .slice(0, 3)
      .flatMap((u) => {
        const type = UNG_TYPES.find((x) => x.code === u.type);
        if (!type) return [];
        const id = this.id('ung');
        const arriveAt = at + this.dur(type.arrivalSeconds);
        career.ung[id] = incident.id;
        career.actions.push({ id: this.id('act'), type: 'UNG_ARRIVE', dueAt: arriveAt, ref: id });
        return [
          {
            id,
            unitTypeCode: type.code,
            name: text(`ung.${type.code}.name`),
            status: 'REQUESTED' as const,
            arriveAt: iso(arriveAt),
            completeAt: iso(arriveAt + this.dur(type.workSeconds)),
            keepsRoadClosed: type.keepsRoadClosed,
          },
        ];
      });
    const retained = new Set(this.hooks.retainVehicles.flatMap((h) => h(career, incident)));
    const blocked = this.hooks.resolvingBlockers.some((h) => h(career, incident));
    if (support.length === 0 && !blocked && retained.size === 0) {
      this.close(career, incident, 'RESOLVED', at);
      return;
    }
    this.cancelActions(career, (a) => a.ref === incident.id);
    const resolving = this.patchIncident(career, incident.id, {
      status: 'RESOLVING',
      externalSupport: support,
      rewardedAt: iso(at),
      work: { ...incident.work, remaining: 0, ratePerSecond: 0, anchorAt: iso(at), estimatedEndAt: null },
    })!;
    career.rewarded[incident.id] = true;
    const vehicles: VehicleDto[] = [];
    for (const v of career.vehicles.filter((x) => x.incidentId === incident.id && !retained.has(x.id)))
      vehicles.push(
        this.sendHome(career, v, at, v.status === 'ON_SCENE' ? this.destinationOf(v, incident) : undefined),
      );
    const { outcome } = this.reward(career, resolving, at);
    this.log(career, incident.id, 'incident.resolving', text('timeline.incident_resolving'), at);
    const next = this.patchIncident(career, incident.id, {
      assignedVehicleIds: career.vehicles.filter((v) => v.incidentId === incident.id).map((v) => v.id),
    })!;
    // Same sequence as the backend: `incident.resolved` fires when the reward is paid (status RESOLVING, `rewardedAt` set);
    // a later `incident.updated` carries the final RESOLVED.
    this.emit(career, 'incident.resolved', { incident: next, outcome, vehicles, career: career.summary });
    this.awardXp(career, Number(outcome.xp));
    if (incident.isTutorial && !career.summary.tutorial.completed) this.advanceTutorial(career, 'OUTCOME');
    this.scheduleSpawn(career);
  }

  /** Called by the core (UNG) and by domain modules (medical) whenever a RESOLVING queue item completes. */
  checkResolved(career: MockCareer, incidentId: string, at: number): void {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident || incident.status !== 'RESOLVING') return;
    const pendingUng = (incident.externalSupport ?? []).some(
      (u) => u.status === 'REQUESTED' || u.status === 'WORKING',
    );
    if (pendingUng || this.hooks.resolvingBlockers.some((h) => h(career, incident))) return;
    this.close(career, incident, 'RESOLVED', at);
  }

  private onUngArrive(career: MockCareer, ungId: string, at: number): void {
    const incident = career.incidents.find((i) => i.id === career.ung[ungId]);
    const unit = incident?.externalSupport?.find((u) => u.id === ungId);
    if (!incident || !unit) return;
    const next = this.patchIncident(career, incident.id, {
      externalSupport: incident.externalSupport!.map((u) =>
        u.id === ungId ? { ...u, status: 'WORKING' } : u,
      ),
    })!;
    career.actions.push({
      id: this.id('act'),
      type: 'UNG_DONE',
      dueAt: Math.max(at + 250, Date.parse(unit.completeAt)),
      ref: ungId,
    });
    this.log(
      career,
      incident.id,
      'ung.arrived',
      text('timeline.ung_arrived', { unit: unit.unitTypeCode }),
      at,
    );
    this.emit(career, 'incident.updated', { incident: next });
  }

  private onUngDone(career: MockCareer, ungId: string, at: number): void {
    const incident = career.incidents.find((i) => i.id === career.ung[ungId]);
    delete career.ung[ungId];
    if (!incident) return;
    const next = this.patchIncident(career, incident.id, {
      externalSupport: (incident.externalSupport ?? []).map((u) =>
        u.id === ungId ? { ...u, status: 'DONE' } : u,
      ),
    })!;
    this.log(career, incident.id, 'ung.done', text('timeline.ung_done'), at);
    this.emit(career, 'incident.updated', { incident: next });
    this.checkResolved(career, incident.id, at);
  }
  private onExpire(career: MockCareer, incidentId: string, at: number): void {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident || incident.status !== 'PENDING_RESPONSE') return;
    this.close(career, incident, 'EXPIRED', at);
  }
  private onEscalate(career: MockCareer, incidentId: string, at: number): void {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident || incident.status !== 'PENDING_RESPONSE' || incident.severity >= 10) return;
    const next = this.patchIncident(career, incidentId, {
      severity: incident.severity + 1,
      escalating: true,
      nextEscalationAt: null,
    })!;
    this.log(
      career,
      incidentId,
      'incident.escalated',
      text('timeline.incident_escalated', { severity: next.severity }),
      at,
    );
    this.emit(career, 'incident.escalated', { incident: next });
  }

  /** Computes and pays the mission reward exactly once (ledger + XP are applied by the caller for XP). */
  reward(career: MockCareer, incident: IncidentDto, at: number): { outcome: IncidentOutcomeDto } {
    const t = INCIDENT_TEMPLATES.find((x) => x.code === incident.templateCode)!;
    const created = Date.parse(incident.createdAt);
    const firstArrival = career.firstArrival[incident.id] ?? at;
    const responseSeconds = Math.round(((firstArrival - created) / 1000) * this.speed);
    const durationSeconds = Math.round(((at - created) / 1000) * this.speed);
    // The Coast Guard did the water part (D-68): reward and XP × its share (0.6), never a failure for the missing boat.
    const share = incident.waterSupport?.rewardShare ?? 1;
    const gross = Math.round(t.baseReward * t.complexity * (0.7 + 0.1 * incident.severity) * share);
    const timeliness = Math.max(0, Math.min(1, 1.15 - responseSeconds / 240));
    const adequacy = incident.coverageRatio;
    const patients = this.hooks.patientOutcome
      .map((h) => h(career, incident))
      .find((x): x is number => x !== null);
    const quality = Math.max(
      0.5,
      Math.min(
        1.2,
        patients === undefined
          ? 0.35 + 0.5 * timeliness + 0.35 * adequacy
          : 0.3 + 0.4 * timeliness + 0.3 * adequacy + 0.2 * patients,
      ),
    );
    const legs = career.legs.filter((l) => l.incidentId === incident.id);
    const travel = Math.round(legs.reduce((s, l) => s + (l.distanceMeters / 1000) * 2 * 1.5, 0));
    const scene = Math.round(
      legs.reduce((s, l) => s + (l.arrivedAt ? ((at - l.arrivedAt) / 60_000) * this.speed * 2 : 0), 0),
    );
    const net = Math.max(Math.round(gross * 0.3), Math.round(gross * quality) - travel - scene);
    const tutorialXp = incident.isTutorial ? 40 : 0;
    const xp = Math.round(t.baseXp * (0.7 + 0.1 * incident.severity) * quality * share) + tutorialXp;
    const stars = quality >= 1 ? 3 : quality >= 0.8 ? 2 : 1;
    const notes: I18nText[] = [];
    if (timeliness >= 0.8) notes.push(text('outcome.note.FAST_RESPONSE'));
    if (adequacy < 1) notes.push(text('outcome.note.UNDER_RESOURCED'));
    if ((incident.externalFamilies ?? []).length) notes.push(text('outcome.note.EXTERNAL_SUPPORT'));
    if (incident.waterSupport) notes.push(text('outcome.note.COAST_GUARD'));
    if (incident.isTutorial) notes.push(text('outcome.note.TUTORIAL_BONUS'));
    // A member of a major incident moves no reputation of its own: the major's final step does (D-69).
    const member = !!incident.major;
    if (member) notes.push(text('major.note.MEMBER'));
    const outcome: IncidentOutcomeDto = {
      incidentId: incident.id,
      result: adequacy >= 1 ? 'SUCCESS' : 'PARTIAL',
      stars,
      responseSeconds,
      durationSeconds,
      grossCredits: String(gross),
      costs: [
        { code: 'TRAVEL', amount: String(travel) },
        { code: 'ON_SCENE', amount: String(scene) },
      ],
      netCredits: String(net),
      xp: String(xp),
      reputationDelta: member ? 0 : stars - 1,
      notes,
    };
    career.pendingOutcomes.push(outcome);
    career.stats.resolved += 1;
    career.away.resolved += 1;
    career.away.credits += net;
    career.away.xp += xp;
    this.credit(
      career,
      net,
      'MISSION_REWARD',
      true,
      text('ledger.MISSION_REWARD', { incident: incident.templateCode }),
    );
    if (incident.isTutorial) this.credit(career, TUTORIAL_BONUS, 'MILESTONE', true, text('ledger.MILESTONE'));
    if (!member)
      career.summary = {
        ...career.summary,
        reputation: Math.max(0, Math.min(100, career.summary.reputation + (stars - 1))),
      };
    return { outcome };
  }

  close(
    career: MockCareer,
    incident: IncidentDto,
    status: 'RESOLVED' | 'FAILED' | 'EXPIRED' | 'CANCELLED',
    at: number,
  ): void {
    const closed: IncidentDto = {
      ...incident,
      status,
      work: {
        ...incident.work,
        remaining: status === 'RESOLVED' ? 0 : incident.work.remaining,
        ratePerSecond: 0,
        anchorAt: iso(at),
        estimatedEndAt: null,
      },
    };
    career.incidents = career.incidents.filter((i) => i.id !== incident.id);
    this.cancelActions(career, (a) => a.ref === incident.id);
    for (const [ungId, incidentId] of Object.entries(career.ung))
      if (incidentId === incident.id) {
        delete career.ung[ungId];
        this.cancelActions(career, (a) => a.ref === ungId);
      }
    const vehicles: VehicleDto[] = [];
    for (const v of career.vehicles.filter(
      (x) => x.incidentId === incident.id && ['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(x.status),
    ))
      vehicles.push(
        this.sendHome(career, v, at, v.status === 'ON_SCENE' ? this.destinationOf(v, incident) : undefined),
      );
    for (const hook of this.hooks.incidentClosed) hook(career, closed, status);

    if (status === 'RESOLVED') {
      const alreadyRewarded = career.rewarded[incident.id] === true;
      delete career.rewarded[incident.id];
      const outcome = alreadyRewarded ? null : this.reward(career, closed, at).outcome;
      this.log(career, incident.id, 'incident.resolved', text('timeline.incident_resolved'), at);
      this.emit(career, alreadyRewarded ? 'incident.updated' : 'incident.resolved', {
        incident: closed,
        ...(outcome ? { outcome } : {}),
        vehicles,
        career: career.summary,
      });
      if (outcome) {
        this.awardXp(career, Number(outcome.xp));
        if (incident.isTutorial && !career.summary.tutorial.completed)
          this.advanceTutorial(career, 'OUTCOME');
      }
    } else if (status === 'CANCELLED') {
      this.log(career, incident.id, 'incident.cancelled', text('timeline.incident_cancelled'), at);
      this.emit(career, 'incident.cancelled', { incident: closed, vehicles, career: career.summary });
    } else {
      career.stats.failed += 1;
      career.away.failed += 1;
      // A major's member moves no reputation of its own (its major's final step does, D-69).
      if (!incident.major)
        career.summary = { ...career.summary, reputation: Math.max(0, career.summary.reputation - 2) };
      this.log(
        career,
        incident.id,
        `incident.${status.toLowerCase()}`,
        text('timeline.incident_expired'),
        at,
      );
      this.emit(career, status === 'EXPIRED' ? 'incident.expired' : 'incident.failed', {
        incident: closed,
        vehicles,
        career: career.summary,
      });
      this.notify(career, {
        category: 'OPERATIONS',
        priority: 'IMPORTANT',
        title: text('notifications.incidentExpired', { address: incident.address }),
      });
    }
    this.scheduleSpawn(career);
  }

  /* ───────────── tutorial, duty, sync ───────────── */
  static readonly TUTORIAL_STEPS = [
    'WELCOME',
    'SELECT_INCIDENT',
    'DISPATCH',
    'WATCH_ARRIVAL',
    'OUTCOME',
    'BUY_VEHICLE',
    'DONE',
  ];
  advanceTutorial(career: MockCareer, step: string): CareerSummary {
    const order = MockEngine.TUTORIAL_STEPS;
    const current = order.indexOf(career.summary.tutorial.step ?? 'DONE');
    const target = order.indexOf(step);
    if (target === -1) throw new MockError(422, 'VALIDATION_ERROR', 'Unknown tutorial step');
    if (target > current && !career.summary.tutorial.completed) {
      const done = step === 'DONE';
      career.summary = { ...career.summary, tutorial: { completed: done, step: done ? null : step } };
      this.emit(career, 'career.updated', { career: career.summary });
      this.scheduleSpawn(career);
      this.save();
    }
    return career.summary;
  }

  setDuty(career: MockCareer, onDuty: boolean): CareerSummary {
    career.summary = { ...career.summary, onDuty };
    if (!onDuty) this.cancelActions(career, (a) => a.type === 'INCIDENT_SPAWN');
    else this.scheduleSpawn(career);
    this.emit(career, 'career.updated', { career: career.summary });
    this.save();
    return career.summary;
  }

  /** The world context of the career right now (day phase, weather, traffic…), as the snapshot serves it. */
  world(career: MockCareer): SyncSnapshot['world'] {
    const now = this.now();
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: PESCARA.timezone }).format(
        now,
      ),
    );
    const baseWorld: SyncSnapshot['world'] = {
      localTime: iso(now),
      timezone: PESCARA.timezone,
      dayPhase: hour >= 7 && hour < 19 ? 'DAY' : hour >= 21 || hour < 5 ? 'NIGHT' : 'TWILIGHT',
      weather: { code: 'CLEAR', temperatureC: 21, windKmh: 9, degraded: false },
      trafficLevel: hour >= 8 && hour <= 9 ? 'MODERATE' : 'LIGHT',
      closures: [],
    };
    return this.hooks.world.reduce((w, hook) => hook(career, w), baseWorld);
  }

  snapshot(career: MockCareer): SyncSnapshot {
    // Derived read models may have moved without a patch (a level-up unlocking autonomy, a shelf refilled): refresh them.
    career.vehicles = career.vehicles.map((v) => this.view(career, v));
    const base: SyncSnapshot = {
      seq: career.seq,
      career: career.summary,
      facilities: career.facilities,
      vehicles: career.vehicles,
      incidents: career.incidents,
      world: this.world(career),
      pendingOutcomes: career.pendingOutcomes,
      unreadNotifications: career.notifications.filter((n) => !n.readAt).length,
      featureFlags: this.state.featureFlags,
      configVersion: 'mock-1',
    };
    return this.hooks.snapshotView.reduce((snap, hook) => hook(career, snap), base);
  }

  /** Heartbeat: a /sync call marks the player as present and restarts generation after an absence. */
  touch(career: MockCareer): void {
    const now = this.now();
    if (now - career.lastSeenAt > 180_000) career.awayFrom ??= career.lastSeenAt;
    else if (career.awayFrom === null)
      career.away = { since: now, resolved: 0, failed: 0, credits: 0, xp: 0, stipend: 0 };
    career.lastSeenAt = now;
    for (const hook of this.hooks.touched) hook(career);
    this.scheduleSpawn(career);
    this.save();
  }

  awayReport(career: MockCareer) {
    const a = career.away;
    const from = career.awayFrom;
    career.awayFrom = null;
    if (from === null || (a.resolved === 0 && a.failed === 0 && a.stipend === 0)) return null;
    const events: I18nText[] = [];
    if (a.resolved) events.push(text('away.event.RESOLVED', { count: a.resolved }));
    if (a.stipend) events.push(text('away.event.STIPEND', { amount: a.stipend }));
    const report = {
      since: iso(from),
      incidentsResolved: a.resolved,
      incidentsFailed: a.failed,
      creditsEarned: String(a.credits),
      xpEarned: String(a.xp),
      stipendPaid: String(a.stipend),
      events,
    };
    career.away = { since: this.now(), resolved: 0, failed: 0, credits: 0, xp: 0, stipend: 0 };
    return report;
  }

  ackOutcome(career: MockCareer, incidentId: string): void {
    career.pendingOutcomes = career.pendingOutcomes.filter((o) => o.incidentId !== incidentId);
    if (career.summary.tutorial.step === 'OUTCOME') this.advanceTutorial(career, 'BUY_VEHICLE');
    this.save();
  }
}
