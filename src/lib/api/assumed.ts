/**
 * Response shapes the v1 contract names in ROUTES.md but does not (yet) define as Zod schemas
 * (timeline, facility detail, balance, progression and unlocks were lifted into contracts/core-loop.ts by the backend).
 * These are the frontend's working assumptions; the mock backend implements exactly these.
 * When the backend publishes the real schema in `contracts/`, delete the matching entry here.
 */
import { z } from 'zod';
import { Amount, I18nText, IsoDateTime, PlatformRole } from '@/contracts';

/** GET /careers/:id/economy/stipend */
export const StipendDto = z.object({
  periodSeconds: z.number().int(),
  nextPaymentAt: IsoDateTime.nullable(),
  estimatedAmount: Amount,
  coveragePct: z.number().nullable(),
  accruedPeriods: z.number().int(),
  maxAccruedPeriods: z.number().int(),
});
export type StipendDto = z.infer<typeof StipendDto>;

/** GET /careers/:id/notifications */
export const NotificationDto = z.object({
  id: z.string(),
  kind: z.string(),
  title: I18nText,
  body: I18nText.nullable().optional(),
  createdAt: IsoDateTime,
  readAt: IsoDateTime.nullable(),
  incidentId: z.string().nullable().optional(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

/* ───────────── admin (ROUTES.md lists the resources only) ───────────── */
export const AdminDashboardDto = z.object({
  users: z.number().int(),
  careers: z.number().int(),
  activeCareers: z.number().int(),
  activeIncidents: z.number().int(),
  pendingScheduledActions: z.number().int(),
  overdueScheduledActions: z.number().int(),
  outboxPending: z.number().int(),
  creditsIssued24h: Amount,
  creditsSpent24h: Amount,
});
export const AdminUserDto = z.object({
  id: z.string(),
  email: z.string(),
  directorName: z.string(),
  roles: z.array(PlatformRole),
  locale: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED']),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime.nullable(),
});
export type AdminUserDto = z.infer<typeof AdminUserDto>;
export const AdminCareerDto = z.object({
  id: z.string(),
  userId: z.string(),
  directorName: z.string(),
  locationName: z.string(),
  level: z.number().int(),
  credits: Amount,
  onDuty: z.boolean(),
  activeIncidents: z.number().int(),
  vehicles: z.number().int(),
  createdAt: IsoDateTime,
});
export type AdminCareerDto = z.infer<typeof AdminCareerDto>;
export const AdminIncidentDto = z.object({
  id: z.string(),
  careerId: z.string(),
  templateCode: z.string(),
  status: z.string(),
  severity: z.number().int(),
  createdAt: IsoDateTime,
  address: z.string(),
});
export type AdminIncidentDto = z.infer<typeof AdminIncidentDto>;
export const AdminScheduledActionDto = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED']),
  careerId: z.string().nullable(),
  dueAt: IsoDateTime,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
});
export type AdminScheduledActionDto = z.infer<typeof AdminScheduledActionDto>;
export const AdminQueueDto = z.object({
  name: z.string(),
  waiting: z.number().int(),
  active: z.number().int(),
  delayed: z.number().int(),
  failed: z.number().int(),
  completed: z.number().int(),
});
export type AdminQueueDto = z.infer<typeof AdminQueueDto>;
export const AdminLedgerAdjustmentBody = z.object({
  careerId: z.string().min(1),
  amount: z.string().regex(/^-?[1-9]\d*$/),
  reason: z.string().min(5).max(500),
  entryType: z.enum(['ADMIN_ADJUSTMENT', 'COMPENSATION', 'PROMOTION']),
});
export type AdminLedgerAdjustmentBody = z.infer<typeof AdminLedgerAdjustmentBody>;
export const AdminConfigVersionDto = z.object({
  id: z.string(),
  version: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']),
  createdAt: IsoDateTime,
  publishedAt: IsoDateTime.nullable(),
  author: z.string(),
  notes: z.string().nullable(),
});
export type AdminConfigVersionDto = z.infer<typeof AdminConfigVersionDto>;
export const AdminFeatureFlagDto = z.object({
  key: z.string(),
  enabled: z.boolean(),
  description: z.string().nullable(),
  updatedAt: IsoDateTime,
});
export type AdminFeatureFlagDto = z.infer<typeof AdminFeatureFlagDto>;
