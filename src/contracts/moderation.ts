/**
 * Moderation — study 2026-10-06 §04 (D-108, D-114), analisi/brief-alleanze/00-regole-comuni.md §2, notes
 * analisi/note-agenti/alleanze-platform.md. Text filter, reports, blocks, sanctions, community rules and the admin queue.
 * Additive within v1: new routes and shapes, three new id prefixes (`rep`, `san`, `blk`), new error codes
 * (`MUTED`, `TEXT_REJECTED`, `RULES_NOT_ACCEPTED`, `NAME_CHANGE_COOLDOWN`, `BLOCKED`).
 */
import { z } from 'zod';
import { PlatformRole } from './auth';
import { AdminReason } from './business';
import { IdPrefix, IsoDateTime, SupportedLocale, publicId } from './common';

/* ───────────── enums ───────────── */

/** What a report points at. `DIRECTOR_NAME` targets a career (its Director's name); the alliance kinds target an alliance. */
export const ReportTargetKind = z.enum(['MESSAGE', 'POST', 'REPLY', 'DIRECTOR_NAME', 'ALLIANCE_NAME', 'ALLIANCE_DESCRIPTION']);
export type ReportTargetKind = z.infer<typeof ReportTargetKind>;
export const ReportReason = z.enum(['HARASSMENT', 'SEXUAL', 'HATE', 'THREAT_SELF_HARM', 'PERSONAL_DATA', 'SPAM_SCAM', 'OTHER']);
export type ReportReason = z.infer<typeof ReportReason>;
export const ReportStatus = z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']);
export type ReportStatus = z.infer<typeof ReportStatus>;
/** `HIGH` = grave (SEXUAL / THREAT_SELF_HARM, or a grave filter hit): hidden at once and on top of the queue. */
export const ReportSeverity = z.enum(['NORMAL', 'HIGH']);
export type ReportSeverity = z.infer<typeof ReportSeverity>;
/** The decision an admin takes on a case (one decision closes the whole case, every reporter is told the outcome). */
export const ModerationAction = z.enum(['DISMISS', 'REMOVE_CONTENT', 'WARN', 'MUTE_PLATFORM', 'SUSPEND', 'FORCE_NEUTRAL_NAME', 'CLOSE_ALLIANCE']);
export type ModerationAction = z.infer<typeof ModerationAction>;
export const SanctionKind = z.enum(['WARNING', 'MUTE_PLATFORM', 'MUTE_ALLIANCE']);
export type SanctionKind = z.infer<typeof SanctionKind>;
export const TextFilterTier = z.enum(['REJECT', 'MASK', 'FLAG']);
export type TextFilterTier = z.infer<typeof TextFilterTier>;
/** What is being checked: names and tags never get masked (a MASK hit rejects them). */
export const TextFilterKind = z.enum(['MESSAGE', 'POST', 'REPLY', 'DIRECTOR_NAME', 'ALLIANCE_NAME', 'ALLIANCE_TAG', 'ALLIANCE_DESCRIPTION']);
export type TextFilterKind = z.infer<typeof TextFilterKind>;
/** Why the filter reacted: a listed term, or one of the always-rejected patterns (links, e-mails, phone numbers, social handles). */
export const TextFilterReason = z.enum(['BANNED_TERM', 'URL', 'EMAIL', 'PHONE', 'SOCIAL_HANDLE']);
export type TextFilterReason = z.infer<typeof TextFilterReason>;
/** Who issued a sanction or a moderation action. */
export const ModerationActor = z.enum(['ADMIN', 'ALLIANCE', 'SYSTEM']);
export type ModerationActor = z.infer<typeof ModerationActor>;

/**
 * Result of the text filter (also `details` of a 422 `TEXT_REJECTED` and the answer of the admin test endpoint).
 * `ok:false` = the text must not be stored (tier REJECT, or MASK on a name/tag); `masked` = the text to store when `ok`
 * (asterisked for MASK, unchanged otherwise); `FLAG` = stored but queued for review.
 */
export const TextCheckResult = z.object({
  ok: z.boolean(),
  tier: TextFilterTier.nullable(),
  masked: z.string(),
  reasons: z.array(TextFilterReason),
});
export type TextCheckResult = z.infer<typeof TextCheckResult>;

