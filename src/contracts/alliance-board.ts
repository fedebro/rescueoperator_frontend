import { z } from 'zod';
import { I18nText, IdPrefix, IsoDateTime, publicId } from './common';
import { AllianceDirectorRefDto, AllianceMemberRole } from './alliances';

/**
 * Alliance board ("Bacheca") — D-103/D-113/D-114, study 03 §2, 08 §3.2. Flag `alliance_board`.
 *
 * Slow-paced texts that stay as long as the alliance exists: NOTE (every member, or high roles only when the alliance says so),
 * ANNOUNCEMENT (high roles; pinnable, notifies the members), SYSTEM (the game: structured and translated for the reader).
 * One level of replies; four fixed reactions (structured: no moderation, translated). Every free text goes through the text
 * filter on the server (REJECT → 422 `TEXT_REJECTED` with `details.reason`; MASK → stored masked; FLAG → stored + queued).
 *
 * Writing needs: ACTIVE member, flag on, alliance not read-only (`MyAllianceDto.readOnly.board`), community rules accepted
 * (403 `RULES_NOT_ACCEPTED`), Director level ≥ 2, account ≥ 24 h, not muted (403 `MUTED` `details.until`), not suspended.
 * Limits (config defaults): posts 1 000 chars, replies 500, 5 posts + 30 replies per member per day (429 `RATE_LIMITED`
 * `details.reason = DAILY_LIMIT`), edit window 15 min (409 `CONFLICT` `details.reason = EDIT_WINDOW_EXPIRED`), 3 pinned
 * (+1 at alliance levels 4 and 8; 409 `CONFLICT` `details.reason = PIN_LIMIT`).
 */

export const AlliancePostKind = z.enum(['NOTE', 'ANNOUNCEMENT', 'SYSTEM']);
export type AlliancePostKind = z.infer<typeof AlliancePostKind>;
/** Ricevuto · Ben fatto · Presente · Grazie — labels `alliance.reaction.<CODE>`. */
export const AllianceReaction = z.enum(['ACK', 'WELL_DONE', 'PRESENT', 'THANKS']);
export type AllianceReaction = z.infer<typeof AllianceReaction>;
/** System posts (03 §2.1). Text = `AlliancePostDto.system` (`alliance.post.system.<CODE>` with params). */
export const AllianceSystemPostCode = z.enum([
  'MEMBER_JOINED', 'MEMBER_LEFT', 'LEVEL_UP', 'WEEKLY_OBJECTIVES', 'OBJECTIVE_COMPLETED', 'NOTABLE_AID', 'OPERATION_ENDED',
  'RANKING_RESULT', 'DISBAND_SCHEDULED', 'DISBAND_CANCELLED', 'LEADERSHIP_CHANGED',
]);
export type AllianceSystemPostCode = z.infer<typeof AllianceSystemPostCode>;

export const ALLIANCE_POST_MAX = 1000;
export const ALLIANCE_REPLY_MAX = 500;

/** Author of a post / reply / message: role at the time of reading (null once he left), name null once the account is deleted. */
export const AllianceAuthorDto = AllianceDirectorRefDto.extend({ role: AllianceMemberRole.nullable() });
export type AllianceAuthorDto = z.infer<typeof AllianceAuthorDto>;

export const AlliancePostReplyDto = z.object({
  id: publicId(IdPrefix.alliancePostReply),
  postId: publicId(IdPrefix.alliancePost),
  author: AllianceAuthorDto,
  /** Null when `removed`, `hidden` or `hiddenByBlock` (the client shows the matching placeholder). */
  text: z.string().nullable(),
  createdAt: IsoDateTime,
  editedAt: IsoDateTime.nullable(),
  /** Removed by the author or a high role ("Risposta rimossa"). */
  removed: z.boolean(),
  /** Auto-hidden pending moderation (3 distinct reports, or a severe filter hit). */
  hidden: z.boolean(),
  /** The viewer blocked the author ("Messaggio di un utente bloccato"). */
  hiddenByBlock: z.boolean(),
  mine: z.boolean(),
});
export type AlliancePostReplyDto = z.infer<typeof AlliancePostReplyDto>;

