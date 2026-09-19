import type {
  CareerSummary,
  FacilityDto,
  I18nText,
  TimelineEntryDto,
  IncidentDto,
  IncidentOutcomeDto,
  RealtimeEnvelope,
  RealtimeEventType,
  SyncSnapshot,
  UserDto,
  VehicleDto,
} from '@/contracts';
import type { NotificationDto } from '@/lib/api/assumed';
import { haversineMeters, pathLengthMeters, pointAlong, type LngLat } from '@/lib/geo';
import {
  FACILITY_TYPES,
  INCIDENT_TEMPLATES,
  UPGRADE_TYPES,
  VEHICLE_TYPES,
  levelForXp,
  upgradePrice,
  xpThreshold,
  FAMILIES,
} from './data/catalog';
import { INCIDENT_SPOTS, PESCARA, STARTER_SITES, mockRoute } from './data/pescara';
import { newId } from './ulid';

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

type ActionType =
  | 'INCIDENT_SPAWN'
  | 'VEHICLE_DEPART'
  | 'VEHICLE_ARRIVE'
  | 'INCIDENT_WORK_DONE'
  | 'VEHICLE_RETURNED'
  | 'VEHICLE_DELIVERED'
  | 'UPGRADE_DONE'
  | 'INCIDENT_EXPIRE'
  | 'INCIDENT_ESCALATE'
  | 'STIPEND';
interface Action {
  id: string;
  type: ActionType;
  dueAt: number;
  ref: string;
}

interface LedgerRow {
  id: string;
  amount: string;
  balanceAfter: string;
  entryType: string;
  description: I18nText;
  createdAt: string;
}
interface DispatchLeg {
  vehicleId: string;
  incidentId: string;
  path: LngLat[];
  distanceMeters: number;
  dispatchedAt: number;
  arrivedAt: number | null;
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
}

interface MockUser {
  user: UserDto;
  marketingConsent: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';
  sessions: { id: string; userAgent: string | null; createdAt: string; lastUsedAt: string }[];
}

