/**
 * Business domains: stipend, shop/payments, speed-ups, rewarded ads, referrals, notifications, admin.
 * Authored by the lead BEFORE implementation so backend and frontend can be built in parallel.
 * Backend may extend additively; never rename or remove fields.
 */
import { z } from 'zod';
import { Amount, I18nText, IdPrefix, IsoDateTime, LngLat, ServiceFamily, publicId } from './common';
import { PlatformRole } from './auth';

/* ───────────── stipend & coverage ───────────── */
export const StipendDto = z.object({
  periodSeconds: z.number().int(), nextPayoutAt: IsoDateTime, accruedPeriods: z.number().int(), maxAccruedPeriods: z.number().int(),
  estimate: z.object({ base: Amount, coverageMultiplier: z.number(), reputationMultiplier: z.number(), personnelCost: Amount, net: Amount }),
  lastPayout: z.object({ at: IsoDateTime, net: Amount }).nullable(),
  /* ── additive (backend-integration) ── */
  /** After this instant of inactivity accrual stops (D-11); null when unknown. */
  accrualStopsAt: IsoDateTime.nullable().optional(),
  coveragePct: z.number().optional(),
  /** Facility effects (e.g. coordination centre +5%). */
  bonusMultiplier: z.number().optional(),
  history: z.array(z.object({
    periodKey: z.string(), status: z.enum(['PAID', 'SKIPPED_INACTIVE']), net: Amount, base: Amount, coveragePct: z.number(), coverageMultiplier: z.number(),
    reputationMultiplier: z.number(), personnelCost: Amount, at: IsoDateTime,
  })).optional(),
});
export const CoverageDto = z.object({
  computedAt: IsoDateTime, targetSeconds: z.number().int(), overallPct: z.number(),
  byFamily: z.array(z.object({
    family: ServiceFamily, pct: z.number(),
    /* additive */ thresholdSeconds: z.number().optional(), weight: z.number().optional(), populationCovered: z.number().optional(), active: z.boolean().optional(),
  })),
  /** H3 cell id → best response seconds (null = unreachable) for the map layer. */
  cells: z.array(z.object({
    h3: z.string(), population: z.number(), bestSeconds: z.number().nullable(),
    /* additive: cell centre, membership of the career area, simulated seconds per family (isochrone-like data). */
    center: LngLat.optional(), inArea: z.boolean().optional(), secondsByFamily: z.record(z.number()).optional(),
  })),
  /* ── additive (backend-integration) ── */
  method: z.enum(['OSRM_TABLE', 'STRAIGHT_LINE', 'NONE']).optional(),
  populationTotal: z.number().optional(),
  facilities: z.array(z.object({ id: z.string(), position: LngLat, families: z.array(ServiceFamily) })).optional(),
  /** Second rings the client can use to colour cells like isochrones. */
  isochroneSeconds: z.array(z.number()).optional(),
  /** True while a recompute is pending after a fleet/facility change. */
  stale: z.boolean().optional(),
});

/* ───────────── shop & payments ───────────── */
export const CreditPackageDto = z.object({
  id: z.string(), credits: Amount, bonusCredits: Amount, priceMinor: z.number().int(), currency: z.string().length(3),
  label: I18nText, highlight: z.enum(['NONE', 'POPULAR', 'BEST_VALUE', 'STARTER']), oneTime: z.boolean(), available: z.boolean(),
});
/** ★POST /shop/checkout */
export const CheckoutBody = z.object({ packageId: z.string(), withdrawalWaiverAccepted: z.literal(true) });
export const CheckoutResult = z.object({ purchaseId: publicId(IdPrefix.purchase), checkoutUrl: z.string().url() });
export const PurchaseDto = z.object({
  id: publicId(IdPrefix.purchase), packageId: z.string(), credits: Amount, priceMinor: z.number().int(), currency: z.string(),
  status: z.enum(['CREATED', 'PAID', 'CREDITED', 'FAILED', 'REFUNDED']), createdAt: IsoDateTime, completedAt: IsoDateTime.nullable(),
});

/** ★POST /speedups — finish a managerial process now (never travel/intervention). */
export const SpeedupTarget = z.enum(['VEHICLE_DELIVERY', 'SUPPLY_DELIVERY', 'FACILITY_UPGRADE', 'MAINTENANCE', 'TRAINING', 'REST', 'ONBOARDING']);
export const SpeedupQuoteQuery = z.object({ target: SpeedupTarget, targetId: z.string() });
export const SpeedupQuote = z.object({ target: SpeedupTarget, targetId: z.string(), remainingSeconds: z.number().int(), cost: Amount });
export const SpeedupBody = SpeedupQuoteQuery;

/* ───────────── rewarded ads ───────────── */
export const AdsStatusDto = z.object({
  enabled: z.boolean(), provider: z.string(), reward: Amount, dailyLimit: z.number().int(), watchedToday: z.number().int(),
  nextAvailableAt: IsoDateTime.nullable(), resetsAt: IsoDateTime,
});
/** ★POST /ads/start → token ; ★POST /ads/complete {token, providerProof?} → credits */
export const AdStartResult = z.object({ adToken: z.string(), minWatchSeconds: z.number().int(), provider: z.string(), providerConfig: z.record(z.unknown()) });
export const AdCompleteBody = z.object({ adToken: z.string(), providerProof: z.string().optional() });
export const AdCompleteResult = z.object({ credited: Amount, status: AdsStatusDto });

