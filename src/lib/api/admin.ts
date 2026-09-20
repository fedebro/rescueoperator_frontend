/**
 * Admin API (Spec 18, roles reduced to SUPPORT / GAME_ADMIN / SUPER_ADMIN by D-53).
 *
 * contracts/business.ts defines the row shapes and three bodies; ROUTES.md only lists the admin RESOURCES.
 * Everything marked `ASSUMED` below (paths, queries, bodies, detail shapes, the permission matrix) is this
 * client's proposal: the mock backend (src/mocks/handlers/admin.ts) implements exactly these and the real
 * backend must honour them. Conventions shared by every assumed route:
 *  - prefix `/api/v1/admin`, standard `{ data, meta }` envelope, errors with the usual `ErrorCode`s
 *    (403 FORBIDDEN when the role is insufficient, 404 NOT_FOUND, 409 CONFLICT for an illegal state change,
 *    422 VALIDATION_ERROR with `details`);
 *  - every mutation carries a human `reason` (≥ 5 chars): in the JSON body, or as `?reason=` on DELETE;
 *    it is written to the audit log together with the actor;
 *  - lists accept `limit` (≤ 200) and, where noted, `cursor` → `meta.nextCursor` / `meta.hasMore`.
 */
import { z } from 'zod';
import {
  AdminAuditRow,
  AdminCareerRow,
  AdminClosureBody,
  AdminConfigVersionRow,
  type AdminCreditAdjustmentBody as AdminCreditAdjustmentBodySchema,
  AdminDashboardDto,
  AdminFeatureFlagRow,
  AdminQueueStats,
  AdminScheduledActionRow,
  AdminSpawnIncidentBody,
  AdminUserRow,
  Amount,
  CareerSummary,
  FacilityDto,
  IncidentDto,
  IsoDateTime,
  LedgerEntryDto,
  LngLat,
  NotificationDto,
  type PlatformRole,
  TimelineEntryDto,
  VehicleDto,
  WeatherCode,
} from '@/contracts';
import { api } from './client';
import { env } from '@/lib/env';

export type AdminUserRow = z.infer<typeof AdminUserRow>;
export type AdminCareerRow = z.infer<typeof AdminCareerRow>;
export type AdminScheduledActionRow = z.infer<typeof AdminScheduledActionRow>;
export type AdminQueueStats = z.infer<typeof AdminQueueStats>;
export type AdminDashboardDto = z.infer<typeof AdminDashboardDto>;
export type AdminCreditAdjustmentBody = z.infer<typeof AdminCreditAdjustmentBodySchema>;
export type AdminConfigVersionRow = z.infer<typeof AdminConfigVersionRow>;
export type AdminFeatureFlagRow = z.infer<typeof AdminFeatureFlagRow>;
export type AdminAuditRow = z.infer<typeof AdminAuditRow>;
export type AdminSpawnIncidentBody = z.infer<typeof AdminSpawnIncidentBody>;
export type AdminClosureBody = z.infer<typeof AdminClosureBody>;
export type AdminRole = Exclude<z.infer<typeof PlatformRole>, 'USER'>;

/* ───────────── ASSUMED: permission matrix (minimum platform role per action) ───────────── */
const RANK: Record<AdminRole, number> = { SUPPORT: 1, GAME_ADMIN: 2, SUPER_ADMIN: 3 };
/** Reading any admin resource needs any platform role. Mutations need at least the role listed here. */
export const ADMIN_PERMISSIONS = {
  'users.revokeSessions': 'SUPPORT',
  'users.suspend': 'SUPPORT',
  'users.notes': 'SUPPORT',
  'users.roles': 'SUPER_ADMIN',
  'purchases.refundReview': 'SUPPORT',
  'careers.creditAdjustment': 'GAME_ADMIN',
  'careers.creditAdjustmentLarge': 'SUPER_ADMIN',
  'careers.spawnIncident': 'GAME_ADMIN',
  'careers.setDuty': 'GAME_ADMIN',
  'incidents.forceResolve': 'GAME_ADMIN',
  'incidents.cancel': 'GAME_ADMIN',
  'scheduledActions.retry': 'GAME_ADMIN',
  'config.draft': 'GAME_ADMIN',
  'config.publish': 'SUPER_ADMIN',
  'config.rollback': 'SUPER_ADMIN',
  'flags.toggle': 'GAME_ADMIN',
  'world.edit': 'GAME_ADMIN',
  'referrals.review': 'GAME_ADMIN',
  'geodata.publish': 'SUPER_ADMIN',
} as const satisfies Record<string, AdminRole>;
export type AdminAction = keyof typeof ADMIN_PERMISSIONS;
/** ASSUMED: a credit adjustment whose absolute value exceeds this needs SUPER_ADMIN. */
export const CREDIT_ADJUSTMENT_THRESHOLD = 10_000n;