export interface MockState {
  version: 3;
  users: Record<string, MockUser>; // by email
  challenges: Record<string, { email: string; expiresAt: number; attempts: number }>;
  currentSession: { email: string; sessionId: string } | null;
  careers: Record<string, MockCareer>;
  sites: Record<string, string>; // siteId → starter key
  featureFlags: Record<string, boolean>;
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

const STORAGE_KEY = 'rc-mock-db-v3';
export const localStorageAdapter = (): MockStorage => ({
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MockState;
      return parsed.version === 3 ? parsed : null;
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

const iso = (ms: number) => new Date(ms).toISOString();
const text = (key: string, params?: Record<string, string | number>): I18nText =>
  params ? { key, params } : { key };
export const OTP_CODE = '123456';
const ADMIN_EMAIL = 'admin@rescue-control.test';

export class MockEngine {
  state: MockState;
  private readonly storage: MockStorage;
  readonly now: () => number;
  private readonly random: () => number;
  readonly speed: number;
  private readonly emitFn: (e: RealtimeEnvelope) => void;
  accessTokens = new Map<string, string>(); // token → email

  constructor(opts: EngineOptions) {
    this.storage = opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.speed = opts.speed ?? 1;
    this.emitFn = opts.emit ?? (() => undefined);
    this.state = this.storage.load() ?? {
      version: 3,
      users: {},
      challenges: {},
      currentSession: null,
      careers: {},
      sites: {},
      featureFlags: { rewardedAds: false, creditShop: false, soundEffects: true },
    };
  }

  save(): void {
    this.storage.save(this.state);
  }
  reset(): void {
    this.state = {
      version: 3,
      users: {},
      challenges: {},
      currentSession: null,
      careers: {},
      sites: {},
      featureFlags: this.state.featureFlags,
    };
    this.accessTokens.clear();
    this.save();
  }
  private dur(seconds: number): number {
    return Math.max(250, (seconds * 1000) / this.speed);
  }
  private id(prefix: string): string {
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
          roles: ch.email === ADMIN_EMAIL ? ['USER', 'SUPER_ADMIN'] : ['USER'],
          createdAt: iso(now),
          activeCareerId: null,
        },
        marketingConsent: !!body.marketingConsent,
        status: 'ACTIVE',
        sessions: [],
      };
      this.state.users[ch.email] = account;
    }
    delete this.state.challenges[body.challengeId];
    const sessionId = `ses_${this.id('x').slice(2)}`;
    account.sessions.push({ id: sessionId, userAgent, createdAt: iso(now), lastUsedAt: iso(now) });
    this.state.currentSession = { email: ch.email, sessionId };
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
    const type = FACILITY_TYPES[0]!;
    const facility: FacilityDto = {
      id: facilityId,
      typeCode: type.code,
      family: 'FIRE',
      name: site.name,
      position: site.position,
      status: 'OPERATIONAL',
      capacities: [
        { domain: 'GROUND', total: site.capacityPoints, used: 0 },
        { domain: 'PERSONNEL', total: site.capacityPoints * 4, used: 5 },
        { domain: 'STORAGE', total: 10, used: 2 },
        { domain: 'WORKSHOP', total: 0, used: 0 },
      ],
      upgrades: [],
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
    };
    this.state.careers[careerId] = career;
    account.user.activeCareerId = careerId;
    this.credit(career, 400, 'STARTER_GRANT', true);
    this.addVehicle(career, 'FIRE_APS', facilityId, true);
    this.spawnIncident(career, 'CAR_FIRE', true);
    this.schedule(career, 'STIPEND', 4 * 3600, careerId, true);
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
  private schedule(
    career: MockCareer,
    type: ActionType,
    seconds: number,
    ref: string,
    realTime = false,
  ): void {
    career.actions.push({
      id: this.id('act'),
      type,
      dueAt: this.now() + (realTime ? seconds * 1000 : this.dur(seconds)),
      ref,
    });
  }
  private cancelActions(career: MockCareer, pred: (a: Action) => boolean): void {
    career.actions = career.actions.filter((a) => !pred(a));
  }

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
        this.onReturned(career, action.ref);
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
      case 'STIPEND':
        this.onStipend(career);
        break;
    }
  }

  /* ───────────── events ───────────── */
  private emit(career: MockCareer, type: RealtimeEventType, payload: Record<string, unknown>): void {
    career.seq += 1;
    const now = iso(this.now());
    this.emitFn({
      type,
      v: 1,
      careerId: career.summary.id,
      seq: career.seq,
      occurredAt: now,
      serverTime: now,
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
    });
  }
  private log(
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
  private notify(career: MockCareer, kind: string, title: I18nText, incidentId?: string): void {
    const n: NotificationDto = {
      id: this.id('ntf'),
      kind,
      title,
      body: null,
      createdAt: iso(this.now()),
      readAt: null,
      incidentId: incidentId ?? null,
    };
    career.notifications.unshift(n);
    career.notifications = career.notifications.slice(0, 50);
    this.emit(career, 'notification.created', {
      notification: n,
      unreadNotifications: career.notifications.filter((x) => !x.readAt).length,
    });
  }

  /* ───────────── economy ───────────── */
  private credit(
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
    if (!silent) this.emit(career, 'credits.changed', { credits: String(balance), career: career.summary });
  }

  private awardXp(career: MockCareer, xp: number): void {
    const total = Number(career.summary.xp) + xp;
    const before = career.summary.level;
    const level = levelForXp(total);
    const unlocked = FAMILIES.filter((f) => f.code !== 'UNG' && f.requiredLevel <= level).map((f) => f.code);
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
        ...FAMILIES.filter((f) => f.requiredLevel > before && f.requiredLevel <= level).map((f) => f.code),
      ];
      if (codes.length) this.emit(career, 'unlock.granted', { unlocks: codes });
      this.notify(career, 'LEVEL_UP', text('notifications.levelUp', { level }));
    }
  }

  private onStipend(career: MockCareer): void {
    const amount = Math.round(
      (60 + career.summary.level * 25) * ((career.summary.coveragePct ?? 50) >= 70 ? 1 : 0.8),
    );
    this.credit(career, amount, 'COVERAGE_STIPEND', true);
    career.away.stipend += amount;
    this.emit(career, 'stipend.paid', { amount: String(amount), career: career.summary });
    this.schedule(career, 'STIPEND', 4 * 3600, career.summary.id, true);
  }

  /* ───────────── vehicles & shop ───────────── */
  private addVehicle(career: MockCareer, typeCode: string, facilityId: string, instant: boolean): VehicleDto {
    const type = VEHICLE_TYPES.find((t) => t.code === typeCode)!;
    const facility = career.facilities.find((f) => f.id === facilityId)!;
    const n = (career.callSignCounters[typeCode] = (career.callSignCounters[typeCode] ?? 0) + 1);
    const short = typeCode.split('_').slice(1).join('') || typeCode;
    const vehicle: VehicleDto = {
      id: this.id('veh'),
      typeCode,
      family: type.family,
      callSign: `${short} ${n}`,
      facilityId,
      status: instant ? 'AVAILABLE' : 'IN_DELIVERY',
      position: facility.position,
      movement: null,
      incidentId: null,
      capabilities: Object.entries(type.caps).map(([code, value]) => ({ code, value })),
      health: 100,
      healthBand: 'EXCELLENT',
      crew: { min: type.crewMin, optimal: type.crewOptimal, assigned: type.crewOptimal },
      busyUntil: instant ? null : iso(this.now() + this.dur(type.deliverySeconds)),
    };
    career.vehicles.push(vehicle);
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
    return vehicle;
  }

  buyVehicle(career: MockCareer, body: { vehicleTypeCode: string; facilityId: string }): VehicleDto {
    const type = VEHICLE_TYPES.find((t) => t.code === body.vehicleTypeCode);
    const facility = career.facilities.find((f) => f.id === body.facilityId);
    if (!type || !facility) throw new MockError(404, 'NOT_FOUND', 'Unknown vehicle type or facility');
    if (type.requiredLevel > career.summary.level)
      throw new MockError(422, 'LEVEL_TOO_LOW', 'Level too low', { requiredLevel: type.requiredLevel });
    if (!career.summary.unlockedFamilies.includes(type.family))
      throw new MockError(422, 'NOT_UNLOCKED', 'Family not unlocked');
    const cap = facility.capacities.find((c) => c.domain === type.domain);
    if (!cap || cap.total - cap.used < type.capacityPoints)
      throw new MockError(422, 'CAPACITY_EXCEEDED', 'No room in this facility', { domain: type.domain });
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
    this.notify(
      career,
      'VEHICLE_DELIVERED',
      text('notifications.vehicleDelivered', { callSign: v.callSign }),
    );
  }

  private patchVehicle(career: MockCareer, id: string, patch: Partial<VehicleDto>): VehicleDto | null {
    let out: VehicleDto | null = null;
    career.vehicles = career.vehicles.map((v) => (v.id === id ? (out = { ...v, ...patch }) : v));
    return out;
  }
  private patchIncident(career: MockCareer, id: string, patch: Partial<IncidentDto>): IncidentDto | null {
    let out: IncidentDto | null = null;
    career.incidents = career.incidents.map((i) => (i.id === id ? (out = { ...i, ...patch }) : i));
    return out;
  }

  facilityDetail(career: MockCareer, facilityId: string) {
    const facility = career.facilities.find((f) => f.id === facilityId);
    if (!facility) throw new MockError(404, 'NOT_FOUND', 'Facility not found');
    const availableUpgrades = UPGRADE_TYPES.map((u) => {
      const current = facility.upgrades.find((x) => x.code === u.code);
      const level = current?.level ?? 0;
      const building = !!current?.buildingUntil;
      const lockedReason = building
        ? 'UPGRADE_IN_PROGRESS'
        : level >= u.maxLevel
          ? 'MAX_LEVEL'
          : u.requiredLevel > career.summary.level
            ? 'LEVEL_TOO_LOW'
            : null;
      return {
        code: u.code,
        name: text(`catalog.upgrade.${u.code}.name`),
        description: text(`catalog.upgrade.${u.code}.description`),
        currentLevel: level,
        maxLevel: u.maxLevel,
        price: String(upgradePrice(u, level + 1)),
        requiredLevel: u.requiredLevel,
        buildSeconds: Math.round(u.buildSeconds / this.speed),
        effect: { domain: u.domain, delta: u.delta },
        available: lockedReason === null,
        lockedReason,
      };
    });
    return { ...facility, address: career.facilityAddress[facilityId] ?? null, availableUpgrades };
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
    const until = iso(this.now() + this.dur(u.buildSeconds));
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
    this.schedule(career, 'UPGRADE_DONE', u.buildSeconds, `${facilityId}|${upgradeCode}`);
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
            capacities: f.capacities.some((c) => c.domain === u.domain)
              ? f.capacities.map((c) => (c.domain === u.domain ? { ...c, total: c.total + u.delta } : c))
              : [...f.capacities, { domain: u.domain as 'AIR', total: u.delta, used: 0 }],
          },
    );
    const facility = career.facilities.find((f) => f.id === facilityId);
    if (facility) {
      this.emit(career, 'facility.updated', { facility });
      this.notify(career, 'UPGRADE_DONE', text('notifications.upgradeDone', { facility: facility.name }));
    }
  }

  /* ───────────── incidents ───────────── */
  private activeCap(career: MockCareer): number {
    return 2 + Math.floor(career.summary.level / 2);
  }

  private scheduleSpawn(career: MockCareer): void {
    if (career.actions.some((a) => a.type === 'INCIDENT_SPAWN')) return;
    if (!career.summary.onDuty || !['BUY_VEHICLE', 'DONE', null].includes(career.summary.tutorial.step))
      return;
    this.schedule(career, 'INCIDENT_SPAWN', 35 + this.random() * 50, career.summary.id);
  }

  private onSpawn(career: MockCareer): void {
    // D-11: nothing new while the player is away (no /sync for 3 real minutes) or off duty.
    const away = this.now() - career.lastSeenAt > 180_000;
    if (career.summary.onDuty && !away && career.incidents.length < this.activeCap(career)) {
      const pool = INCIDENT_TEMPLATES.filter(
        (t) =>
          t.minLevel <= career.summary.level &&
          t.families.every((f) => career.summary.unlockedFamilies.includes(f)),
      );
      const total = pool.reduce((s, t) => s + t.weight, 0);
      let r = this.random() * total;
      const template = pool.find((t) => (r -= t.weight) <= 0) ?? pool[0]!;
      this.spawnIncident(career, template.code, false);
    }
    if (!away) this.scheduleSpawn(career);
  }

  private spawnIncident(career: MockCareer, templateCode: string, tutorial: boolean): IncidentDto {
    const t = INCIDENT_TEMPLATES.find((x) => x.code === templateCode)!;
    const base = career.facilities[0]!.position;
    const spots = INCIDENT_SPOTS.filter((s) => !career.incidents.some((i) => i.address === s.address));
    const sorted = [...spots].sort(
      (a, b) => haversineMeters(base, a.position) - haversineMeters(base, b.position),
    );
    const spot = tutorial
      ? (sorted.find((s) => haversineMeters(base, s.position) > 900) ?? sorted[0]!)
      : (spots[Math.floor(this.random() * spots.length)] ?? INCIDENT_SPOTS[0]!);
    const severity = tutorial
      ? 3
      : t.severity[0] + Math.floor(this.random() * (t.severity[1] - t.severity[0] + 1));
    const scale = 1 + 0.12 * (severity - t.severity[0]);
    const now = this.now();
    const reward = Math.round(t.baseReward * (0.7 + 0.1 * severity));
    const incident: IncidentDto = {
      id: this.id('inc'),
      templateCode: t.code,
      category: t.category,
      families: t.families,
      title: text(`incidents.${t.code}.title`),
      report: text(`incidents.${t.code}.report`, { address: spot.address }),
      address: spot.address,
      position: spot.position,
      status: 'PENDING_RESPONSE',
      severity,
      escalating: false,
      createdAt: iso(now),
      expiresAt: tutorial ? null : iso(now + this.dur(600)),
      nextEscalationAt: tutorial ? null : iso(now + this.dur(240)),
      work: {
        total: Math.round(t.workSeconds * scale),
        remaining: Math.round(t.workSeconds * scale),
        ratePerSecond: 0,
        anchorAt: iso(now),
        estimatedEndAt: null,
      },
      coverageRatio: 0,
      requirements: t.requirements.map((r) => ({
        capability: r.capability,
        level: r.level,
        required: Math.round(r.base * scale),
        onScene: 0,
        enRoute: 0,
      })),
      assignedVehicleIds: [],
      patientCount: t.families.includes('EMS') ? 1 : 0,
      estimatedReward: { min: String(Math.round(reward * 0.5)), max: String(Math.round(reward * 1.2)) },
      isTutorial: tutorial,
    };
    career.incidents.push(incident);
    this.log(career, incident.id, 'incident.created', text('timeline.incident_created'), now);
    if (!tutorial) {
      this.schedule(career, 'INCIDENT_EXPIRE', 600, incident.id);
      this.schedule(career, 'INCIDENT_ESCALATE', 240, incident.id);
    }
    this.emit(career, 'incident.created', { incident });
    return incident;
  }

  /** Recompute requirement coverage + the anchored work model after any arrival/departure. */
  private recompute(career: MockCareer, incidentId: string, at: number): IncidentDto | null {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) return null;
    const assigned = career.vehicles.filter((v) => v.incidentId === incidentId);
    const sum = (list: VehicleDto[], cap: string) =>
      list.reduce((s, v) => s + (v.capabilities.find((c) => c.code === cap)?.value ?? 0), 0);
    const onScene = assigned.filter((v) => v.status === 'ON_SCENE');
    const enRoute = assigned.filter((v) => v.status === 'PREPARING' || v.status === 'EN_ROUTE');
    const requirements = incident.requirements.map((r) => ({
      ...r,
      onScene: sum(onScene, r.capability),
      enRoute: sum(enRoute, r.capability),
    }));
    const required = requirements.filter((r) => r.level === 'REQUIRED');
    const coverageRatio = required.length
      ? Math.min(...required.map((r) => Math.min(1, r.onScene / Math.max(1, r.required))))
      : onScene.length
        ? 1
        : 0;
    const recommended = requirements.filter((r) => r.level === 'RECOMMENDED');
    const bonus = recommended.length
      ? recommended.reduce((s, r) => s + Math.min(1, r.onScene / Math.max(1, r.required)), 0) /
        recommended.length
      : 0;
    // settle the work done since the previous anchor
    const elapsed = Math.max(0, (at - Date.parse(incident.work.anchorAt)) / 1000) * this.speed;
    const remaining = Math.max(0, incident.work.remaining - incident.work.ratePerSecond * elapsed);
    const rate = onScene.length ? Math.max(0.15, coverageRatio) * (1 + 0.3 * bonus) : 0;
    const endAt = rate > 0 ? at + this.dur(remaining / rate) : null;
    this.cancelActions(career, (a) => a.type === 'INCIDENT_WORK_DONE' && a.ref === incidentId);
    if (endAt !== null)
      career.actions.push({ id: this.id('act'), type: 'INCIDENT_WORK_DONE', dueAt: endAt, ref: incidentId });
    const status = onScene.length ? 'ON_SCENE' : enRoute.length ? 'RESPONDING' : 'PENDING_RESPONSE';
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

  private route(from: LngLat, to: LngLat, seedText: string): { path: LngLat[]; distanceMeters: number } {
    let seed = 7;
    for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const path = mockRoute(from, to, seed);
    return { path, distanceMeters: pathLengthMeters(path) };
  }
  /** Travel seconds in game time: 42 km/h urban average × time compression 0.25 (D-63). */
  private travelSeconds(distanceMeters: number, typeCode: string): number {
    const type = VEHICLE_TYPES.find((t) => t.code === typeCode);
    return Math.max(8, Math.round((distanceMeters / (11.7 * (type?.speedFactor ?? 1))) * 0.25));
  }

  dispatchOptions(career: MockCareer, incidentId: string) {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
    const needed = incident.requirements.filter((r) => r.level !== 'OPTIONAL');
    const options = career.vehicles
      .filter((v) => v.incidentId !== incidentId)
      .map((v) => {
        const { distanceMeters } = this.route(v.position, incident.position, v.id + incident.id);
        const dispatchable = v.status === 'AVAILABLE';
        const contributes = v.capabilities.filter((c) =>
          incident.requirements.some((r) => r.capability === c.code),
        );
        const warnings: string[] = [];
        if (v.crew.assigned < v.crew.optimal) warnings.push('CREW_BELOW_OPTIMAL');
        if (v.health < 50) warnings.push('HEALTH_LOW');
        if (contributes.length === 0) warnings.push('NO_RELEVANT_CAPABILITY');
        return {
          vehicleId: v.id,
          etaSeconds: Math.round((12 + this.travelSeconds(distanceMeters, v.typeCode)) / this.speed),
          distanceMeters: Math.round(distanceMeters),
          dispatchable,
          blockedReason: dispatchable ? null : 'VEHICLE_NOT_AVAILABLE',
          warnings,
          contributes,
          recommended: false,
        };
      })
      .sort((a, b) => Number(b.dispatchable) - Number(a.dispatchable) || a.etaSeconds - b.etaSeconds);
    // greedy recommendation: fastest vehicles that still add missing REQUIRED/RECOMMENDED capability
    const missing = new Map(
      needed.map((r) => [r.capability, Math.max(0, r.required - r.onScene - r.enRoute)]),
    );
    const recommendedVehicleIds: string[] = [];
    for (const o of options.filter((x) => x.dispatchable)) {
      const useful = o.contributes.some((c) => (missing.get(c.code) ?? 0) > 0);
      if (!useful) continue;
      recommendedVehicleIds.push(o.vehicleId);
      o.recommended = true;
      for (const c of o.contributes) missing.set(c.code, Math.max(0, (missing.get(c.code) ?? 0) - c.value));
    }
    const recommendationCoversRequired = incident.requirements
      .filter((r) => r.level === 'REQUIRED')
      .every((r) => (missing.get(r.capability) ?? 0) === 0);
    return { options, recommendedVehicleIds, recommendationCoversRequired };
  }

  dispatch(career: MockCareer, incidentId: string, vehicleIds: string[]) {
    const incident = career.incidents.find((i) => i.id === incidentId);
    if (!incident) throw new MockError(404, 'NOT_FOUND', 'Incident not found');
    if (!['PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE'].includes(incident.status))
      throw new MockError(409, 'INCIDENT_NOT_DISPATCHABLE', 'Incident cannot receive vehicles');
    const vehicles = vehicleIds.map((id) => career.vehicles.find((v) => v.id === id));
    if (vehicles.some((v) => !v || v.status !== 'AVAILABLE'))
      throw new MockError(409, 'VEHICLE_NOT_AVAILABLE', 'One or more vehicles are not available', {
        vehicleIds: vehicleIds.filter((id, i) => vehicles[i]?.status !== 'AVAILABLE'),
      });
    const now = this.now();
    const updated: VehicleDto[] = [];
    for (const v of vehicles as VehicleDto[]) {
      const prep = 12;
      const patched = this.patchVehicle(career, v.id, {
        status: 'PREPARING',
        incidentId,
        busyUntil: iso(now + this.dur(prep)),
      })!;
      updated.push(patched);
      this.schedule(career, 'VEHICLE_DEPART', prep, v.id);
      this.log(
        career,
        incidentId,
        'dispatch.created',
        text('timeline.vehicle_dispatched', { callSign: v.callSign }),
        now,
        v.id,
      );
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
    this.save();
    return { dispatchId: this.id('dsp'), incident: next, vehicles: updated };
  }

  private onDepart(career: MockCareer, vehicleId: string, at: number): void {
    const v = career.vehicles.find((x) => x.id === vehicleId);
    const incident = v?.incidentId ? career.incidents.find((i) => i.id === v.incidentId) : undefined;
    if (!v || v.status !== 'PREPARING' || !incident) return;
    const { path, distanceMeters } = this.route(v.position, incident.position, v.id + incident.id);
    const seconds = this.travelSeconds(distanceMeters, v.typeCode);
    const arriveAt = at + this.dur(seconds);
    const patched = this.patchVehicle(career, v.id, {
      status: 'EN_ROUTE',
      busyUntil: iso(arriveAt),
      movement: { path, departAt: iso(at), arriveAt: iso(arriveAt), distanceMeters, purpose: 'TO_INCIDENT' },
    })!;
    career.legs.push({
      vehicleId: v.id,
      incidentId: incident.id,
      path,
      distanceMeters,
      dispatchedAt: at,
      arrivedAt: null,
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
      position: incident.position,
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
    const next = this.recompute(career, incident.id, at)!;
    this.emit(career, 'vehicle.arrived', { vehicle: patched, incident: next });
  }

  private sendHome(career: MockCareer, v: VehicleDto, at: number, from?: LngLat): VehicleDto {
    const facility = career.facilities.find((f) => f.id === v.facilityId)!;
    const start = from ?? v.position;
    const { path, distanceMeters } = this.route(start, facility.position, v.id + 'home' + String(at));
    const arriveAt = at + this.dur(this.travelSeconds(distanceMeters, v.typeCode));
    this.cancelActions(
      career,
      (a) =>
        a.ref === v.id &&
        (a.type === 'VEHICLE_ARRIVE' || a.type === 'VEHICLE_DEPART' || a.type === 'VEHICLE_RETURNED'),
    );
    career.actions.push({ id: this.id('act'), type: 'VEHICLE_RETURNED', dueAt: arriveAt, ref: v.id });
    return this.patchVehicle(career, v.id, {
      status: 'RETURNING',
      incidentId: null,
      position: start,
      busyUntil: iso(arriveAt),
      movement: { path, departAt: iso(at), arriveAt: iso(arriveAt), distanceMeters, purpose: 'TO_BASE' },
    })!;
  }

  private onReturned(career: MockCareer, vehicleId: string): void {
    const v = career.vehicles.find((x) => x.id === vehicleId);
    if (!v || v.status !== 'RETURNING') return;
    const facility = career.facilities.find((f) => f.id === v.facilityId)!;
    const health = Math.max(40, v.health - 1);
    const patched = this.patchVehicle(career, v.id, {
      status: 'AVAILABLE',
      position: facility.position,
      movement: null,
      busyUntil: null,
      health,
      healthBand: health > 85 ? 'EXCELLENT' : health > 65 ? 'GOOD' : 'WORN',
    })!;
    this.emit(career, 'vehicle.returned', { vehicle: patched });
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
      const from = v.movement
        ? pointAlong(
            v.movement.path,
            (now - Date.parse(v.movement.departAt)) /
              Math.max(1, Date.parse(v.movement.arriveAt) - Date.parse(v.movement.departAt)),
          ).position
        : v.position;
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
    this.close(career, incident, 'RESOLVED', at);
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

  private close(
    career: MockCareer,
    incident: IncidentDto,
    status: 'RESOLVED' | 'FAILED' | 'EXPIRED',
    at: number,
  ): void {
    const t = INCIDENT_TEMPLATES.find((x) => x.code === incident.templateCode)!;
    const created = Date.parse(incident.createdAt);
    const firstArrival = career.firstArrival[incident.id] ?? at;
    const responseSeconds = Math.round(((firstArrival - created) / 1000) * this.speed);
    const durationSeconds = Math.round(((at - created) / 1000) * this.speed);
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
    const vehicles: VehicleDto[] = [];
    for (const v of career.vehicles.filter((x) => x.incidentId === incident.id))
      vehicles.push(this.sendHome(career, v, at, v.status === 'ON_SCENE' ? incident.position : undefined));

    let outcome: IncidentOutcomeDto | null = null;
    if (status === 'RESOLVED') {
      const gross = Math.round(t.baseReward * (0.7 + 0.1 * incident.severity));
      const timeliness = Math.max(0, Math.min(1, 1.15 - responseSeconds / 240));
      const adequacy = incident.coverageRatio;
      const quality = Math.max(0.5, Math.min(1.2, 0.35 + 0.5 * timeliness + 0.35 * adequacy));
      const legs = career.legs.filter((l) => l.incidentId === incident.id);
      const travel = Math.round(legs.reduce((s, l) => s + (l.distanceMeters / 1000) * 2 * 1.5, 0));
      const scene = Math.round(
        legs.reduce((s, l) => s + (l.arrivedAt ? ((at - l.arrivedAt) / 60_000) * this.speed * 2 : 0), 0),
      );
      const net = Math.max(Math.round(gross * 0.3), Math.round(gross * quality) - travel - scene);
      const xp =
        Math.round(t.baseXp * (0.7 + 0.1 * incident.severity) * quality) + (incident.isTutorial ? 40 : 0);
      const stars = quality >= 1 ? 3 : quality >= 0.8 ? 2 : 1;
      const notes: I18nText[] = [];
      if (timeliness >= 0.8) notes.push(text('outcome.note.FAST_RESPONSE'));
      if (adequacy < 1) notes.push(text('outcome.note.UNDER_RESOURCED'));
      if (incident.isTutorial) notes.push(text('outcome.note.TUTORIAL_BONUS'));
      outcome = {
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
        reputationDelta: stars - 1,
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
      if (incident.isTutorial) this.credit(career, 300, 'MILESTONE', true, text('ledger.MILESTONE'));
      career.summary = {
        ...career.summary,
        reputation: Math.max(0, Math.min(100, career.summary.reputation + (stars - 1))),
      };
      this.log(career, incident.id, 'incident.resolved', text('timeline.incident_resolved'), at);
      this.emit(career, 'incident.resolved', { incident: closed, outcome, vehicles, career: career.summary });
      this.awardXp(career, xp);
      if (incident.isTutorial && !career.summary.tutorial.completed) this.advanceTutorial(career, 'OUTCOME');
    } else {
      career.stats.failed += 1;
      career.away.failed += 1;
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
      this.notify(
        career,
        'INCIDENT_EXPIRED',
        text('notifications.incidentExpired', { address: incident.address }),
        incident.id,
      );
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

  snapshot(career: MockCareer): SyncSnapshot {
    const now = this.now();
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: PESCARA.timezone }).format(
        now,
      ),
    );
    return {
      seq: career.seq,
      career: career.summary,
      facilities: career.facilities,
      vehicles: career.vehicles,
      incidents: career.incidents,
      world: {
        localTime: iso(now),
        timezone: PESCARA.timezone,
        dayPhase: hour >= 7 && hour < 19 ? 'DAY' : hour >= 21 || hour < 5 ? 'NIGHT' : 'TWILIGHT',
        weather: { code: 'CLEAR', temperatureC: 21, windKmh: 9, degraded: false },
        trafficLevel: hour >= 8 && hour <= 9 ? 'MODERATE' : 'LIGHT',
        closures: [],
      },
      pendingOutcomes: career.pendingOutcomes,
      unreadNotifications: career.notifications.filter((n) => !n.readAt).length,
      featureFlags: this.state.featureFlags,
      configVersion: 'mock-1',
    };
  }

  /** Heartbeat: a /sync call marks the player as present and restarts generation after an absence. */
  touch(career: MockCareer): void {
    const now = this.now();
    if (now - career.lastSeenAt > 180_000) career.awayFrom ??= career.lastSeenAt;
    else if (career.awayFrom === null)
      career.away = { since: now, resolved: 0, failed: 0, credits: 0, xp: 0, stipend: 0 };
    career.lastSeenAt = now;
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