export const AlliancePostReactionDto = z.object({ reaction: AllianceReaction, count: z.number().int(), mine: z.boolean() });

export const AlliancePostDto = z.object({
  id: publicId(IdPrefix.alliancePost),
  kind: AlliancePostKind,
  /** Null for SYSTEM posts. */
  author: AllianceAuthorDto.nullable(),
  /** NOTE / ANNOUNCEMENT text; null when removed/hidden/hiddenByBlock and for SYSTEM posts. */
  text: z.string().nullable(),
  /** SYSTEM posts: the translatable text. */
  system: z.object({ code: AllianceSystemPostCode, text: I18nText }).nullable(),
  pinned: z.boolean(),
  pinnedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  editedAt: IsoDateTime.nullable(),
  /** Until when the author may still edit (15 min); null = no more. */
  editableUntil: IsoDateTime.nullable(),
  removed: z.boolean(),
  hidden: z.boolean(),
  hiddenByBlock: z.boolean(),
  mine: z.boolean(),
  /** Every reaction code, in `AllianceReaction` order, count may be 0. */
  reactions: z.array(AlliancePostReactionDto),
  replyCount: z.number().int(),
  /** The most recent replies (config `board.repliesPreview`, 3), oldest first; `GET …/posts/:postId/replies` for the rest. */
  replies: z.array(AlliancePostReplyDto),
});
export type AlliancePostDto = z.infer<typeof AlliancePostDto>;

/** GET /careers/:careerId/alliance/posts?cursor&limit&kind — pinned announcements first (newest pin first), then newest first. */
export const AllianceBoardQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  kind: AlliancePostKind.optional(),
});
export type AllianceBoardQuery = z.infer<typeof AllianceBoardQuery>;
/** GET /careers/:careerId/alliance/posts/:postId/replies?cursor&limit — oldest first. */
export const AllianceRepliesQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

/** ★POST /careers/:careerId/alliance/posts (201). ANNOUNCEMENT: high roles; `pin` only on announcements. */
export const CreateAlliancePostBody = z.object({
  kind: z.enum(['NOTE', 'ANNOUNCEMENT']),
  text: z.string().trim().min(1).max(ALLIANCE_POST_MAX),
  pin: z.boolean().optional(),
});
export type CreateAlliancePostBody = z.infer<typeof CreateAlliancePostBody>;
/** PATCH /careers/:careerId/alliance/posts/:postId — own post, within the edit window (sets `editedAt`). */
export const UpdateAlliancePostBody = z.object({ text: z.string().trim().min(1).max(ALLIANCE_POST_MAX) });
export type UpdateAlliancePostBody = z.infer<typeof UpdateAlliancePostBody>;
/** ★POST /careers/:careerId/alliance/posts/:postId/replies (201). */
export const CreateAllianceReplyBody = z.object({ text: z.string().trim().min(1).max(ALLIANCE_REPLY_MAX) });
export type CreateAllianceReplyBody = z.infer<typeof CreateAllianceReplyBody>;
/** ★POST /careers/:careerId/alliance/posts/:postId/reactions — one reaction per member and post; `null` removes mine. */
export const ReactToPostBody = z.object({ reaction: AllianceReaction.nullable() });
export type ReactToPostBody = z.infer<typeof ReactToPostBody>;
/** ★POST /careers/:careerId/alliance/posts/:postId/pin (high roles, announcements only). */
export const PinPostBody = z.object({ pinned: z.boolean() });
export type PinPostBody = z.infer<typeof PinPostBody>;

/** Unread counters after a read marker update (★POST …/alliance/board/read · ★POST …/alliance/channels/:channelId/read). */
export const AllianceUnreadDto = z.object({ board: z.number().int(), chat: z.number().int() });
export type AllianceUnreadDto = z.infer<typeof AllianceUnreadDto>;
