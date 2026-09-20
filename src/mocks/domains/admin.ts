import type { IncidentDto, SyncSnapshot } from '@/contracts';
import type {
  AdminAuditRow,
  AdminCatalogDto,
  AdminCatalogEntry,
  AdminClosureRow,
  AdminConfigVersionRow,
  AdminGeodataRelease,
  AdminIncidentRow,
  AdminPersonnelRow,
  AdminPurchaseRow,
  AdminReferralRow,
  AdminScheduledActionDetail,
  AdminSupportNote,
  AdminWeatherOverride,
} from '@/lib/api/admin';
import type { LngLat } from '@/lib/geo';
import {
  CATALOG_I18N_HASH,
  CATALOG_VERSION,
  COURSES,
  FACILITY_TYPES,
  FAMILIES,
  INCIDENT_TEMPLATES,
  ITEM_TYPES,
  ROLES,
  VEHICLE_TYPES,
} from '../data/catalog';
import { MockError, iso, text, type Action, type MockCareer, type MockEngine } from '../engine';

/**
 * Simulation of the admin area (Spec 18). Pure functions over `engine.state`:
 *  - `engine.state.ext.admin`      audit log, config versions, support notes, review lists, parked failed actions;
 *  - `engine.state.ext.adminWorld` closures + weather override, exposed to the game through the `world` hook;
 *  - `engine.state.featureFlags`   the live flags (pushed to every career with `config.updated`).
 * Every mutation appends an audit row WITH its reason (no silent fix, Spec 18 §12). Role checks live in the handlers.
 */

export interface ConfigVersion extends AdminConfigVersionRow {
  content: Record<string, unknown>;
}
interface FailedAction {
  id: string;
  careerId: string;
  action: Action;
  attempts: number;
  lastError: string;
}
interface ClosedIncident {
  careerId: string;
  incident: IncidentDto;
  closedAt: string;
}
export interface AdminState {
  audit: AdminAuditRow[];
  config: ConfigVersion[];
  notes: Record<string, AdminSupportNote[]>;
  suspensions: Record<string, { reason: string; at: string; by: string }>;
  geodata: AdminGeodataRelease[];
  referrals: AdminReferralRow[];
  purchases: AdminPurchaseRow[];
  failedActions: FailedAction[];
  closedIncidents: ClosedIncident[];
  flagUpdates: Record<string, string>;
  idempotency: Record<string, unknown>;
}
export interface AdminWorldState {
  closures: AdminClosureRow[];
  weatherOverride: AdminWeatherOverride | null;
}

