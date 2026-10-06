import { z } from 'zod';
import { Amount, IdPrefix, IsoDateTime, ServiceFamily, SupportedLocale, publicId } from './common';

/**
 * Alliances — D-102…D-123 [U/C], analisi/studio-2026-10-06-alleanze (02 structure/roles/access, 08 §3.1, §5, §6),
 * analisi/brief-alleanze/00-regole-comuni.md §2 (fixed identifiers), analisi/note-agenti/alleanze-backend.md.
 *
 * A stable group of Directors (one ACTIVE membership per career, D-30 ⇒ one per player) with a name, a tag and an emblem,
 * three roles (COORDINATOR / DEPUTY / MEMBER), 10 → 40 member slots growing with the alliance level (06 §1.2). Worlds stay
 * personal (D-10): the alliance is a layer above them. This file holds the alliance itself (membership, roles, invites,
 * join requests, settings, log), the Director card and privacy settings, the alliance realtime stream, the sync snapshot
 * field, the admin surface and the enums that `game.ts` needs (so that this file only ever imports `common.ts`).
 *
 * Every alliance feature is behind a flag with code default `false`: `alliances` (this file), `alliance_board`,
 * `alliance_chat`, `alliance_aid`, `alliance_objectives`, `alliance_ranking`, `alliance_operations`. A GET of a feature that
 * is off answers empty / null, a command answers 403 `FEATURE_DISABLED`. A career that is not an ACTIVE member of the
 * alliance a route addresses gets 404 `NOT_FOUND` (never "forbidden": the alliance is not revealed).
 *
 * Realtime: a second stream on the same `/game` socket — event name `alliance` (`ALLIANCE_SOCKET_EVENT`), room
 * `alliance:<all_…>`, sequence per alliance, replay `GET /careers/:careerId/alliance/sync?since=<seq>`. The career stream
 * keeps carrying what concerns one world (vehicle status, credits, notifications) through its existing event types.
 */

/* ───────────────────────────── enums ───────────────────────────── */

/** `CLOSED` = closed by the administration (★POST /admin/alliances/:a/close); `DISBANDING` = 48 h notice running. */
export const AllianceStatus = z.enum(['ACTIVE', 'DISBANDING', 'DISBANDED', 'CLOSED']);
export type AllianceStatus = z.infer<typeof AllianceStatus>;
/** How one gets in: one tap (`OPEN`), approval by a high role (`REQUEST`), invite link / direct invite only (`INVITE`). */
export const AllianceJoinPolicy = z.enum(['OPEN', 'REQUEST', 'INVITE']);
export type AllianceJoinPolicy = z.infer<typeof AllianceJoinPolicy>;
/** Italian UI: Coordinatore / Vice / Membro. Permission matrix: study 02 §3 (mirrored in the notes). */
export const AllianceMemberRole = z.enum(['COORDINATOR', 'DEPUTY', 'MEMBER']);
export type AllianceMemberRole = z.infer<typeof AllianceMemberRole>;
/** `REMOVED` may ask to come back; `BANNED` can neither re-join nor be re-invited. */
export const AllianceMemberStatus = z.enum(['INVITED', 'REQUESTED', 'ACTIVE', 'LEFT', 'REMOVED', 'BANNED']);
export type AllianceMemberStatus = z.infer<typeof AllianceMemberStatus>;
/**
 * "Chi c'è" (03 §3.4): `ON_DUTY` = duty switch on AND a visible game client · `ONLINE` = a visible client · `AWAY`.
 * A member who hides his state (`showOnDuty: false`) is always `AWAY` for the others.
 */
export const AlliancePresence = z.enum(['ON_DUTY', 'ONLINE', 'AWAY']);
export type AlliancePresence = z.infer<typeof AlliancePresence>;
/** Alliance mute by a high role (02 §3): one hour, 24 hours, seven days. */
export const AllianceMuteDuration = z.enum(['H1', 'H24', 'D7']);
export type AllianceMuteDuration = z.infer<typeof AllianceMuteDuration>;
/** Coarse "last seen" shown to allies only (02 §6): never an exact instant. */
export const AllianceLastSeen = z.enum(['TODAY', 'THIS_WEEK', 'EARLIER']);
export type AllianceLastSeen = z.infer<typeof AllianceLastSeen>;

/* Aid enums live here (not in alliance-aid.ts) because `game.ts` embeds them in `VehicleDto` / `IncidentDto` without a cycle. */
/** `FILLED` = every gap covered by allied columns · `CLOSED` = the incident ended · `CANCELLED` = withdrawn by the requester. */
export const AidRequestStatus = z.enum(['OPEN', 'FILLED', 'CANCELLED', 'EXPIRED', 'CLOSED']);
export type AidRequestStatus = z.infer<typeof AidRequestStatus>;
/** `RECALLED` = the helper called it back before/while on scene (then RETURNING) · `ABORTED` = incident over before arrival. */
export const AidColumnStatus = z.enum(['EN_ROUTE', 'ON_SCENE', 'RECALLED', 'RETURNING', 'RETURNED', 'ABORTED']);
export type AidColumnStatus = z.infer<typeof AidColumnStatus>;

