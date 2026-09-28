/**
 * Admin API (Spec 18, roles reduced to SUPPORT / GAME_ADMIN / SUPER_ADMIN by D-53).
 *
 * Every row, body and detail shape now comes from `contracts/business.ts` (the backend publishes them all).
 * What is left here is client-side only: the permission matrix mirrored from the server (the server enforces it;
 * the client uses it to hide what the caller cannot do), the closure reason keys offered by the form and the
 * tolerant parser for the public `GET /version`. Conventions shared by every admin route:
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
  AdminCareerDetail,
  AdminCareerRow,
  AdminCatalogDto,
  type AdminClosureBody,
  AdminClosureRow,
  AdminConfigVersionDetail,
  AdminConfigVersionRow,
  type AdminCreditAdjustmentBody as AdminCreditAdjustmentBodySchema,
  AdminCreditAdjustmentResult,
  AdminDashboardDto,
  AdminFeatureFlagRow,
  AdminGeodataRelease,
  AdminIncidentDetail,
  AdminIncidentRow,
  AdminPersonnelRow,
  AdminProgressionDto,
  AdminPurchaseRow,
  AdminQueueStats,
  AdminReferralRow,
  AdminScheduledActionDetail,
  AdminScheduledActionRow,
  type AdminSpawnIncidentBody,
  AdminSupportNote,
  AdminUserDetail,
  AdminUserRow,
  AdminWeatherOverride,
  type AdminWeatherOverrideBody,
  FacilityDto,
  IncidentDto,
  LedgerEntryDto,
  MajorIncidentDto,
  NotificationDto,
  type PlatformRole,
  VehicleDto,
} from '@/contracts';
import { api } from './client';
import { env } from '@/lib/env';

export type AdminCatalogDto = z.infer<typeof AdminCatalogDto>;
export type AdminCatalogEntry = AdminCatalogDto['sections'][string][number];
export type AdminUserRow = z.infer<typeof AdminUserRow>;
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;
export type AdminSupportNote = z.infer<typeof AdminSupportNote>;
export type AdminCareerRow = z.infer<typeof AdminCareerRow>;
export type AdminCareerDetail = z.infer<typeof AdminCareerDetail>;
export type AdminPersonnelRow = z.infer<typeof AdminPersonnelRow>;
export type AdminProgressionDto = z.infer<typeof AdminProgressionDto>;
export type AdminIncidentRow = z.infer<typeof AdminIncidentRow>;
export type AdminIncidentDetail = z.infer<typeof AdminIncidentDetail>;
export type AdminScheduledActionRow = z.infer<typeof AdminScheduledActionRow>;
export type AdminScheduledActionDetail = z.infer<typeof AdminScheduledActionDetail>;
export type AdminQueueStats = z.infer<typeof AdminQueueStats>;
export type AdminDashboardDto = z.infer<typeof AdminDashboardDto>;
export type AdminCreditAdjustmentBody = z.infer<typeof AdminCreditAdjustmentBodySchema>;
export type AdminConfigVersionRow = z.infer<typeof AdminConfigVersionRow>;
export type AdminConfigVersionDetail = z.infer<typeof AdminConfigVersionDetail>;
export type AdminFeatureFlagRow = z.infer<typeof AdminFeatureFlagRow>;
export type AdminAuditRow = z.infer<typeof AdminAuditRow>;
export type AdminClosureRow = z.infer<typeof AdminClosureRow>;
export type AdminClosureRequest = z.infer<typeof AdminClosureBody>;
export type AdminWeatherOverride = z.infer<typeof AdminWeatherOverride>;
export type AdminWeatherOverrideBody = z.infer<typeof AdminWeatherOverrideBody>;
export type AdminGeodataRelease = z.infer<typeof AdminGeodataRelease>;
export type AdminReferralRow = z.infer<typeof AdminReferralRow>;
export type AdminPurchaseRow = z.infer<typeof AdminPurchaseRow>;
export type AdminSpawnIncidentRequest = z.infer<typeof AdminSpawnIncidentBody>;
export type AdminRole = Exclude<z.infer<typeof PlatformRole>, 'USER'>;

/* ───────────── permission matrix (mirrors the server-side ADMIN_PERMISSIONS) ───────────── */
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
  'careers.spawnMajor': 'GAME_ADMIN',
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
/** A credit adjustment whose absolute value exceeds this needs SUPER_ADMIN (server-enforced). */
export const CREDIT_ADJUSTMENT_THRESHOLD = 10_000n;

export function adminRank(roles: readonly string[] | undefined | null): number {
  return Math.max(0, ...(roles ?? []).map((r) => RANK[r as AdminRole] ?? 0));
}
export function canAdmin(roles: readonly string[] | undefined | null, action: AdminAction): boolean {
  return adminRank(roles) >= RANK[ADMIN_PERMISSIONS[action]];
}

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

/** GET /version (root, no /api/v1 prefix). Parsed tolerantly: every field is optional. */
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
  /** QA / support: starts a major incident now (★POST /admin/careers/:id/major-incident, audited `major_incident.spawn`). */
  spawnMajor: (careerId: string, body: { scenarioCode?: string; reason: string }) =>
    api.command(`/admin/careers/${id(careerId)}/major-incident`, body, { schema: MajorIncidentDto }),
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