/* ───────────── referrals ───────────── */
export const ReferralDto = z.object({
  code: z.string(), inviteUrl: z.string().url(), required: z.number().int(), activated: z.number().int(),
  rewardReferrer: Amount, rewardInvited: Amount, rewardClaimed: z.boolean(),
  activation: z.object({ missionsRequired: z.number().int(), distinctDaysRequired: z.number().int() }),
  invited: z.array(z.object({ directorName: z.string(), status: z.enum(['REGISTERED', 'ACTIVATED', 'REWARDED', 'INVALIDATED']), joinedAt: IsoDateTime })),
  /** Present when the current user was invited by someone. */
  myInvitation: z.object({ referrerName: z.string(), missionsDone: z.number().int(), daysDone: z.number().int(), status: z.string() }).nullable(),
});
/** GET /public/invite/:code */
export const PublicInviteDto = z.object({ directorName: z.string(), valid: z.boolean() });

/* ───────────── notifications ───────────── */
export const NotificationCategory = z.enum(['OPERATIONS', 'FLEET', 'PERSONNEL', 'FACILITIES', 'ECONOMY', 'PROGRESSION', 'SYSTEM']);
export const NotificationPriority = z.enum(['CRITICAL', 'IMPORTANT', 'INFO']);
export const NotificationDto = z.object({
  id: publicId(IdPrefix.notification), category: NotificationCategory, priority: NotificationPriority,
  title: I18nText, body: I18nText, createdAt: IsoDateTime, readAt: IsoDateTime.nullable(),
  action: z.object({ kind: z.enum(['OPEN_INCIDENT', 'OPEN_VEHICLE', 'OPEN_FACILITY', 'OPEN_PERSONNEL', 'OPEN_SHOP', 'OPEN_PROGRESSION', 'NONE']), targetId: z.string().nullable() }),
});

/* ───────────── analytics (client → server) ───────────── */
/** POST /analytics/events — product events only, batched. */
export const AnalyticsEventBody = z.object({
  events: z.array(z.object({ name: z.string().max(64), at: IsoDateTime, props: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() })).max(50),
});

/* ───────────── admin ───────────── */
export const AdminUserRow = z.object({
  id: publicId(IdPrefix.user), email: z.string(), directorName: z.string(), status: z.string(), roles: z.array(PlatformRole),
  createdAt: IsoDateTime, lastSeenAt: IsoDateTime.nullable(), careerId: publicId(IdPrefix.career).nullable(),
});
export const AdminCareerRow = z.object({
  id: publicId(IdPrefix.career), directorName: z.string(), locationName: z.string(), level: z.number().int(), credits: Amount,
  vehicles: z.number().int(), facilities: z.number().int(), activeIncidents: z.number().int(), onDuty: z.boolean(), lastActiveAt: IsoDateTime.nullable(),
});
export const AdminScheduledActionRow = z.object({
  id: z.string(), type: z.string(), status: z.string(), dueAt: IsoDateTime, attempts: z.number().int(),
  aggregateType: z.string().nullable(), aggregateId: z.string().nullable(), lastError: z.string().nullable(),
});
export const AdminQueueStats = z.object({ name: z.string(), waiting: z.number().int(), active: z.number().int(), delayed: z.number().int(), failed: z.number().int(), completed: z.number().int() });
export const AdminDashboardDto = z.object({
  users: z.number().int(), careers: z.number().int(), onDutyCareers: z.number().int(), activeIncidents: z.number().int(),
  overdueScheduledActions: z.number().int(), pendingOutbox: z.number().int(), queues: z.array(AdminQueueStats),
  providers: z.array(z.object({ name: z.string(), healthy: z.boolean(), detail: z.string().nullable() })),
  revenueMinorLast30d: z.number().int(), signupsLast7d: z.number().int(),
});
/** ★POST /admin/careers/:id/credit-adjustment */
export const AdminCreditAdjustmentBody = z.object({ amount: Amount, reasonCode: z.enum(['COMPENSATION', 'CORRECTION', 'PROMOTION', 'FRAUD_REVERSAL']), note: z.string().min(5).max(500) });
export const AdminConfigVersionRow = z.object({ id: z.string(), version: z.string(), status: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']), createdAt: IsoDateTime, publishedAt: IsoDateTime.nullable(), author: z.string().nullable(), note: z.string().nullable() });
export const AdminFeatureFlagRow = z.object({ key: z.string(), enabled: z.boolean(), description: z.string().nullable(), updatedAt: IsoDateTime });
export const AdminAuditRow = z.object({ id: z.string(), actor: z.string(), action: z.string(), targetType: z.string(), targetId: z.string().nullable(), reason: z.string().nullable(), createdAt: IsoDateTime });
/** POST /admin/careers/:id/spawn-incident */
export const AdminSpawnIncidentBody = z.object({ templateCode: z.string(), severity: z.number().int().min(1).max(10).optional() });
/** POST /admin/world/closures */
export const AdminClosureBody = z.object({ polygon: z.array(z.tuple([z.number(), z.number()])).min(3), reasonKey: z.string(), durationSeconds: z.number().int().min(60), multiplier: z.number().min(1).max(10) });