/* ───────────────────────────── names, tag, emblem ───────────────────────────── */

export const ALLIANCE_NAME_MIN = 3;
export const ALLIANCE_NAME_MAX = 24;
export const ALLIANCE_TAG_MIN = 2;
export const ALLIANCE_TAG_MAX = 5;
export const ALLIANCE_DESCRIPTION_MAX = 300;
/** Unique ignoring case and accents (server normalizes); through the text filter (`TEXT_REJECTED`). */
export const AllianceName = z.string().trim().min(ALLIANCE_NAME_MIN).max(ALLIANCE_NAME_MAX);
/** 2–5 letters or digits, unique, upper-cased by the server, shown as `[ABR] Federico`. */
export const AllianceTag = z.string().trim().regex(/^[A-Za-z0-9]{2,5}$/, 'expected 2-5 letters or digits');
export const AllianceDescription = z.string().trim().max(ALLIANCE_DESCRIPTION_MAX);

/** Emblem from templates (02 §1): one shape, one symbol, two colours. Never an uploaded image. Higher levels unlock more codes (06 §1.3). */
export const AllianceEmblemShape = z.enum(['SHIELD', 'CIRCLE', 'HEXAGON', 'DIAMOND', 'BANNER', 'STAR', 'TRIANGLE', 'SQUARE']);
export type AllianceEmblemShape = z.infer<typeof AllianceEmblemShape>;
export const AllianceEmblemSymbol = z.enum([
  'FLAME', 'CROSS_PLUS', 'WAVE', 'MOUNTAIN', 'HELMET', 'STAR', 'TREE', 'BOLT', 'ANCHOR', 'WING', 'SIREN', 'COMPASS', 'TOWER', 'EAGLE', 'ROPE', 'DROP',
]);
export type AllianceEmblemSymbol = z.infer<typeof AllianceEmblemSymbol>;
export const AllianceEmblemColor = z.enum(['NAVY', 'RED', 'BLUE', 'ORANGE', 'GREEN', 'SILVER', 'GOLD', 'BLACK', 'WHITE', 'PURPLE', 'TEAL', 'AMBER']);
export type AllianceEmblemColor = z.infer<typeof AllianceEmblemColor>;
export const AllianceEmblemDto = z.object({
  shape: AllianceEmblemShape,
  symbol: AllianceEmblemSymbol,
  primaryColor: AllianceEmblemColor,
  secondaryColor: AllianceEmblemColor,
});
export type AllianceEmblemDto = z.infer<typeof AllianceEmblemDto>;

/** Cosmetic emblem frame of last week's top 3 (06 §3.3), shown for one week. */
export const AllianceFrame = z.enum(['GOLD', 'SILVER', 'BRONZE']);
export type AllianceFrame = z.infer<typeof AllianceFrame>;

/** Someone inside an alliance context: a Director. `careerId`/`directorName` null = deleted account ("Direttore eliminato"). */
export const AllianceDirectorRefDto = z.object({
  careerId: publicId(IdPrefix.career).nullable(),
  directorName: z.string().nullable(),
});
export type AllianceDirectorRefDto = z.infer<typeof AllianceDirectorRefDto>;

/* ───────────────────────────── level table ───────────────────────────── */

/** The alliance level (06 §1.2): never goes down. Slots, pinned announcements and concurrent columns per member depend on it. */
export const AllianceLevelDto = z.object({
  level: z.number().int().min(1).max(10),
  /** Alliance XP (fits a JS number: ≤ 55 000 at level 10 plus whatever follows). */
  xp: z.number().int(),
  xpForCurrentLevel: z.number().int(),
  /** Null at the last level. */
  xpForNextLevel: z.number().int().nullable(),
  memberSlots: z.number().int(),
  deputySlots: z.number().int(),
  /** Pinned announcements allowed on the board (3, +1 at levels 4 and 8). */
  pinnedSlots: z.number().int(),
  /** Allied columns in flight per member (2; 3 from level 6). */
  concurrentColumns: z.number().int(),
});
export type AllianceLevelDto = z.infer<typeof AllianceLevelDto>;

/* ───────────────────────────── cards & members ───────────────────────────── */

/** Why the caller cannot join this alliance right now (`AllianceCardDto.viewer.blockedReason`); null = he can. */
export const AllianceJoinBlock = z.enum([
  'ALLIANCE_FULL', 'LEVEL_TOO_LOW', 'ALREADY_IN_ALLIANCE', 'ALLIANCE_COOLDOWN', 'INVITE_ONLY', 'BANNED', 'REQUEST_PENDING', 'NOT_ACTIVE', 'FEATURE_DISABLED',
]);
export type AllianceJoinBlock = z.infer<typeof AllianceJoinBlock>;

/**
 * Public card of an alliance: the search list (`GET /alliances`), `GET /alliances/:allianceId`, invites, join requests,
 * ranking rows. Never member data beyond counts (08 §8).
 */