export function adminRank(roles: readonly string[] | undefined | null): number {
  return Math.max(0, ...(roles ?? []).map((r) => RANK[r as AdminRole] ?? 0));
}
export function canAdmin(roles: readonly string[] | undefined | null, action: AdminAction): boolean {
  return adminRank(roles) >= RANK[ADMIN_PERMISSIONS[action]];
}

/* ───────────── ASSUMED shapes ───────────── */
export const ReasonBody = z.object({ reason: z.string().trim().min(5).max(500) });

export const AdminSessionRow = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime,
});
export const AdminSupportNote = z.object({
  id: z.string(),
  author: z.string(),
  text: z.string(),
  createdAt: IsoDateTime,
});
export type AdminSupportNote = z.infer<typeof AdminSupportNote>;
/** ASSUMED — GET /admin/users/:id */
export const AdminUserDetail = z.object({
  user: AdminUserRow,
  locale: z.string(),
  marketingConsent: z.boolean(),
  suspension: z.object({ reason: z.string(), at: IsoDateTime, by: z.string() }).nullable(),
  sessions: z.array(AdminSessionRow),
  notes: z.array(AdminSupportNote),
  /** Latest audit rows whose target is this user. */
  audit: z.array(AdminAuditRow),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

/** ASSUMED — GET /admin/careers/:id */
export const AdminCareerDetail = z.object({
  career: AdminCareerRow,
  userId: z.string(),
  email: z.string(),
  summary: CareerSummary,
  stats: z.object({
    incidentsResolved: z.number().int(),
    incidentsFailed: z.number().int(),
    creditsEarned: Amount,
    creditsSpent: Amount,
  }),
  /** Largest absolute credit adjustment the CALLER may post: "0" = not allowed, null = unlimited. */
  creditAdjustmentLimit: Amount.nullable(),
});
export type AdminCareerDetail = z.infer<typeof AdminCareerDetail>;
/** ASSUMED — GET /admin/careers/:id/personnel */
export const AdminPersonnelRow = z.object({
  id: z.string(),
  name: z.string(),
  roleCode: z.string().nullable(),
  status: z.string(),
  facilityId: z.string().nullable(),
});
export type AdminPersonnelRow = z.infer<typeof AdminPersonnelRow>;
/** ASSUMED — GET /admin/careers/:id/progression */
export const AdminProgressionDto = z.object({
  level: z.number().int(),
  xp: Amount,
  xpForCurrentLevel: Amount,
  xpForNextLevel: Amount,
  reputation: z.number(),
  unlockedFamilies: z.array(z.string()),
  tutorialCompleted: z.boolean(),
  tutorialStep: z.string().nullable(),
  incidentsResolved: z.number().int(),
  incidentsFailed: z.number().int(),
});
export type AdminProgressionDto = z.infer<typeof AdminProgressionDto>;
/** ASSUMED — response of ★POST /admin/careers/:id/credit-adjustment */
export const AdminCreditAdjustmentResult = z.object({ entry: LedgerEntryDto, credits: Amount });
/** ASSUMED — additive optional fields on the contract body of POST /admin/careers/:id/spawn-incident */
export const AdminSpawnIncidentRequest = AdminSpawnIncidentBody.extend({
  position: LngLat.optional(),
  reason: z.string().optional(),
});
export type AdminSpawnIncidentRequest = z.infer<typeof AdminSpawnIncidentRequest>;

/** ASSUMED — rows of GET /admin/incidents (active + recently closed) */
export const AdminIncidentRow = z.object({
  id: z.string(),
  careerId: z.string(),
  directorName: z.string(),
  templateCode: z.string(),
  category: z.string(),
  status: z.string(),
  severity: z.number().int(),
  address: z.string(),
  createdAt: IsoDateTime,
  closedAt: IsoDateTime.nullable(),
});
export type AdminIncidentRow = z.infer<typeof AdminIncidentRow>;
/** ASSUMED — GET /admin/scheduled-actions/:id (contract row + owner and payload) */
export const AdminScheduledActionDetail = AdminScheduledActionRow.extend({
  careerId: z.string().nullable(),
  payload: z.record(z.unknown()),
});
export type AdminScheduledActionDetail = z.infer<typeof AdminScheduledActionDetail>;
/** ASSUMED — GET /admin/incidents/:id */
export const AdminIncidentDetail = z.object({
  row: AdminIncidentRow,
  incident: IncidentDto,
  vehicles: z.array(VehicleDto),
  timeline: z.array(TimelineEntryDto),
  scheduledActions: z.array(AdminScheduledActionRow),
});
export type AdminIncidentDetail = z.infer<typeof AdminIncidentDetail>;

/** ASSUMED — GET /admin/config/versions/:id */
export const AdminConfigVersionDetail = AdminConfigVersionRow.extend({ content: z.record(z.unknown()) });
export type AdminConfigVersionDetail = z.infer<typeof AdminConfigVersionDetail>;

/** ASSUMED — GET /admin/catalog: career-independent, read-only view of the loaded content. */
export const AdminCatalogEntry = z.object({
  code: z.string(),
  /** i18n kind for the catalog bundle (`<kind>.<code>.name`), e.g. vehicle, facility, incident, role, course, item. */
  kind: z.string(),
  family: z.string().nullable(),
  requiredLevel: z.number().int().nullable(),
  price: Amount.nullable(),
  /** Flat, display-only extra attributes. */
  attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AdminCatalogEntry = z.infer<typeof AdminCatalogEntry>;
export const ADMIN_CATALOG_SECTIONS = [
  'families',
  'vehicles',
  'facilities',
  'templates',
  'roles',
  'courses',
  'items',
] as const;
export type AdminCatalogSection = (typeof ADMIN_CATALOG_SECTIONS)[number];
export const AdminCatalogDto = z.object({
  version: z.string(),
  contentHash: z.string(),
  i18nHash: z.string().nullable(),
  sections: z.record(z.array(AdminCatalogEntry)),
});
export type AdminCatalogDto = z.infer<typeof AdminCatalogDto>;

/** ASSUMED — PATCH /admin/feature-flags/:key */
export const AdminFeatureFlagPatch = ReasonBody.extend({ enabled: z.boolean() });

/** ASSUMED — world overrides */
export const AdminClosureRow = z.object({
  id: z.string(),
  polygon: z.array(LngLat),
  reasonKey: z.string(),
  multiplier: z.number(),
  createdAt: IsoDateTime,
  endsAt: IsoDateTime,
  createdBy: z.string(),
});
export type AdminClosureRow = z.infer<typeof AdminClosureRow>;
/** Contract body + the audit reason (additive, optional for the backend). */
export const AdminClosureRequest = AdminClosureBody.extend({ reason: z.string().optional() });
export type AdminClosureRequest = z.infer<typeof AdminClosureRequest>;
export const AdminWeatherOverride = z.object({
  code: WeatherCode,
  startedAt: IsoDateTime,
  endsAt: IsoDateTime,
  createdBy: z.string(),
  reason: z.string(),
});
export type AdminWeatherOverride = z.infer<typeof AdminWeatherOverride>;
export const AdminWeatherOverrideBody = ReasonBody.extend({
  code: WeatherCode,
  durationSeconds: z.number().int().min(60),
});
export type AdminWeatherOverrideBody = z.infer<typeof AdminWeatherOverrideBody>;
/** Reason keys offered by the closure form; the game resolves them as client messages. */
export const CLOSURE_REASON_KEYS = [
  'ROADWORKS',
  'ACCIDENT',
  'EVENT',
  'FLOOD',
  'LANDSLIDE',
  'QA_TEST',
] as const;
export const closureReasonKey = (code: (typeof CLOSURE_REASON_KEYS)[number]) => `admin.world.reasons.${code}`;

/** ASSUMED — geodata releases */
export const AdminGeodataRelease = z.object({
  id: z.string(),
  version: z.string(),
  status: z.enum(['BUILDING', 'READY', 'PUBLISHED', 'ROLLED_BACK']),
  createdAt: IsoDateTime,
  publishedAt: IsoDateTime.nullable(),
  note: z.string().nullable(),
  counts: z.object({
    municipalities: z.number().int(),
    sites: z.number().int(),
    hospitals: z.number().int(),
    populationCells: z.number().int(),
  }),
});
export type AdminGeodataRelease = z.infer<typeof AdminGeodataRelease>;

/** ASSUMED — referral fraud review */
export const AdminReferralRow = z.object({
  id: z.string(),
  referrerName: z.string(),
  referrerCareerId: z.string().nullable(),
  invitedName: z.string(),
  invitedUserId: z.string().nullable(),
  status: z.enum(['REGISTERED', 'ACTIVATED', 'REWARDED', 'INVALIDATED', 'UNDER_REVIEW']),
  /** Opaque anti-fraud labels (SAME_DEVICE, SAME_IP, DISPOSABLE_EMAIL, RAPID_ACTIVATION…): shown as-is. */
  signals: z.array(z.string()),
  createdAt: IsoDateTime,
  reviewedAt: IsoDateTime.nullable(),
  reviewNote: z.string().nullable(),
});
export type AdminReferralRow = z.infer<typeof AdminReferralRow>;

/** ASSUMED — purchases review */
export const AdminPurchaseRow = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  email: z.string(),
  careerId: z.string().nullable(),
  packageId: z.string(),
  credits: Amount,
  priceMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(['CREATED', 'PAID', 'CREDITED', 'FAILED', 'REFUNDED']),
  providerRef: z.string().nullable(),
  refunded: z.boolean(),
  refundReview: z.object({ reason: z.string(), by: z.string(), at: IsoDateTime }).nullable(),
  createdAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
});
export type AdminPurchaseRow = z.infer<typeof AdminPurchaseRow>;

/** GET /version (root, no /api/v1 prefix — exists on the backend). `environment` is an ASSUMED additive field. */
export const VersionDto = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    gitSha: z.string().nullable().optional(),
    configVersion: z.string().nullable().optional(),
    catalogVersion: z.string().nullable().optional(),
    environment: z.string().nullable().optional(),
  })
  .passthrough();