/* ───────────── player side ───────────── */

/**
 * ★POST /careers/:careerId/reports → 201 `ReportDto`. One case per target: a second report of the same target by the same
 * reporter returns the existing case (no error). `targetId` is the public id of the message / post / reply / career
 * (DIRECTOR_NAME) / alliance (ALLIANCE_*). 404 when the target is not visible to the reporter. Rate limited.
 */
export const CreateReportBody = z.object({
  targetKind: ReportTargetKind,
  targetId: z.string().min(1).max(64),
  reason: ReportReason,
  note: z.string().trim().max(500).optional(),
});
export type CreateReportBody = z.infer<typeof CreateReportBody>;
/** A report as its reporter sees it (`GET /careers/:careerId/reports`, newest first): the case and its outcome, never the content copy. */
export const ReportDto = z.object({
  id: publicId(IdPrefix.report),
  targetKind: ReportTargetKind,
  targetId: z.string(),
  reason: ReportReason,
  note: z.string().nullable(),
  status: ReportStatus,
  outcome: ModerationAction.nullable(),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
});
export type ReportDto = z.infer<typeof ReportDto>;

/** ★POST /careers/:careerId/blocks → 201 `BlockDto` (idempotent: blocking twice returns the same row). Self-block → 409 CONFLICT. */
export const CreateBlockBody = z.object({ careerId: publicId(IdPrefix.career) });
export type CreateBlockBody = z.infer<typeof CreateBlockBody>;
/** GET /careers/:careerId/blocks `BlockDto[]` · DELETE /careers/:careerId/blocks/:blockId (204). The blocked player never learns it. */
export const BlockDto = z.object({
  id: publicId(IdPrefix.block),
  careerId: publicId(IdPrefix.career),
  directorName: z.string(),
  createdAt: IsoDateTime,
});
export type BlockDto = z.infer<typeof BlockDto>;

/**
 * GET /me/community-rules — the current rules version (texts live in the catalog bundle under `community.rules.*`) and what
 * the caller accepted. Writing in a board or chat needs `accepted: true` (otherwise 403 `RULES_NOT_ACCEPTED`); when the version
 * changes, `accepted` goes back to false until the new version is accepted.
 */
export const CommunityRulesDto = z.object({
  version: z.string(),
  acceptedVersion: z.string().nullable(),
  acceptedAt: IsoDateTime.nullable(),
  accepted: z.boolean(),
});
export type CommunityRulesDto = z.infer<typeof CommunityRulesDto>;
/** ★POST /me/community-rules/accept → `CommunityRulesDto`. `version` must be the current one (409 CONFLICT otherwise). */
export const AcceptCommunityRulesBody = z.object({ version: z.string().min(1).max(16) });
export type AcceptCommunityRulesBody = z.infer<typeof AcceptCommunityRulesBody>;

/**
 * GET /me/sanctions `MySanctionDto[]` — active sanctions first, then the last 90 days. `reason` is the moderation reason
 * (never the admin's internal note); `allianceId` is set for an alliance mute only.
 */
export const MySanctionDto = z.object({
  id: publicId(IdPrefix.sanction),
  kind: SanctionKind,
  reason: ReportReason.nullable(),
  /** Public message the moderator wrote for the player (sober, optional). */
  message: z.string().nullable(),
  allianceId: z.string().nullable(),
  startsAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  active: z.boolean(),
});
export type MySanctionDto = z.infer<typeof MySanctionDto>;

/* ───────────── admin ───────────── */