export const AllianceCardDto = z.object({
  id: publicId(IdPrefix.alliance),
  name: z.string(),
  tag: z.string(),
  emblem: AllianceEmblemDto,
  description: z.string(),
  language: SupportedLocale,
  joinPolicy: AllianceJoinPolicy,
  /** Minimum Director level asked by the alliance itself (null = none; the game's `joinLevel` always applies). */
  minLevel: z.number().int().nullable(),
  level: z.number().int(),
  members: z.number().int(),
  memberSlots: z.number().int(),
  status: AllianceStatus,
  /** Search lists sort by this, not by size (02 §5). */
  lastActivityAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  frame: AllianceFrame.nullable(),
  /** Caller's relation to this alliance (absent on admin rows). */
  viewer: z.object({
    canJoin: z.boolean(),
    /** With `REQUEST` policy `canJoin: true` means "can ask" (`JoinAllianceResult.outcome = REQUESTED`). */
    blockedReason: AllianceJoinBlock.nullable(),
    pendingRequestId: publicId(IdPrefix.allianceJoinRequest).nullable(),
    pendingInviteId: publicId(IdPrefix.allianceInvite).nullable(),
  }).optional(),
});
export type AllianceCardDto = z.infer<typeof AllianceCardDto>;

/** GET /alliances?q&language&joinPolicy&hasSlots&cursor&limit — sorted by recent activity. */
export const AllianceSearchQuery = z.object({
  /** Name or tag, 1–40 chars, case/accent-insensitive prefix match. */
  q: z.string().trim().min(1).max(40).optional(),
  language: SupportedLocale.optional(),
  joinPolicy: AllianceJoinPolicy.optional(),
  hasSlots: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type AllianceSearchQuery = z.infer<typeof AllianceSearchQuery>;

/** One ACTIVE member as his allies see him (02 §6: no fleet, no facilities, no credits, no positions). */
export const AllianceMemberDto = z.object({
  id: publicId(IdPrefix.allianceMember),
  careerId: publicId(IdPrefix.career),
  directorName: z.string(),
  role: AllianceMemberRole,
  status: AllianceMemberStatus,
  level: z.number().int(),
  /** Municipality of the career's control centre (never the person's residence). */
  locationName: z.string(),
  /** Services the career runs. */
  families: z.array(ServiceFamily),
  joinedAt: IsoDateTime.nullable(),
  /** Null when the member hides his state or the viewer is not an ally (`AWAY` is what the UI shows then). */
  presence: AlliancePresence.nullable(),
  lastSeen: AllianceLastSeen.nullable(),
  /** 30 days without activity: flagged to the high roles, never removed automatically (02 §7). */
  inactive: z.boolean(),
  /** Alliance mute set by a high role (platform mutes are the member's own business). */
  mutedUntil: IsoDateTime.nullable(),
  aid: z.object({ given: z.number().int(), received: z.number().int() }),
  /** Operational points this week (06 §3.2), for the ranking contribution list. */
  weeklyPoints: z.number().int(),
  /** The viewer has blocked this Director (his texts are hidden: `hiddenByBlock`). */
  blocked: z.boolean(),
});
export type AllianceMemberDto = z.infer<typeof AllianceMemberDto>;

/** GET /careers/:careerId/alliance/members[?status=ACTIVE|BANNED] (BANNED: high roles only). */
export const AllianceMembersQuery = z.object({ status: z.enum(['ACTIVE', 'BANNED']).optional() });

/* ───────────────────────────── settings, log ───────────────────────────── */

export const AllianceSettingsDto = z.object({
  joinPolicy: AllianceJoinPolicy,
  minLevel: z.number().int().nullable(),
  language: SupportedLocale,
  description: z.string(),
  /** Members (not only high roles) may create invite links / direct invites (02 §3 "se l'alleanza lo consente ai membri"). */
  membersCanInvite: z.boolean(),
  /** Board notes reserved to DEPUTY / COORDINATOR (03 §2.1); announcements always are. */
  notesByHighRolesOnly: z.boolean(),
});
export type AllianceSettingsDto = z.infer<typeof AllianceSettingsDto>;

/** Every action of a high role, of the system and of the administration (02 §3). Labels `alliance.log.<ACTION>`. */
export const AllianceLogAction = z.enum([
  'FOUNDED', 'SETTINGS_CHANGED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'MEMBER_BANNED', 'MEMBER_INVITED', 'INVITE_REVOKED',
  'REQUEST_ACCEPTED', 'REQUEST_REJECTED', 'ROLE_CHANGED', 'MEMBER_MUTED', 'MEMBER_UNMUTED', 'LEADERSHIP_TRANSFERRED', 'LEADERSHIP_SUCCEEDED',
  'DISBAND_SCHEDULED', 'DISBAND_CANCELLED', 'DISBANDED', 'CLOSED_BY_ADMIN', 'READ_ONLY_CHANGED', 'POST_REMOVED', 'REPLY_REMOVED', 'MESSAGE_REMOVED',
  'LEVEL_UP', 'OPERATION_STARTED', 'OPERATION_ENDED',
]);
export type AllianceLogAction = z.infer<typeof AllianceLogAction>;
export const AllianceLogEntryDto = z.object({
  id: z.string(),
  at: IsoDateTime,
  action: AllianceLogAction,
  /** Null = the system or the administration (`byAdmin`). */
  actor: AllianceDirectorRefDto.nullable(),
  target: AllianceDirectorRefDto.nullable(),
  byAdmin: z.boolean(),
  /** Structured detail (e.g. `{ role: 'DEPUTY' }`, `{ duration: 'H24' }`, `{ field: 'name' }`), never free text of other players. */
  details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AllianceLogEntryDto = z.infer<typeof AllianceLogEntryDto>;
/** GET /careers/:careerId/alliance/log?cursor&limit (high roles). */
export const AllianceLogQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

/* ───────────────────────────── my alliance ───────────────────────────── */

/** `GET /careers/:careerId/alliance` → `AllianceHomeDto.alliance`: the member's full view of his own alliance. */
export const MyAllianceDto = AllianceCardDto.extend({
  settings: AllianceSettingsDto,
  progress: AllianceLevelDto,
  coordinator: AllianceDirectorRefDto,
  deputies: z.number().int(),
  me: z.object({
    memberId: publicId(IdPrefix.allianceMember),
    role: AllianceMemberRole,
    joinedAt: IsoDateTime,
    /** Alliance mute (high role) — platform mute / suspension are in `AllianceHomeDto.restrictions`. */
    mutedUntil: IsoDateTime.nullable(),
    canInvite: z.boolean(),
    /** Role ≥ DEPUTY: may decide join requests, pin, remove others' texts, mute, remove. */
    isHighRole: z.boolean(),
  }),
  /** Set while `DISBANDING`: the instant the alliance dissolves (48 h notice, cancellable by the Coordinator). */
  disbandAt: IsoDateTime.nullable(),
  /** Effective read-only state: admin per-alliance switch OR global config (`config.alliances.readOnly.*`). */
  readOnly: z.object({ board: z.boolean(), chat: z.boolean() }),
  /** Pending join requests waiting for a high role (0 for members). */
  pendingJoinRequests: z.number().int(),
  counts: z.object({ members: z.number().int(), onDuty: z.number().int(), online: z.number().int(), inactive: z.number().int() }),
  unread: z.object({ board: z.number().int(), chat: z.number().int() }),
  /** The running alliance operation (ALERT or ACTIVE), if any — `GET …/alliance/operation` for the board. */
  operationId: publicId(IdPrefix.allianceOperation).nullable(),
  /** Current week's ranking position (null = not ranked yet / ranking off). */
  weeklyRank: z.number().int().nullable(),
  /** The general chat channel (always exists). */
  generalChannelId: publicId(IdPrefix.allianceChannel),
});
export type MyAllianceDto = z.infer<typeof MyAllianceDto>;

/* ───────────────────────────── invites & join requests ───────────────────────────── */

export const AllianceInviteStatus = z.enum(['ACTIVE', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED']);
export type AllianceInviteStatus = z.infer<typeof AllianceInviteStatus>;
/**
 * An invite of MY alliance (created by me or, for high roles, by anyone). Link invites carry a `code`
 * (`/invite/alliance/<code>` on the landing/app, `GET /public/alliance-invite/:code`); direct invites a `target`. 7 days.
 */
export const AllianceInviteDto = z.object({
  id: publicId(IdPrefix.allianceInvite),
  /** Null for a direct invite. */
  code: z.string().nullable(),
  createdBy: AllianceDirectorRefDto,
  /** Null for a link invite. */
  target: AllianceDirectorRefDto.nullable(),
  status: AllianceInviteStatus,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  /** Link invites: how many Directors joined through it (unlimited uses until it expires or is revoked). */
  uses: z.number().int(),
});
export type AllianceInviteDto = z.infer<typeof AllianceInviteDto>;
/** An invite addressed to ME, pending (`AllianceHomeDto.invites`). */
export const AllianceInviteReceivedDto = z.object({
  id: publicId(IdPrefix.allianceInvite),
  alliance: AllianceCardDto,
  invitedBy: AllianceDirectorRefDto,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type AllianceInviteReceivedDto = z.infer<typeof AllianceInviteReceivedDto>;
/** ★POST /careers/:careerId/alliance/invites — no `targetCareerId` = link invite with a code. */
export const CreateAllianceInviteBody = z.object({ targetCareerId: publicId(IdPrefix.career).optional() });
export type CreateAllianceInviteBody = z.infer<typeof CreateAllianceInviteBody>;
/** GET /public/alliance-invite/:code — always 200; unknown / expired code → `valid: false`, `alliance: null`. */
export const PublicAllianceInviteDto = z.object({
  valid: z.boolean(),
  alliance: z.object({
    id: publicId(IdPrefix.alliance), name: z.string(), tag: z.string(), emblem: AllianceEmblemDto, level: z.number().int(),
    members: z.number().int(), memberSlots: z.number().int(), language: SupportedLocale, description: z.string(),
  }).nullable(),
  invitedBy: z.string().nullable(),
  expiresAt: IsoDateTime.nullable(),
});
export type PublicAllianceInviteDto = z.infer<typeof PublicAllianceInviteDto>;

export const AllianceJoinRequestStatus = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN']);
export type AllianceJoinRequestStatus = z.infer<typeof AllianceJoinRequestStatus>;
/** A join request as the high roles see it (no free text: nothing to moderate). 7 days. */
export const AllianceJoinRequestDto = z.object({
  id: publicId(IdPrefix.allianceJoinRequest),
  careerId: publicId(IdPrefix.career),
  directorName: z.string(),
  level: z.number().int(),
  locationName: z.string(),
  families: z.array(ServiceFamily),
  status: AllianceJoinRequestStatus,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  decidedBy: AllianceDirectorRefDto.nullable(),
  decidedAt: IsoDateTime.nullable(),
});
export type AllianceJoinRequestDto = z.infer<typeof AllianceJoinRequestDto>;
/** My own pending request (`AllianceHomeDto.joinRequests`). */
export const MyAllianceJoinRequestDto = z.object({
  id: publicId(IdPrefix.allianceJoinRequest),
  alliance: AllianceCardDto,
  status: AllianceJoinRequestStatus,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type MyAllianceJoinRequestDto = z.infer<typeof MyAllianceJoinRequestDto>;
/** ★POST /careers/:careerId/alliance/join-requests/:requestId/decide (high roles). */
export const DecideJoinRequestBody = z.object({ decision: z.enum(['ACCEPT', 'REJECT']) });
export type DecideJoinRequestBody = z.infer<typeof DecideJoinRequestBody>;

/* ───────────────────────────── commands ───────────────────────────── */

/** ★POST /careers/:careerId/alliance — found (level ≥ `foundLevel`, costs `foundCost`, founder becomes COORDINATOR). */
export const FoundAllianceBody = z.object({
  name: AllianceName,
  tag: AllianceTag,
  emblem: AllianceEmblemDto,
  description: AllianceDescription.optional(),
  language: SupportedLocale,
  joinPolicy: AllianceJoinPolicy,
  minLevel: z.number().int().min(1).max(99).nullable().optional(),
});
export type FoundAllianceBody = z.infer<typeof FoundAllianceBody>;

/**
 * ★POST /careers/:careerId/alliance/join — exactly one of: `allianceId` (OPEN → joined, REQUEST → request created, INVITE →
 * 403 `FORBIDDEN` `details.reason = INVITE_REQUIRED`), `inviteCode` (link), `inviteId` (a direct invite received).
 */
export const JoinAllianceBody = z.object({
  allianceId: publicId(IdPrefix.alliance).optional(),
  inviteCode: z.string().trim().min(4).max(64).optional(),
  inviteId: publicId(IdPrefix.allianceInvite).optional(),
}).refine((b) => [b.allianceId, b.inviteCode, b.inviteId].filter((v) => v !== undefined).length === 1, { message: 'exactly one of allianceId, inviteCode, inviteId' });
export type JoinAllianceBody = z.infer<typeof JoinAllianceBody>;
export const JoinAllianceResult = z.object({
  outcome: z.enum(['JOINED', 'REQUESTED']),
  /** Set when JOINED. */
  alliance: MyAllianceDto.nullable(),
  /** Set when REQUESTED. */
  joinRequest: MyAllianceJoinRequestDto.nullable(),
});
export type JoinAllianceResult = z.infer<typeof JoinAllianceResult>;

/** ★POST /careers/:careerId/alliance/leave → 24 h cooldown before joining another one (02 §4). */
export const LeaveAllianceResult = z.object({ cooldownUntil: IsoDateTime });
export type LeaveAllianceResult = z.infer<typeof LeaveAllianceResult>;

/** PATCH /careers/:careerId/alliance/settings (COORDINATOR). Name/tag changes: one per `nameChangeCooldownDays` (`NAME_CHANGE_COOLDOWN`). */
export const UpdateAllianceSettingsBody = z.object({
  name: AllianceName.optional(),
  tag: AllianceTag.optional(),
  emblem: AllianceEmblemDto.optional(),
  description: AllianceDescription.optional(),
  language: SupportedLocale.optional(),
  joinPolicy: AllianceJoinPolicy.optional(),
  minLevel: z.number().int().min(1).max(99).nullable().optional(),
  membersCanInvite: z.boolean().optional(),
  notesByHighRolesOnly: z.boolean().optional(),
});
export type UpdateAllianceSettingsBody = z.infer<typeof UpdateAllianceSettingsBody>;

/** ★POST …/alliance/members/:memberId/role (COORDINATOR): promote to DEPUTY (slots!) or demote to MEMBER. Coordinator hand-over is `/alliance/transfer`. */
export const SetMemberRoleBody = z.object({ role: z.enum(['DEPUTY', 'MEMBER']) });
export type SetMemberRoleBody = z.infer<typeof SetMemberRoleBody>;
/** ★POST …/alliance/members/:memberId/remove (high roles; a DEPUTY only by the COORDINATOR). `ban: true` → BANNED. */
export const RemoveMemberBody = z.object({ ban: z.boolean().optional() });
export type RemoveMemberBody = z.infer<typeof RemoveMemberBody>;
/** ★POST …/alliance/members/:memberId/mute (high roles; a DEPUTY only by the COORDINATOR). Unmute: ★POST …/unmute, no body. */
export const MuteMemberBody = z.object({ duration: AllianceMuteDuration });
export type MuteMemberBody = z.infer<typeof MuteMemberBody>;
/** ★POST …/alliance/transfer (COORDINATOR → an ACTIVE member; the old coordinator becomes DEPUTY if a slot is free, else MEMBER). */
export const TransferLeadershipBody = z.object({ memberId: publicId(IdPrefix.allianceMember) });
export type TransferLeadershipBody = z.infer<typeof TransferLeadershipBody>;

/* ───────────────────────────── home: the whole section in one call ───────────────────────────── */

/**
 * What the caller may do with free text right now (04 §2.1, 03 §6). `canWriteText` is the conjunction the server enforces on
 * every text write; `canUseQuick` stays true under an alliance mute (quick phrases / reactions carry no free text) and false
 * under a platform mute or a suspension.
 */
export const AllianceRestrictionsDto = z.object({
  /** Community rules accepted in their current version (`★POST /careers/:careerId/community-rules/accept`, moderation contract). */
  rulesAccepted: z.boolean(),
  level: z.number().int(),
  writeMinLevel: z.number().int(),
  accountAgeOk: z.boolean(),
  /** The later of alliance mute and platform mute; null = not muted. */
  mutedUntil: IsoDateTime.nullable(),
  muteScope: z.enum(['PLATFORM', 'ALLIANCE']).nullable(),
  suspended: z.boolean(),
  canWriteText: z.boolean(),
  canUseQuick: z.boolean(),
  /** Labels `alliance.restriction.<CODE>`; null when `canWriteText`. */
  writeBlockedReason: z.enum(['RULES_NOT_ACCEPTED', 'LEVEL_TOO_LOW', 'ACCOUNT_TOO_NEW', 'MUTED', 'SUSPENDED', 'READ_ONLY', 'FEATURE_DISABLED']).nullable(),
});
export type AllianceRestrictionsDto = z.infer<typeof AllianceRestrictionsDto>;

/** Which emblem codes a level unlocks (`minLevel` 1 = from the start). */
export const AllianceEmblemOptionDto = z.object({ code: z.string(), minLevel: z.number().int() });

/**
 * The public knobs of `config.alliances.*` and the flag states, so that the client (and its mock) never hard-codes a number
 * of the study. Every value here is a server config default taken from the study; it may change without a release.
 */
export const AllianceConfigDto = z.object({
  flags: z.object({
    alliances: z.boolean(), board: z.boolean(), chat: z.boolean(), aid: z.boolean(), objectives: z.boolean(), ranking: z.boolean(), operations: z.boolean(),
  }),
  /** Director level to found (5) and to browse/join (3); founding cost in credits (1000; 0 while alliances are few, A2). */
  foundLevel: z.number().int(),
  foundCost: Amount,
  joinLevel: z.number().int(),
  /** Text writes: level ≥ 2 and account ≥ 24 h (04 §2.1). */
  writeMinLevel: z.number().int(),
  accountMinAgeHours: z.number().int(),
  cooldownHours: z.number().int(),
  disbandNoticeHours: z.number().int(),
  successionDays: z.number().int(),
  inviteTtlDays: z.number().int(),
  requestTtlDays: z.number().int(),
  nameChangeCooldownDays: z.number().int(),
  inactiveAfterDays: z.number().int(),
  /** Levels 1…10 (06 §1.2). */
  levels: z.array(AllianceLevelDto),
  emblem: z.object({ shapes: z.array(AllianceEmblemOptionDto), symbols: z.array(AllianceEmblemOptionDto), colors: z.array(AllianceEmblemOptionDto) }),
  board: z.object({
    postMaxChars: z.number().int(), replyMaxChars: z.number().int(), postsPerDay: z.number().int(), repliesPerDay: z.number().int(),
    editWindowMinutes: z.number().int(), repliesPreview: z.number().int(), pageSize: z.number().int(),
  }),
  chat: z.object({
    messageMaxChars: z.number().int(), minSecondsBetween: z.number(), burst: z.number().int(), perMinute: z.number().int(),
    selfDeleteMinutes: z.number().int(), retentionDays: z.number().int(), pageSize: z.number().int(), maxMentions: z.number().int(),
  }),
  aid: z.object({
    maxOpenRequestsPerCareer: z.number().int(), minSecondsBetweenRequests: z.number().int(), maxVehiclesPerColumn: z.number().int(),
    maxVehiclesPerColumnMajor: z.number().int(), minEtaMinutes: z.number().int(), maxEtaMinutes: z.number().int(), maxStayMinutes: z.number().int(),
    rewardedPerDay: z.number().int(), fundShareIncident: z.number(), fundShareMajor: z.number(), minContributionShare: z.number(),
  }),
  /** Global read-only switches (config, not flags); the per-alliance ones are in `MyAllianceDto.readOnly`. */
  readOnly: z.object({ board: z.boolean(), chat: z.boolean() }),
});
export type AllianceConfigDto = z.infer<typeof AllianceConfigDto>;

/**
 * GET /careers/:careerId/alliance — the "Alleanza" section in one call. Flag `alliances` off → `alliance: null`, empty lists,
 * `config.flags.alliances: false` (never 404). Without an alliance: pending invites and requests, the cooldown, the knobs.
 */
export const AllianceHomeDto = z.object({
  alliance: MyAllianceDto.nullable(),
  invites: z.array(AllianceInviteReceivedDto),
  joinRequests: z.array(MyAllianceJoinRequestDto),
  /** Set after leaving / being removed: no join or founding before this instant (`ALLIANCE_COOLDOWN`). */
  cooldownUntil: IsoDateTime.nullable(),
  restrictions: AllianceRestrictionsDto,
  config: AllianceConfigDto,
});
export type AllianceHomeDto = z.infer<typeof AllianceHomeDto>;

/* ───────────────────────────── Director card & privacy (module `profiles`, 02 §6) ───────────────────────────── */

/** GET /directors/:careerId (bearer) — visible to every registered player; `presence`/`lastSeen` only to allies and only if allowed. */
export const DirectorCardDto = z.object({
  careerId: publicId(IdPrefix.career),
  directorName: z.string(),
  level: z.number().int(),
  locationName: z.string(),
  families: z.array(ServiceFamily),
  alliance: z.object({ id: publicId(IdPrefix.alliance), name: z.string(), tag: z.string(), emblem: AllianceEmblemDto, role: AllianceMemberRole }).nullable(),
  memberSince: IsoDateTime.nullable(),
  aid: z.object({ given: z.number().int(), received: z.number().int() }),
  /** Major-incident medals (trophies) — counts only. */
  medals: z.object({ gold: z.number().int(), silver: z.number().int(), bronze: z.number().int() }),
  presence: AlliancePresence.nullable(),
  lastSeen: AllianceLastSeen.nullable(),
  /** Reliability: useful allied columns delivered (05 §6.2 "un punto di affidabilità"). */
  reliability: z.number().int(),
  isMe: z.boolean(),
  isAlly: z.boolean(),
  /** The viewer blocked this Director (moderation contract: `★POST …/blocks`). */
  blocked: z.boolean(),
  /** Direct invites: false when the Director disabled them or blocked the viewer (the viewer is not told which). */
  canInvite: z.boolean(),
});
export type DirectorCardDto = z.infer<typeof DirectorCardDto>;

/** GET|PATCH /me/profile (bearer) — privacy of the Director card. */
export const ProfileSettingsDto = z.object({ showOnDuty: z.boolean(), acceptDirectInvites: z.boolean() });
export type ProfileSettingsDto = z.infer<typeof ProfileSettingsDto>;
export const UpdateProfileBody = ProfileSettingsDto.partial();
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>;

/* ───────────────────────────── snapshot & notifications ───────────────────────────── */

/** Additive `SyncSnapshot.alliance` (null = no alliance or flag off). Unread counters come from the read markers. */
export const AllianceSnapshotDto = z.object({
  id: publicId(IdPrefix.alliance),
  name: z.string(),
  tag: z.string(),
  role: AllianceMemberRole,
  unread: z.object({ chat: z.number().int(), board: z.number().int() }),
  operationId: publicId(IdPrefix.allianceOperation).nullable(),
});
export type AllianceSnapshotDto = z.infer<typeof AllianceSnapshotDto>;

/**
 * `NotificationDto.action` `{ kind: 'OPEN_ALLIANCE', targetId }` and `PushPayload.url` `/game/alliance?focus=<targetId>`:
 * a tab name, or `post:<alp_…>` · `aid:<aid_…>` · `operation:<aop_…>`.
 */
export const ALLIANCE_TABS = ['overview', 'board', 'chat', 'members', 'aid', 'ranking'] as const;
export type AllianceTab = (typeof ALLIANCE_TABS)[number];
export const AllianceNotificationTarget = z.string().regex(
  /^(overview|board|chat|members|aid|ranking|post:alp_[0-9A-HJKMNP-TV-Z]{26}|aid:aid_[0-9A-HJKMNP-TV-Z]{26}|operation:aop_[0-9A-HJKMNP-TV-Z]{26})$/,
);
export const allianceTarget = (tab: AllianceTab): string => tab;
export const alliancePostTarget = (postId: string): string => `post:${postId}`;
export const allianceAidTarget = (requestId: string): string => `aid:${requestId}`;
export const allianceOperationTarget = (operationId: string): string => `operation:${operationId}`;

/* ───────────────────────────── realtime: the alliance stream ───────────────────────────── */

/** Socket.IO namespace `/game` (same socket as the career stream), event name `alliance`, room `alliance:<all_…>`. */
export const ALLIANCE_SOCKET_EVENT = 'alliance';
export const allianceRoom = (allianceId: string): string => `alliance:${allianceId}`;

/**
 * Payloads (full DTOs, like the career stream):
 * `alliance.updated` {alliance: MyAllianceDto} · `alliance.member.updated` {member: AllianceMemberDto, change: JOINED|LEFT|REMOVED|
 * BANNED|ROLE|MUTED|UNMUTED|UPDATED} · `alliance.post.created|updated` {post: AlliancePostDto} · `alliance.post.removed` {postId,
 * replyId?} · `alliance.message.created` {message: AllianceMessageDto} · `alliance.message.removed` {channelId, messageId} ·
 * `alliance.channel.updated` {channel: AllianceChannelDto} · `alliance.aid.updated` {request: AidRequestDto} ·
 * `alliance.column.updated` {column: AidColumnDto} · `alliance.objectives.updated` {objectives: AllianceObjectivesDto} ·
 * `alliance.ranking.updated` {ranking: AllianceRankingDto} · `alliance.operation.updated` {operation: AllianceOperationDto} ·
 * `alliance.presence.updated` {changes: [{careerId, presence}]} (throttled). An unknown type must be ignored (never a resync).
 */
export const AllianceRealtimeEventType = z.enum([
  'alliance.updated', 'alliance.member.updated',
  'alliance.post.created', 'alliance.post.updated', 'alliance.post.removed',
  'alliance.message.created', 'alliance.message.removed', 'alliance.channel.updated',
  'alliance.aid.updated', 'alliance.column.updated',
  'alliance.objectives.updated', 'alliance.ranking.updated', 'alliance.operation.updated',
  'alliance.presence.updated',
]);
export type AllianceRealtimeEventType = z.infer<typeof AllianceRealtimeEventType>;
export const AllianceRealtimeEnvelope = z.object({
  type: AllianceRealtimeEventType,
  v: z.literal(1),
  allianceId: publicId(IdPrefix.alliance),
  /** Per-alliance sequence (`alliance_event_sequences`). */
  seq: z.number().int(),
  occurredAt: IsoDateTime,
  serverTime: IsoDateTime,
  payload: z.record(z.unknown()),
});
export type AllianceRealtimeEnvelope = z.infer<typeof AllianceRealtimeEnvelope>;
/**
 * GET /careers/:careerId/alliance/sync[?since=<seq>] → the missed alliance events, or `resyncRequired` when the gap cannot be
 * replayed (then re-fetch home, board, chat, aid, operation). Without `since`: `{ seq, events: [], resyncRequired: false }`.
 * No alliance / flag off: `{ seq: 0, events: [], resyncRequired: false }`.
 */
export const AllianceSyncDelta = z.object({
  seq: z.number().int(),
  events: z.array(AllianceRealtimeEnvelope),
  resyncRequired: z.boolean(),
});
export type AllianceSyncDelta = z.infer<typeof AllianceSyncDelta>;
export const AllianceSyncQuery = z.object({ since: z.coerce.number().int().min(0).optional() });

/* ───────────────────────────── admin (`/api/v1/admin/alliances`) ───────────────────────────── */

const AdminAllianceReason = z.string().trim().min(5).max(500);
/** GET /admin/alliances[?q&status&limit] (SUPPORT). */
export const AdminAllianceRow = AllianceCardDto.omit({ viewer: true }).extend({
  coordinator: AllianceDirectorRefDto,
  readOnly: z.object({ board: z.boolean(), chat: z.boolean() }),
  openReports: z.number().int(),
  disbandAt: IsoDateTime.nullable(),
  closedAt: IsoDateTime.nullable(),
});
export type AdminAllianceRow = z.infer<typeof AdminAllianceRow>;
export const AdminAlliancesQuery = z.object({
  q: z.string().trim().max(40).optional(), status: AllianceStatus.optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
});
/** GET /admin/alliances/:allianceId (SUPPORT). `operation` is an `AllianceOperationDto` (alliance-operations.ts) or null. */
export const AdminAllianceDetail = z.object({
  alliance: AdminAllianceRow,
  settings: AllianceSettingsDto,
  progress: AllianceLevelDto,
  members: z.array(AllianceMemberDto),
  /** Latest 100 log entries. */
  log: z.array(AllianceLogEntryDto),
  operation: z.record(z.unknown()).nullable(),
});
export type AdminAllianceDetail = z.infer<typeof AdminAllianceDetail>;
/** ★POST /admin/alliances/:allianceId/close (GAME_ADMIN) → status CLOSED, every member LEFT with no cooldown, texts kept for moderation. */
export const AdminCloseAllianceBody = z.object({ reason: AdminAllianceReason });
export type AdminCloseAllianceBody = z.infer<typeof AdminCloseAllianceBody>;
/** ★POST /admin/alliances/:allianceId/read-only (GAME_ADMIN) — omitted fields keep their value (columns `alliances.read_only_board|chat`). */
export const AdminAllianceReadOnlyBody = z.object({ readOnlyBoard: z.boolean().optional(), readOnlyChat: z.boolean().optional(), reason: AdminAllianceReason });
export type AdminAllianceReadOnlyBody = z.infer<typeof AdminAllianceReadOnlyBody>;