export const INITIAL_CONFIG_VERSION = 'mock-1';
/** Balancing knobs of the mock config. The real backend serves its own schema: the editor is schema-driven. */
export const DEFAULT_CONFIG: Record<string, unknown> = {
  economy: { startingCredits: 5000, rewardMultiplier: 1, stipendBase: 120 },
  spawn: { baseIntervalSeconds: 90, maxActiveIncidents: 6 },
  progression: { xpMultiplier: 1 },
  world: { weatherEnabled: true, trafficEnabled: true },
};
const positive = { type: 'number', exclusiveMinimum: 0, maximum: 10 };
export const CONFIG_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'GameConfig',
  type: 'object',
  additionalProperties: false,
  required: ['economy', 'spawn', 'progression', 'world'],
  properties: {
    economy: {
      type: 'object',
      additionalProperties: false,
      required: ['startingCredits', 'rewardMultiplier', 'stipendBase'],
      properties: {
        startingCredits: { type: 'integer', minimum: 0, maximum: 1_000_000 },
        rewardMultiplier: positive,
        stipendBase: { type: 'integer', minimum: 0, maximum: 100_000 },
      },
    },
    spawn: {
      type: 'object',
      additionalProperties: false,
      required: ['baseIntervalSeconds', 'maxActiveIncidents'],
      properties: {
        baseIntervalSeconds: { type: 'integer', minimum: 10, maximum: 3600 },
        maxActiveIncidents: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
    progression: {
      type: 'object',
      additionalProperties: false,
      required: ['xpMultiplier'],
      properties: { xpMultiplier: positive },
    },
    world: {
      type: 'object',
      additionalProperties: false,
      required: ['weatherEnabled', 'trafficEnabled'],
      properties: { weatherEnabled: { type: 'boolean' }, trafficEnabled: { type: 'boolean' } },
    },
  },
};

export const FLAG_DESCRIPTIONS: Record<string, string> = {
  rewardedAds: 'Rewarded video ads (credits for watching)',
  creditShop: 'Credit packages shop (payments)',
  referrals: 'Invite-a-friend programme',
  soundEffects: 'Sound effects available in the client',
  analytics: 'Product analytics events',
};

const MAX_AUDIT = 500;
const MAX_CLOSED = 100;
const EPOCH = Date.parse('2026-09-01T08:00:00.000Z');

function seed(engine: MockEngine): AdminState {
  const at = (days: number) => iso(EPOCH + days * 86_400_000);
  const now = iso(engine.now());
  return {
    audit: [],
    config: [
      {
        id: 'cfg_0001',
        version: INITIAL_CONFIG_VERSION,
        status: 'PUBLISHED',
        createdAt: at(0),
        publishedAt: at(0),
        author: 'system',
        note: 'Initial configuration',
        content: structuredClone(DEFAULT_CONFIG),
      },
    ],
    notes: {},
    suspensions: {},
    geodata: [
      {
        id: 'geo_2026_07',
        version: '2026.07',
        status: 'ROLLED_BACK',
        createdAt: at(-50),
        publishedAt: at(-48),
        note: 'Hospital positions shifted — rolled back',
        counts: { municipalities: 305, sites: 1180, hospitals: 27, populationCells: 9120 },
      },
      {
        id: 'geo_2026_08',
        version: '2026.08',
        status: 'PUBLISHED',
        createdAt: at(-20),
        publishedAt: at(-18),
        note: 'Abruzzo, ISTAT 2026 boundaries',
        counts: { municipalities: 305, sites: 1214, hospitals: 29, populationCells: 9120 },
      },
      {
        id: 'geo_2026_09',
        version: '2026.09',
        status: 'READY',
        createdAt: at(12),
        publishedAt: null,
        note: 'Adds Molise',
        counts: { municipalities: 441, sites: 1702, hospitals: 35, populationCells: 13480 },
      },
      {
        id: 'geo_2026_10',
        version: '2026.10-rc1',
        status: 'BUILDING',
        createdAt: now,
        publishedAt: null,
        note: null,
        counts: { municipalities: 0, sites: 0, hospitals: 0, populationCells: 0 },
      },
    ],
    referrals: [
      referral(
        'ref_0001',
        'Direttore Marsica',
        'Centrale Aterno',
        'UNDER_REVIEW',
        ['SAME_DEVICE', 'SAME_IP'],
        at(10),
      ),
      referral('ref_0002', 'Direttore Marsica', 'Sala Vestina', 'UNDER_REVIEW', ['RAPID_ACTIVATION'], at(11)),
      referral('ref_0003', 'Comando Adriatico', 'Base Majella', 'ACTIVATED', [], at(8)),
      referral('ref_0004', 'Comando Adriatico', 'Nucleo Sangro', 'REWARDED', [], at(3)),
      referral('ref_0005', 'Direttore Marsica', 'Posto Fucino', 'REGISTERED', ['DISPOSABLE_EMAIL'], at(12)),
    ],
    purchases: [
      purchase(
        'pur_0001',
        'giulia.r@example.com',
        'STARTER',
        '1200',
        199,
        'CREDITED',
        'pi_3Qx1aStarter',
        at(4),
      ),
      purchase('pur_0002', 'marco.b@example.com', 'MEDIUM', '6500', 999, 'CREDITED', 'pi_3Qx7cMedium', at(9)),
      purchase('pur_0003', 'marco.b@example.com', 'LARGE', '15000', 1999, 'FAILED', 'pi_3Qx9dLarge', at(9)),
      purchase('pur_0004', 'sara.t@example.com', 'MEDIUM', '6500', 999, 'REFUNDED', 'pi_3QxB2Medium', at(11)),
      purchase('pur_0005', 'luca.d@example.com', 'SMALL', '2800', 499, 'PAID', 'pi_3QxF5Small', at(13)),
    ],
    failedActions: [],
    closedIncidents: [],
    flagUpdates: {},
    idempotency: {},
  };
}
function referral(
  id: string,
  referrerName: string,
  invitedName: string,
  status: AdminReferralRow['status'],
  signals: string[],
  createdAt: string,
): AdminReferralRow {
  return {
    id,
    referrerName,
    referrerCareerId: null,
    invitedName,
    invitedUserId: null,
    status,
    signals,
    createdAt,
    reviewedAt: null,
    reviewNote: null,
  };
}
function purchase(
  id: string,
  email: string,
  packageId: string,
  credits: string,
  priceMinor: number,
  status: AdminPurchaseRow['status'],
  providerRef: string,
  createdAt: string,
): AdminPurchaseRow {
  return {
    id,
    userId: null,
    email,
    careerId: null,
    packageId,
    credits,
    priceMinor,
    currency: 'EUR',
    status,
    providerRef,
    refunded: status === 'REFUNDED',
    refundReview: null,
    createdAt,
    completedAt: status === 'CREATED' || status === 'FAILED' ? null : createdAt,
  };
}

export function adminState(engine: MockEngine): AdminState {
  return (engine.state.ext.admin ??= seed(engine)) as AdminState;
}
export function adminWorld(engine: MockEngine): AdminWorldState {
  return (engine.state.ext.adminWorld ??= { closures: [], weatherOverride: null }) as AdminWorldState;
}

export function assertReason(reason: unknown): string {
  const value = typeof reason === 'string' ? reason.trim() : '';
  if (value.length < 5 || value.length > 500)
    throw new MockError(422, 'VALIDATION_ERROR', 'A reason of 5–500 characters is required', {
      fields: ['reason'],
    });
  return value;
}

/** Append-only audit trail; newest first. */
export function audit(
  engine: MockEngine,
  actor: string,
  action: string,
  targetType: string,
  targetId: string | null,
  reason: string | null,
): AdminAuditRow {
  const s = adminState(engine);
  const row: AdminAuditRow = {
    id: engine.id('aud'),
    actor,
    action,
    targetType,
    targetId,
    reason,
    createdAt: iso(engine.now()),
  };
  s.audit.unshift(row);
  s.audit = s.audit.slice(0, MAX_AUDIT);
  return row;
}

/* ───────────── world: closures + weather override ───────────── */
function activeWorld(engine: MockEngine): AdminWorldState {
  const w = adminWorld(engine);
  const now = engine.now();
  w.closures = w.closures.filter((c) => Date.parse(c.endsAt) > now);
  if (w.weatherOverride && Date.parse(w.weatherOverride.endsAt) <= now) w.weatherOverride = null;
  return w;
}
export function pointInPolygon(point: LngLat, polygon: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
/** Pushes the current world context to every career so that open game clients update without a reload. */
export function broadcastWorld(engine: MockEngine): void {
  for (const career of Object.values(engine.state.careers))
    engine.emit(career, 'world.updated', { world: engine.snapshot(career).world });
}
export function createClosure(
  engine: MockEngine,
  actor: string,
  body: { polygon: LngLat[]; reasonKey: string; durationSeconds: number; multiplier: number },
): AdminClosureRow {
  const now = engine.now();
  const row: AdminClosureRow = {
    id: engine.id('clo'),
    polygon: body.polygon,
    reasonKey: body.reasonKey,
    multiplier: body.multiplier,
    createdAt: iso(now),
    // Wall-clock duration on purpose: a QA closure must not vanish 12× faster under time compression.
    endsAt: iso(now + body.durationSeconds * 1000),
    createdBy: actor,
  };
  activeWorld(engine).closures.push(row);
  broadcastWorld(engine);
  return row;
}

/* ───────────── config versions ───────────── */
export const publishedConfig = (engine: MockEngine): ConfigVersion =>
  adminState(engine).config.find((v) => v.status === 'PUBLISHED')!;

export function createDraft(
  engine: MockEngine,
  actor: string,
  fromId?: string,
  note?: string,
): ConfigVersion {
  const s = adminState(engine);
  const source = fromId ? s.config.find((v) => v.id === fromId) : publishedConfig(engine);
  if (!source) throw new MockError(404, 'NOT_FOUND', 'Config version not found');
  const next = s.config.length + 1;
  const draft: ConfigVersion = {
    id: `cfg_${String(next).padStart(4, '0')}`,
    version: `mock-${next}`,
    status: 'DRAFT',
    createdAt: iso(engine.now()),
    publishedAt: null,
    author: actor,
    note: note?.trim() || null,
    content: structuredClone(source.content),
  };
  s.config.unshift(draft);
  return draft;
}
/** Makes `target` the live version: the previous one becomes SUPERSEDED and every client is told to refresh. */
export function activateConfig(engine: MockEngine, target: ConfigVersion): void {
  for (const v of adminState(engine).config) if (v.status === 'PUBLISHED') v.status = 'SUPERSEDED';
  target.status = 'PUBLISHED';
  target.publishedAt = iso(engine.now());
  for (const career of Object.values(engine.state.careers))
    engine.emit(career, 'config.updated', { configVersion: target.version });
}

/* ───────────── feature flags ───────────── */
export function setFlag(engine: MockEngine, key: string, enabled: boolean): void {
  engine.state.featureFlags[key] = enabled;
  adminState(engine).flagUpdates[key] = iso(engine.now());
  for (const career of Object.values(engine.state.careers))
    engine.emit(career, 'config.updated', { featureFlags: engine.state.featureFlags });
}

/* ───────────── rows ───────────── */
export const careerOfIncident = (engine: MockEngine, incidentId: string): MockCareer | undefined =>
  Object.values(engine.state.careers).find((c) => c.incidents.some((i) => i.id === incidentId));

export function incidentRow(career: MockCareer, i: IncidentDto, closedAt: string | null): AdminIncidentRow {
  return {
    id: i.id,
    careerId: career.summary.id,
    directorName: career.summary.directorName,
    templateCode: i.templateCode,
    category: i.category,
    status: i.status,
    severity: i.severity,
    address: i.address,
    createdAt: i.createdAt,
    closedAt,
  };
}
export function allIncidentRows(engine: MockEngine): AdminIncidentRow[] {
  const active = Object.values(engine.state.careers).flatMap((c) =>
    c.incidents.map((i) => incidentRow(c, i, null)),
  );
  const closed = adminState(engine).closedIncidents.flatMap((x) => {
    const career = engine.state.careers[x.careerId];
    return career ? [incidentRow(career, x.incident, x.closedAt)] : [];
  });
  return [...active, ...closed].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const AGGREGATE: [RegExp, string][] = [
  [/^inc_/, 'incident'],
  [/^veh_/, 'vehicle'],
  [/^fac_/, 'facility'],
  [/^per_|^prs_/, 'personnel'],
  [/^ung_/, 'external_unit'],
];
export function actionRow(
  engine: MockEngine,
  careerId: string,
  a: Action,
  failed?: FailedAction,
): AdminScheduledActionDetail {
  const ref = a.ref.split('|')[0] ?? a.ref;
  const aggregateType = AGGREGATE.find(([re]) => re.test(ref))?.[1] ?? (a.ref ? 'career' : null);
  return {
    id: a.id,
    type: a.type,
    status: failed ? 'FAILED' : a.dueAt <= engine.now() ? 'QUEUED' : 'PENDING',
    dueAt: iso(a.dueAt),
    attempts: failed?.attempts ?? 0,
    aggregateType,
    aggregateId: a.ref || null,
    lastError: failed?.lastError ?? null,
    careerId,
    payload: { ref: a.ref, careerId },
  };
}
export function allActionRows(engine: MockEngine): AdminScheduledActionDetail[] {
  const pending = Object.values(engine.state.careers).flatMap((c) =>
    c.actions.map((a) => actionRow(engine, c.summary.id, a)),
  );
  const failed = adminState(engine).failedActions.map((f) => actionRow(engine, f.careerId, f.action, f));
  return [...failed, ...pending].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
/** Parks a pending action as FAILED (what a crashed worker leaves behind). Used by QA and unit tests. */
export function failAction(engine: MockEngine, careerId: string, actionId: string, error: string): void {
  const career = engine.state.careers[careerId];
  const action = career?.actions.find((a) => a.id === actionId);
  if (!career || !action) throw new MockError(404, 'NOT_FOUND', 'Scheduled action not found');
  career.actions = career.actions.filter((a) => a.id !== actionId);
  adminState(engine).failedActions.push({ id: action.id, careerId, action, attempts: 3, lastError: error });
}
/** Retry = put the action back in the owner's schedule, due now; the normal executor runs on the next `process()`. */
export function retryAction(engine: MockEngine, actionId: string): AdminScheduledActionDetail {
  const s = adminState(engine);
  const failed = s.failedActions.find((f) => f.id === actionId);
  if (failed) {
    const career = engine.state.careers[failed.careerId];
    if (!career) throw new MockError(404, 'NOT_FOUND', 'Owner career not found');
    s.failedActions = s.failedActions.filter((f) => f.id !== actionId);
    const action = { ...failed.action, dueAt: engine.now() };
    career.actions.push(action);
    const row = actionRow(engine, failed.careerId, action);
    engine.process();
    return { ...row, status: 'COMPLETED', attempts: failed.attempts + 1 };
  }
  for (const career of Object.values(engine.state.careers)) {
    const action = career.actions.find((a) => a.id === actionId);
    if (!action) continue;
    if (action.dueAt > engine.now())
      throw new MockError(409, 'CONFLICT', 'Only failed or overdue actions can be retried');
    const row = actionRow(engine, career.summary.id, action);
    engine.process();
    return { ...row, status: 'COMPLETED', attempts: 1 };
  }
  throw new MockError(404, 'NOT_FOUND', 'Scheduled action not found');
}

/** Other areas own `career.ext.*`: read defensively, the shape may differ or be missing. */
export function personnelRows(career: MockCareer): AdminPersonnelRow[] {
  const ext = career.ext.personnel;
  if (!ext || typeof ext !== 'object') return [];
  const candidates = Array.isArray(ext) ? [ext] : Object.values(ext as Record<string, unknown>);
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  for (const candidate of candidates) {
    const items: unknown[] = Array.isArray(candidate)
      ? candidate
      : candidate && typeof candidate === 'object'
        ? Object.values(candidate as Record<string, unknown>)
        : [];
    const rows = items.flatMap((raw): AdminPersonnelRow[] => {
      if (!raw || typeof raw !== 'object') return [];
      const p = raw as Record<string, unknown>;
      const id = str(p.id);
      const roleCode = str(p.roleCode) ?? str(p.role);
      if (!id || (!roleCode && !str(p.status))) return [];
      const name = str(p.name) ?? [str(p.firstName), str(p.lastName)].filter(Boolean).join(' ');
      return [
        {
          id,
          name: name || id,
          roleCode,
          status: str(p.status) ?? 'UNKNOWN',
          facilityId: str(p.facilityId),
        },
      ];
    });
    if (rows.length > 0) return rows;
  }
  return [];
}

export function catalogView(): AdminCatalogDto {
  const entry = (
    kind: string,
    code: string,
    family: string | null,
    requiredLevel: number | null,
    price: number | null,
    attributes: AdminCatalogEntry['attributes'],
  ): AdminCatalogEntry => ({
    code,
    kind,
    family,
    requiredLevel,
    price: price === null ? null : String(price),
    attributes,
  });
  const record = (v: unknown) => (v ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    version: CATALOG_VERSION,
    contentHash: CATALOG_I18N_HASH,
    i18nHash: CATALOG_I18N_HASH,
    sections: {
      families: FAMILIES.map((f) =>
        entry('family', f.code, f.code, f.requiredLevel, null, { playerManaged: f.playerManaged }),
      ),
      vehicles: VEHICLE_TYPES.map((v) =>
        entry('vehicle', v.code, v.family, v.requiredLevel, v.price, {
          domain: v.domain,
          crewMin: v.crewMin,
          crewOptimal: v.crewOptimal,
          capacityPoints: v.capacityPoints,
          patientCapacity: v.patientCapacity,
        }),
      ),
      facilities: FACILITY_TYPES.map((f) =>
        entry('facility', f.code, f.family, f.requiredLevel, f.price, {
          chain: f.chain,
          tier: f.tier,
          domains: f.domains.join(', '),
        }),
      ),
      templates: INCIDENT_TEMPLATES.map((t) =>
        entry('incident', t.code, t.primaryFamily, t.minLevel, null, {
          category: t.category,
          severityMin: t.severity[0],
          severityMax: t.severity[1],
          rarity: t.rarity,
          baseReward: t.baseReward,
          baseXp: t.baseXp,
        }),
      ),
      roles: ROLES.map((r) => {
        const x = record(r);
        return entry('role', String(x.code), strOrNull(x.family), num(x.requiredLevel), num(x.hireCost), {
          specialist: x.specialist === true,
          costPerPeriod: num(x.costPerPeriod),
          onboardingSeconds: num(x.onboardingSeconds),
        });
      }),
      courses: COURSES.map((c) => {
        const x = record(c);
        return entry('course', String(x.code), null, num(x.requiredLevel), num(x.cost), {
          grants: strOrNull(x.grants),
          tier: strOrNull(x.tier),
          durationSeconds: num(x.durationSeconds),
        });
      }),
      items: ITEM_TYPES.map((i) => {
        const x = record(i);
        return entry('item', String(x.code), strOrNull(x.family), num(x.requiredLevel), num(x.unitPrice), {
          packSize: num(x.packSize),
          deliverySeconds: num(x.deliverySeconds),
        });
      }),
    },
  };
}

export function installAdmin(engine: MockEngine): void {
  // Closed incidents leave the career: the inspector keeps the most recent ones so QA can see the final state.
  engine.hooks.incidentClosed.push((career, incident) => {
    const s = adminState(engine);
    s.closedIncidents.unshift({ careerId: career.summary.id, incident, closedAt: iso(engine.now()) });
    s.closedIncidents = s.closedIncidents.slice(0, MAX_CLOSED);
  });

  // World overrides reach the game by convention only: this hook runs after the world area's one.
  engine.hooks.world.push((_career, base): SyncSnapshot['world'] => {
    const w = activeWorld(engine);
    return {
      ...base,
      weather: w.weatherOverride ? { ...base.weather, code: w.weatherOverride.code } : base.weather,
      closures: [
        ...base.closures,
        ...w.closures.map((c) => ({
          id: c.id,
          polygon: c.polygon,
          reason: text(c.reasonKey),
          endsAt: c.endsAt,
          kind: 'PARTIAL' as const,
          multiplier: c.multiplier,
          incidentId: null,
        })),
      ],
    };
  });
  engine.hooks.travelFactor.push((_career, path) => {
    let factor = 1;
    for (const c of activeWorld(engine).closures)
      if (path.some((p) => pointInPolygon(p, c.polygon))) factor = Math.max(factor, c.multiplier);
    return factor;
  });

  // The core snapshot carries a constant config version: report the published one instead (no core edit needed).
  const coreSnapshot = engine.snapshot.bind(engine);
  engine.snapshot = (career) => ({ ...coreSnapshot(career), configVersion: publishedConfig(engine).version });
}

/** QA helpers are installed after every domain (src/mocks/qa.ts replaces `engine.qa`), so this is called lazily. */
export function installAdminQa(engine: MockEngine): void {
  if ('adminFailAction' in engine.qa) return;
  const qa = engine.qa as Record<string, (...args: never[]) => unknown>;
  /** Parks the next pending action of the signed-in career as FAILED; returns its id. */
  qa.adminFailAction = (error: string = 'Worker crashed: connection reset') => {
    const career = engine.qa.career();
    const action = [...career.actions].sort((a, b) => a.dueAt - b.dueAt)[0];
    if (!action) throw new MockError(404, 'NOT_FOUND', 'No pending action');
    failAction(engine, career.summary.id, action.id, error);
    engine.save();
    return action.id;
  };
  qa.adminState = () => adminState(engine);
}