/** One row of the moderation queue (`GET /admin/moderation/reports`): a case = one reported target, all its reporters. */
export const AdminReportRow = z.object({
  id: publicId(IdPrefix.report),
  status: ReportStatus,
  severity: ReportSeverity,
  targetKind: ReportTargetKind,
  targetId: z.string(),
  /** Most frequent reason among the reporters (the system's reason for a filter flag). */
  reason: ReportReason,
  reporterCount: z.number().int(),
  /** `true` when at least one report came from the text filter (FLAG tier) rather than a player. */
  flaggedByFilter: z.boolean(),
  hidden: z.boolean(),
  /** The author of the reported content (null when the content vanished before the copy was taken). */
  reportedUserId: publicId(IdPrefix.user).nullable(),
  reportedCareerId: publicId(IdPrefix.career).nullable(),
  reportedDirectorName: z.string().nullable(),
  allianceId: z.string().nullable(),
  /** First 140 characters of the copied content. */
  excerpt: z.string(),
  decision: ModerationAction.nullable(),
  createdAt: IsoDateTime,
  lastReportedAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
});
export type AdminReportRow = z.infer<typeof AdminReportRow>;

export const AdminReportContextItem = z.object({
  id: z.string(),
  authorDirectorName: z.string().nullable(),
  authorUserId: publicId(IdPrefix.user).nullable(),
  text: z.string(),
  createdAt: IsoDateTime,
  isTarget: z.boolean(),
});
export type AdminReportContextItem = z.infer<typeof AdminReportContextItem>;