export type VersionDto = z.infer<typeof VersionDto>;

/* ───────────── client ───────────── */
const LIMIT = 200;
const list = <T extends z.ZodTypeAny>(schema: T) => z.array(schema);
type Query = Record<string, string | number | boolean | null | undefined>;
const id = encodeURIComponent;

export const adminApi = {
  /** Root endpoint: fetched without the API client because it lives outside `/api/v1` and is public. */
  version: async (): Promise<VersionDto | null> => {
    try {
      const res = await fetch(`${env.apiUrl.replace(/\/$/, '')}/version`, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: unknown };
      const parsed = VersionDto.safeParse(json.data ?? json);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  dashboard: () => api.get('/admin/dashboard', { schema: AdminDashboardDto }),
  queues: () => api.get('/admin/queues', { schema: list(AdminQueueStats) }),

  users: (query: { q?: string; status?: string }) =>
    api.get('/admin/users', { query: { ...query, limit: LIMIT }, schema: list(AdminUserRow) }),
  user: (userId: string) => api.get(`/admin/users/${id(userId)}`, { schema: AdminUserDetail }),
  suspendUser: (userId: string, reason: string) =>
    api.command(`/admin/users/${id(userId)}/suspend`, { reason }, { schema: AdminUserRow }),
  reactivateUser: (userId: string, reason: string) =>
    api.command(`/admin/users/${id(userId)}/reactivate`, { reason }, { schema: AdminUserRow }),
  revokeSession: (userId: string, sessionId: string, reason: string) =>
    api.delete(`/admin/users/${id(userId)}/sessions/${id(sessionId)}`, { query: { reason } }),
  revokeAllSessions: (userId: string, reason: string) =>
    api.delete(`/admin/users/${id(userId)}/sessions`, { query: { reason } }),
  setUserRoles: (userId: string, roles: AdminRole[], reason: string) =>
    api.put(`/admin/users/${id(userId)}/roles`, { roles, reason }, { schema: AdminUserRow }),
  addUserNote: (userId: string, text: string) =>
    api.post(`/admin/users/${id(userId)}/notes`, { text }, { schema: AdminSupportNote }),

  careers: (query: { q?: string }) =>
    api.get('/admin/careers', { query: { ...query, limit: LIMIT }, schema: list(AdminCareerRow) }),
  career: (careerId: string) => api.get(`/admin/careers/${id(careerId)}`, { schema: AdminCareerDetail }),
  careerFacilities: (careerId: string) =>
    api.get(`/admin/careers/${id(careerId)}/facilities`, { schema: list(FacilityDto) }),
  careerVehicles: (careerId: string) =>
    api.get(`/admin/careers/${id(careerId)}/vehicles`, { schema: list(VehicleDto) }),
  careerPersonnel: (careerId: string) =>
    api.get(`/admin/careers/${id(careerId)}/personnel`, { schema: list(AdminPersonnelRow) }),
  careerLedger: (careerId: string, cursor?: string | null) =>
    api.getPage(`/admin/careers/${id(careerId)}/ledger`, {
      query: { cursor: cursor ?? undefined, limit: 25 },
      schema: list(LedgerEntryDto),
    }),
  careerProgression: (careerId: string) =>
    api.get(`/admin/careers/${id(careerId)}/progression`, { schema: AdminProgressionDto }),
  careerNotifications: (careerId: string) =>
    api.get(`/admin/careers/${id(careerId)}/notifications`, { schema: list(NotificationDto) }),
  adjustCredits: (careerId: string, body: AdminCreditAdjustmentBody) =>
    api.command(`/admin/careers/${id(careerId)}/credit-adjustment`, body, {
      schema: AdminCreditAdjustmentResult,
    }),
  spawnIncident: (careerId: string, body: AdminSpawnIncidentRequest) =>
    api.command(`/admin/careers/${id(careerId)}/spawn-incident`, body, { schema: IncidentDto }),
  setDuty: (careerId: string, onDuty: boolean, reason: string) =>
    api.command(`/admin/careers/${id(careerId)}/duty`, { onDuty, reason }, { schema: AdminCareerRow }),

  incidents: (query: {
    status?: string;
    careerId?: string;
    templateCode?: string;
    severityMin?: number;
    severityMax?: number;
  }) => api.get('/admin/incidents', { query: { ...query, limit: LIMIT }, schema: list(AdminIncidentRow) }),
  incident: (incidentId: string) =>
    api.get(`/admin/incidents/${id(incidentId)}`, { schema: AdminIncidentDetail }),
  forceResolveIncident: (incidentId: string, reason: string) =>
    api.command(`/admin/incidents/${id(incidentId)}/force-resolve`, { reason }, { schema: AdminIncidentRow }),
  cancelIncident: (incidentId: string, reason: string) =>
    api.command(`/admin/incidents/${id(incidentId)}/cancel`, { reason }, { schema: AdminIncidentRow }),

  scheduledActions: (query: { status?: string; type?: string; overdue?: boolean; careerId?: string }) =>
    api.get('/admin/scheduled-actions', {
      query: { ...query, limit: LIMIT } as Query,
      schema: list(AdminScheduledActionRow),
    }),
  scheduledAction: (actionId: string) =>
    api.get(`/admin/scheduled-actions/${id(actionId)}`, { schema: AdminScheduledActionDetail }),
  retryScheduledAction: (actionId: string, reason: string) =>
    api.command(
      `/admin/scheduled-actions/${id(actionId)}/retry`,
      { reason },
      { schema: AdminScheduledActionRow },
    ),

  configVersions: () => api.get('/admin/config/versions', { schema: list(AdminConfigVersionRow) }),
  configVersion: (versionId: string) =>
    api.get(`/admin/config/versions/${id(versionId)}`, { schema: AdminConfigVersionDetail }),
  configSchema: () => api.get('/admin/config/schema', { schema: z.record(z.unknown()) }),
  createConfigDraft: (body: { fromVersionId?: string; note?: string }) =>
    api.command('/admin/config/versions', body, { schema: AdminConfigVersionDetail }),
  saveConfigDraft: (versionId: string, body: { content: Record<string, unknown>; note?: string | null }) =>
    api.put(`/admin/config/versions/${id(versionId)}`, body, { schema: AdminConfigVersionDetail }),
  deleteConfigDraft: (versionId: string, reason: string) =>
    api.delete(`/admin/config/versions/${id(versionId)}`, { query: { reason } }),
  publishConfigVersion: (versionId: string, reason: string) =>
    api.command(
      `/admin/config/versions/${id(versionId)}/publish`,
      { reason },
      { schema: AdminConfigVersionRow },
    ),
  rollbackConfigVersion: (versionId: string, reason: string) =>
    api.command(
      `/admin/config/versions/${id(versionId)}/rollback`,
      { reason },
      { schema: AdminConfigVersionRow },
    ),

  catalog: () => api.get('/admin/catalog', { schema: AdminCatalogDto }),

  featureFlags: () => api.get('/admin/feature-flags', { schema: list(AdminFeatureFlagRow) }),
  setFeatureFlag: (key: string, enabled: boolean, reason: string) =>
    api.patch(`/admin/feature-flags/${id(key)}`, { enabled, reason }, { schema: AdminFeatureFlagRow }),

  closures: () => api.get('/admin/world/closures', { schema: list(AdminClosureRow) }),
  createClosure: (body: AdminClosureRequest) =>
    api.command('/admin/world/closures', body, { schema: AdminClosureRow }),
  deleteClosure: (closureId: string, reason: string) =>
    api.delete(`/admin/world/closures/${id(closureId)}`, { query: { reason } }),
  weatherOverride: () =>
    api.get('/admin/world/weather-override', { schema: AdminWeatherOverride.nullable() }),
  setWeatherOverride: (body: AdminWeatherOverrideBody) =>
    api.put('/admin/world/weather-override', body, { schema: AdminWeatherOverride }),
  clearWeatherOverride: (reason: string) =>
    api.delete('/admin/world/weather-override', { query: { reason } }),

  geodataReleases: () => api.get('/admin/geodata/releases', { schema: list(AdminGeodataRelease) }),
  publishGeodataRelease: (releaseId: string, reason: string) =>
    api.command(
      `/admin/geodata/releases/${id(releaseId)}/publish`,
      { reason },
      { schema: AdminGeodataRelease },
    ),
  rollbackGeodataRelease: (releaseId: string, reason: string) =>
    api.command(
      `/admin/geodata/releases/${id(releaseId)}/rollback`,
      { reason },
      { schema: AdminGeodataRelease },
    ),

  referrals: (query: { status?: string }) =>
    api.get('/admin/referrals', { query: { ...query, limit: LIMIT }, schema: list(AdminReferralRow) }),
  approveReferral: (referralId: string, reason: string) =>
    api.command(`/admin/referrals/${id(referralId)}/approve`, { reason }, { schema: AdminReferralRow }),
  invalidateReferral: (referralId: string, reason: string) =>
    api.command(`/admin/referrals/${id(referralId)}/invalidate`, { reason }, { schema: AdminReferralRow }),

  purchases: (query: { status?: string; q?: string }) =>
    api.get('/admin/purchases', { query: { ...query, limit: LIMIT }, schema: list(AdminPurchaseRow) }),
  markPurchaseForRefundReview: (purchaseId: string, reason: string) =>
    api.command(`/admin/purchases/${id(purchaseId)}/refund-review`, { reason }, { schema: AdminPurchaseRow }),

  audit: (
    query: { actor?: string; action?: string; targetType?: string; targetId?: string },
    cursor?: string | null,
  ) =>
    api.getPage('/admin/audit', {
      query: { ...query, cursor: cursor ?? undefined, limit: 50 },
      schema: list(AdminAuditRow),
    }),
};
