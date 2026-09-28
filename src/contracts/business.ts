/**
 * Business domains: stipend, shop/payments, speed-ups, rewarded ads, referrals, notifications, admin.
 * Authored by the lead BEFORE implementation so backend and frontend can be built in parallel.
 * Backend may extend additively; never rename or remove fields.
 */
import { z } from 'zod';
import { Amount, I18nText, IdPrefix, IsoDateTime, LngLat, ServiceFamily, publicId } from './common';
import { PlatformRole } from './auth';
// Used by the additive admin shapes at the bottom of this file (backend-business).
import { CareerSummary, FacilityDto, IncidentDto, LedgerEntryDto, VehicleDto, WeatherCode } from './game';
import { TimelineEntryDto } from './core-loop';

/* ───────────── stipend & coverage ───────────── */
export const StipendDto = z.object({
  periodSeconds: z.number().int(), nextPayoutAt: IsoDateTime, accruedPeriods: z.number().int(), maxAccruedPeriods: z.number().int(),
  estimate: z.object({
    base: Amount, coverageMultiplier: z.number(), reputationMultiplier: z.number(), personnelCost: Amount, net: Amount,
    /* ── additive (temporary-stipend-implementation) ── */
    /** Mission-linked bonus (share of the period's MISSION_REWARD total, capped): upkeep never deducts from this part. */
    activityBonus: Amount.optional(),
  }),
  lastPayout: z.object({ at: IsoDateTime, net: Amount }).nullable(),
  /* ── additive (backend-integration) ── */
  /** After this instant of inactivity accrual stops (D-11); null when unknown. */
  accrualStopsAt: IsoDateTime.nullable().optional(),
  coveragePct: z.number().optional(),
  /** Facility effects (e.g. coordination centre +5%). */
  bonusMultiplier: z.number().optional(),
  history: z.array(z.object({
    /** `SKIPPED_DISABLED`: the `coverage_stipend` feature flag was off for this period (temporary-stipend-implementation). */
    periodKey: z.string(), status: z.enum(['PAID', 'SKIPPED_INACTIVE', 'SKIPPED_DISABLED']), net: Amount, base: Amount, coveragePct: z.number(), coverageMultiplier: z.number(),
    reputationMultiplier: z.number(), personnelCost: Amount, activityBonus: Amount.optional(), at: IsoDateTime,
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
/** POST /admin/careers/:id/spawn-incident (`position` and `reason` additive — backend-business) */
export const AdminSpawnIncidentBody = z.object({
  templateCode: z.string(), severity: z.number().int().min(1).max(10).optional(),
  position: LngLat.optional(), reason: z.string().trim().min(5).max(500).optional(),
});
/** POST /admin/world/closures (`reason` additive — backend-business) */
export const AdminClosureBody = z.object({
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3), reasonKey: z.string(), durationSeconds: z.number().int().min(60), multiplier: z.number().min(1).max(10),
  reason: z.string().trim().min(5).max(500).optional(),
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Additive extensions (backend-business, wave S13–S17).
 * Nothing above this line was renamed or removed; everything here is new.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** ★POST /speedups — the executed process patched back into the client snapshot. */
export const SpeedupResult = z.object({
  target: SpeedupTarget, targetId: z.string(), remainingSeconds: z.number().int().optional(), cost: Amount,
  career: CareerSummary.optional(), vehicle: VehicleDto.optional(), facility: FacilityDto.optional(),
});

/** GET /notifications/unread-count */
export const NotificationUnreadDto = z.object({ unread: z.number().int() });
/** GET|PUT /notifications/preferences */
export const NotificationPreferenceDto = z.object({ category: NotificationCategory, enabled: z.boolean() });
export const NotificationPreferencesBody = z.object({ preferences: z.array(NotificationPreferenceDto).min(1) });

/** POST /analytics/events → accepted / rejected summary (the client only checks the status code). */
export const AnalyticsIngestResult = z.object({
  accepted: z.number().int(), rejected: z.array(z.object({ name: z.string(), reason: z.string() })),
});

/* ───────────── admin: shared request shapes ───────────── */
/** Every privileged mutation carries a reason (Spec 18 §12 "no silent fix"). */
export const AdminReason = z.string().trim().min(5).max(500);
export const AdminReasonBody = z.object({ reason: AdminReason });
export const AdminReasonQuery = z.object({ reason: AdminReason });
export const AdminRolesBody = z.object({ roles: z.array(z.enum(['SUPPORT', 'GAME_ADMIN', 'SUPER_ADMIN'])), reason: AdminReason });
export const AdminNoteBody = z.object({ text: z.string().trim().min(5).max(500) });
export const AdminDutyBody = z.object({ onDuty: z.boolean(), reason: AdminReason });
export const AdminFeatureFlagBody = z.object({ enabled: z.boolean(), reason: AdminReason });
export const AdminConfigDraftBody = z.object({ fromVersionId: z.string().optional(), note: z.string().max(500).optional() });
export const AdminConfigSaveBody = z.object({ content: z.record(z.unknown()), note: z.string().max(500).nullable().optional() });
export const AdminWeatherOverrideBody = z.object({
  /** Must be a `WeatherCode`: the forced value is served back in `WorldContextDto.weather.code`. */
  code: WeatherCode, durationSeconds: z.number().int().min(60), reason: AdminReason,
});

/* ───────────── admin: users ───────────── */
export const AdminSessionRow = z.object({ id: z.string(), userAgent: z.string().nullable(), createdAt: IsoDateTime, lastUsedAt: IsoDateTime });
export const AdminSupportNote = z.object({ id: z.string(), author: z.string(), text: z.string(), createdAt: IsoDateTime });
export const AdminUserDetail = z.object({
  user: AdminUserRow, locale: z.string(), marketingConsent: z.boolean(),
  suspension: z.object({ reason: z.string(), at: IsoDateTime, by: z.string() }).nullable(),
  sessions: z.array(AdminSessionRow), notes: z.array(AdminSupportNote), audit: z.array(AdminAuditRow),
});

/* ───────────── admin: careers ───────────── */
export const AdminCareerDetail = z.object({
  career: AdminCareerRow, userId: publicId(IdPrefix.user), email: z.string(), summary: CareerSummary,
  stats: z.object({ incidentsResolved: z.number().int(), incidentsFailed: z.number().int(), creditsEarned: Amount, creditsSpent: Amount }),
  /** Caller-scoped: null = unlimited (SUPER_ADMIN), "0" = the caller may not adjust credits at all. */
  creditAdjustmentLimit: Amount.nullable(),
});
export const AdminPersonnelRow = z.object({ id: z.string(), name: z.string(), roleCode: z.string().nullable(), status: z.string(), facilityId: z.string().nullable() });
export const AdminProgressionDto = z.object({
  level: z.number().int(), xp: Amount, xpForCurrentLevel: Amount, xpForNextLevel: Amount, reputation: z.number(),
  unlockedFamilies: z.array(z.string()), tutorialCompleted: z.boolean(), tutorialStep: z.string().nullable(),
  incidentsResolved: z.number().int(), incidentsFailed: z.number().int(),
});
export const AdminCreditAdjustmentResult = z.object({ entry: LedgerEntryDto, credits: Amount });

/* ───────────── admin: incidents & scheduled actions ───────────── */
export const AdminIncidentRow = z.object({
  id: publicId(IdPrefix.incident), careerId: publicId(IdPrefix.career), directorName: z.string(), templateCode: z.string(), category: z.string(),
  status: z.string(), severity: z.number().int(), address: z.string(), createdAt: IsoDateTime, closedAt: IsoDateTime.nullable(),
});
export const AdminIncidentDetail = z.object({
  row: AdminIncidentRow, incident: IncidentDto, vehicles: z.array(VehicleDto), timeline: z.array(TimelineEntryDto), scheduledActions: z.array(AdminScheduledActionRow),
});
export const AdminScheduledActionDetail = AdminScheduledActionRow.extend({ careerId: z.string().nullable(), payload: z.record(z.unknown()) });

/* ───────────── admin: config & catalog ───────────── */
export const AdminConfigVersionDetail = AdminConfigVersionRow.extend({ content: z.record(z.unknown()) });
export const AdminCatalogEntry = z.object({
  code: z.string(), kind: z.string(), family: z.string().nullable(), requiredLevel: z.number().int().nullable(), price: Amount.nullable(),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export const AdminCatalogDto = z.object({ version: z.string(), contentHash: z.string(), i18nHash: z.string().nullable(), sections: z.record(z.array(AdminCatalogEntry)) });

/* ───────────── admin: world & geodata ───────────── */
export const AdminClosureRow = z.object({
  id: z.string(), polygon: z.array(z.tuple([z.number(), z.number()])), reasonKey: z.string(), multiplier: z.number(),
  createdAt: IsoDateTime, endsAt: IsoDateTime, createdBy: z.string(),
});
export const AdminWeatherOverride = z.object({ code: WeatherCode, startedAt: IsoDateTime, endsAt: IsoDateTime, createdBy: z.string(), reason: z.string() });
export const AdminGeodataRelease = z.object({
  id: z.string(), version: z.string(), status: z.enum(['BUILDING', 'READY', 'PUBLISHED', 'ROLLED_BACK']), createdAt: IsoDateTime,
  publishedAt: IsoDateTime.nullable(), note: z.string().nullable(),
  counts: z.object({ municipalities: z.number().int(), sites: z.number().int(), hospitals: z.number().int(), populationCells: z.number().int() }),
});

/* ───────────── admin: referrals & purchases ───────────── */
export const AdminReferralRow = z.object({
  id: z.string(), referrerName: z.string(), referrerCareerId: z.string().nullable(), invitedName: z.string(), invitedUserId: z.string().nullable(),
  status: z.enum(['REGISTERED', 'ACTIVATED', 'REWARDED', 'INVALIDATED', 'UNDER_REVIEW']), signals: z.array(z.string()),
  createdAt: IsoDateTime, reviewedAt: IsoDateTime.nullable(), reviewNote: z.string().nullable(),
});
export const AdminPurchaseRow = z.object({
  id: publicId(IdPrefix.purchase), userId: z.string().nullable(), email: z.string(), careerId: z.string().nullable(), packageId: z.string(),
  credits: Amount, priceMinor: z.number().int(), currency: z.string(), status: z.enum(['CREATED', 'PAID', 'CREDITED', 'FAILED', 'REFUNDED']),
  providerRef: z.string().nullable(), refunded: z.boolean(),
  refundReview: z.object({ reason: z.string(), by: z.string(), at: IsoDateTime }).nullable(),
  createdAt: IsoDateTime, completedAt: IsoDateTime.nullable(),
  /** Credits that could not be taken back after a refund because they were already spent (support follow-up). */
  clawbackResidue: Amount.optional(),
});

/* ───────────── admin: analytics ───────────── */
export const AdminFunnelStep = z.object({ event: z.string(), count: z.number().int(), users: z.number().int(), conversion: z.number() });
export const AdminFunnelDto = z.object({
  since: IsoDateTime, until: IsoDateTime, steps: z.array(AdminFunnelStep),
  totals: z.object({ events: z.number().int(), users: z.number().int() }),
});

/** GET /admin/queues */
export const AdminQueueList = z.array(AdminQueueStats);

/** POST /webhooks/stripe · POST /webhooks/simulated-payment */
export const WebhookAck = z.object({ received: z.boolean(), duplicate: z.boolean().optional(), handled: z.string().optional() });

/* ═══════════════════════════════════════════════════════════════════════════
 * Additive extensions: saved card (save once via Checkout, charge again without a redirect).
 * ═══════════════════════════════════════════════════════════════════════════ */

/** GET /shop/payment-method */
export const SavedPaymentMethodDto = z.object({
  present: z.boolean(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expMonth: z.number().int().nullable(),
  expYear: z.number().int().nullable(),
});
/** ★POST /shop/payment-method — opens a Checkout Session in `setup` mode to save a card for later. */
export const SaveCardResult = z.object({ setupUrl: z.string().url() });
/** ★POST /shop/checkout-saved — charge the saved card off-session, or fall back to a hosted checkout when it cannot. */
export const ChargeSavedCardBody = z.object({ packageId: z.string(), withdrawalWaiverAccepted: z.literal(true) });
export const ChargeSavedCardResult = z.object({
  status: z.enum(['CHARGED', 'REQUIRES_CHECKOUT', 'DECLINED']),
  purchaseId: publicId(IdPrefix.purchase),
  /** Present only when `status` is REQUIRES_CHECKOUT: the card needed interactive authentication (SCA). */
  checkoutUrl: z.string().url().nullable(),
});