export const AdminReportReporter = z.object({
  reporterUserId: publicId(IdPrefix.user).nullable(),
  reporterDirectorName: z.string().nullable(),
  /** `SYSTEM` = the text filter. */
  source: z.enum(['PLAYER', 'SYSTEM']),
  reason: ReportReason,
  note: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AdminReportReporter = z.infer<typeof AdminReportReporter>;

export const AdminSanctionRow = z.object({
  id: publicId(IdPrefix.sanction),
  userId: publicId(IdPrefix.user),
  directorName: z.string(),
  kind: SanctionKind,
  reason: ReportReason.nullable(),
  message: z.string().nullable(),
  allianceId: z.string().nullable(),
  caseId: publicId(IdPrefix.report).nullable(),
  issuedBy: ModerationActor,
  issuedByName: z.string().nullable(),
  startsAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
  active: z.boolean(),
  createdAt: IsoDateTime,
});
export type AdminSanctionRow = z.infer<typeof AdminSanctionRow>;

/**
 * GET /admin/moderation/reports/:id — the case with the copied content, the 10 messages before and after (chat / board),
 * every reporter, the filter verdict and the author's record. Every read is audited (`moderation.case.view`).
 */
export const AdminReportDetail = AdminReportRow.extend({
  content: z.object({
    text: z.string(),
    locale: SupportedLocale.nullable(),
    createdAt: IsoDateTime.nullable(),
    /** Whether the content is still live in its module (false after REMOVE_CONTENT or the author's own deletion). */
    live: z.boolean(),
  }),
  context: z.array(AdminReportContextItem),
  reporters: z.array(AdminReportReporter),
  filter: TextCheckResult.nullable(),
  author: z.object({
    /** Other cases about this author (any status), excluding this one. */
    cases: z.number().int(),
    sanctions: z.array(AdminSanctionRow),
    accountStatus: z.string().nullable(),
    accountCreatedAt: IsoDateTime.nullable(),
  }),
  decidedBy: z.string().nullable(),
  decisionReason: z.string().nullable(),
  /** The public message given to the sanctioned player with the decision, when any. */
  decisionMessage: z.string().nullable(),
});
export type AdminReportDetail = z.infer<typeof AdminReportDetail>;

/**
 * ★POST /admin/moderation/reports/:id/decide → `AdminReportDetail`. `reason` is the internal, audited motivation (mandatory);
 * `message` is what the sanctioned player reads (optional, ≤ 300 chars, sober). `durationHours` applies to MUTE_PLATFORM only
 * (default from `config.moderation.sanctions.defaultMuteHours`). SUSPEND, FORCE_NEUTRAL_NAME and CLOSE_ALLIANCE need GAME_ADMIN.
 * 409 CONFLICT when the case is already decided or the action does not fit the target (e.g. CLOSE_ALLIANCE on a message).
 */
export const AdminModerationDecisionBody = z.object({
  action: ModerationAction,
  reason: AdminReason,
  message: z.string().trim().max(300).optional(),
  durationHours: z.number().int().min(1).max(24 * 365).optional(),
});
export type AdminModerationDecisionBody = z.infer<typeof AdminModerationDecisionBody>;

/** GET /admin/moderation/reports query. Cursor pagination (`meta.nextCursor` / `hasMore`), HIGH severity first, then newest. */
export const AdminReportsQuery = z.object({
  status: ReportStatus.optional(),
  severity: ReportSeverity.optional(),
  targetKind: ReportTargetKind.optional(),
  userId: publicId(IdPrefix.user).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type AdminReportsQuery = z.infer<typeof AdminReportsQuery>;

/**
 * ★POST /admin/users/:id/sanctions → 201 `AdminSanctionRow`. SUPPORT may issue WARNING and MUTE_PLATFORM (no alliance mutes from
 * here: those belong to the alliance's own roles). `durationHours` is required for MUTE_PLATFORM.
 */
export const AdminSanctionBody = z.object({
  kind: z.enum(['WARNING', 'MUTE_PLATFORM']),
  reason: AdminReason,
  moderationReason: ReportReason.optional(),
  message: z.string().trim().max(300).optional(),
  durationHours: z.number().int().min(1).max(24 * 365).optional(),
});
export type AdminSanctionBody = z.infer<typeof AdminSanctionBody>;
/** GET /admin/sanctions query — `active` keeps only the sanctions in force now. Cursor paginated, newest first. */
export const AdminSanctionsQuery = z.object({
  userId: publicId(IdPrefix.user).optional(),
  kind: SanctionKind.optional(),
  /** `true` keeps only the sanctions in force now (`z.coerce.boolean` would read "false" as true, hence the enum). */
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type AdminSanctionsQuery = z.infer<typeof AdminSanctionsQuery>;

/** One term of the text filter (`GET /admin/moderation/text-filter`). `source: CATALOG` rows were seeded from the YAML lists. */
export const AdminTextFilterTermRow = z.object({
  id: z.string(),
  locale: SupportedLocale,
  term: z.string(),
  tier: TextFilterTier,
  reason: ReportReason.nullable(),
  enabled: z.boolean(),
  source: z.enum(['CATALOG', 'ADMIN']),
  updatedAt: IsoDateTime,
});
export type AdminTextFilterTermRow = z.infer<typeof AdminTextFilterTermRow>;
export const AdminTextFilterQuery = z.object({ locale: SupportedLocale.optional(), tier: TextFilterTier.optional(), q: z.string().max(64).optional() });
/** ★POST /admin/moderation/text-filter → 201 (GAME_ADMIN). A term is 2–64 characters; the same normalized term per locale is unique (409). */
export const AdminTextFilterTermBody = z.object({
  locale: SupportedLocale,
  term: z.string().trim().min(2).max(64),
  tier: TextFilterTier,
  moderationReason: ReportReason.optional(),
  reason: AdminReason,
});
export type AdminTextFilterTermBody = z.infer<typeof AdminTextFilterTermBody>;
/** PATCH /admin/moderation/text-filter/:id (GAME_ADMIN) — tier and/or enabled. */
export const AdminTextFilterTermPatch = z.object({ tier: TextFilterTier.optional(), enabled: z.boolean().optional(), reason: AdminReason });
export type AdminTextFilterTermPatch = z.infer<typeof AdminTextFilterTermPatch>;
/** POST /admin/moderation/text-filter/test → `TextCheckResult` (any admin role; nothing is stored). */
export const AdminTextFilterTestBody = z.object({ text: z.string().min(1).max(2000), kind: TextFilterKind.optional(), locale: SupportedLocale.optional() });
export type AdminTextFilterTestBody = z.infer<typeof AdminTextFilterTestBody>;

/** GET /admin/moderation/summary — the queue at a glance (study 04 §8 "cosa misurare"). */
export const AdminModerationSummary = z.object({
  open: z.number().int(),
  openHigh: z.number().int(),
  underReview: z.number().int(),
  decidedLast7Days: z.number().int(),
  /** Mean hours from the first report to the decision over the last 30 days (null without decisions). */
  meanDecisionHours: z.number().nullable(),
  activeMutes: z.number().int(),
  rolesAlerted: z.array(PlatformRole),
});
export type AdminModerationSummary = z.infer<typeof AdminModerationSummary>;
