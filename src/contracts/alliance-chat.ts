import { z } from 'zod';
import { I18nText, IdPrefix, IsoDateTime, publicId } from './common';
import { AlliancePresence } from './alliances';
import { AllianceAuthorDto } from './alliance-board';

/**
 * Alliance chat — D-103/D-113/D-114/D-115, study 03 §3–4, 08 §3.2, §5. Flag `alliance_chat`.
 *
 * Channels: one GENERAL per alliance; one OPERATION per alliance operation (archived when it ends). No private messages, no
 * topic channels, text only (no images, links, phone numbers, e-mails, social handles: the filter rejects them).
 * Messages: TEXT (≤ 500 chars, free text through the filter) or QUICK (a structured quick phrase, translated for the reader,
 * never moderated, allowed under an alliance mute). No edit; the author may delete his own message within 5 min
 * ("Messaggio rimosso"), high roles anytime. History: 90 days, pages of 50 newest-first (`meta.nextCursor` → older).
 * Rate limits (config defaults): 1 message / 2 s with a burst of 5, 30 / min (429 `RATE_LIMITED`), an identical text repeated
 * within the window is refused (409 `CONFLICT` `details.reason = DUPLICATE_MESSAGE`).
 * Same write preconditions as the board (`AllianceRestrictionsDto`); `MyAllianceDto.readOnly.chat` → text refused, QUICK allowed.
 *
 * Aid requests are not messages: the client merges the OPEN `AidRequestDto` cards (alliance-aid.ts, `alliance.aid.updated`)
 * into the GENERAL channel by time. Realtime: `alliance.message.created` {message}, `alliance.message.removed`
 * {channelId, messageId}, `alliance.channel.updated` {channel}, `alliance.presence.updated` {changes}.
 */

export const AllianceChannelKind = z.enum(['GENERAL', 'OPERATION']);
export type AllianceChannelKind = z.infer<typeof AllianceChannelKind>;
export const AllianceMessageKind = z.enum(['TEXT', 'QUICK']);
export type AllianceMessageKind = z.infer<typeof AllianceMessageKind>;

/**
 * Quick phrases (03 §3.3), translated for the reader: catalog key `alliance.quick.<CODE>` (`GET /public/i18n/catalog/:locale`).
 * Groups: request (NEED_*), answer (COMING … RETURNING), status (ON_DUTY … ALL_CLEAR), courtesy (THANKS, WELL_DONE, GOOD_SHIFT).
 */
export const AllianceQuickCode = z.enum([
  'NEED_FIRE_ENGINE', 'NEED_ADVANCED_AMBULANCE', 'NEED_PATROL', 'NEED_WILDFIRE_UNIT', 'NEED_ALPINE_RESCUE', 'NEED_BOAT',
  'COMING', 'CANNOT_NOW', 'COLUMN_SENT', 'ON_SCENE', 'RETURNING',
  'ON_DUTY', 'OFF_DUTY', 'UNDER_PRESSURE', 'ALL_CLEAR',
  'THANKS', 'WELL_DONE', 'GOOD_SHIFT',
]);
export type AllianceQuickCode = z.infer<typeof AllianceQuickCode>;
export const ALLIANCE_QUICK_GROUPS: Readonly<Record<'REQUEST' | 'ANSWER' | 'STATUS' | 'COURTESY', readonly AllianceQuickCode[]>> = {
  REQUEST: ['NEED_FIRE_ENGINE', 'NEED_ADVANCED_AMBULANCE', 'NEED_PATROL', 'NEED_WILDFIRE_UNIT', 'NEED_ALPINE_RESCUE', 'NEED_BOAT'],
  ANSWER: ['COMING', 'CANNOT_NOW', 'COLUMN_SENT', 'ON_SCENE', 'RETURNING'],
  STATUS: ['ON_DUTY', 'OFF_DUTY', 'UNDER_PRESSURE', 'ALL_CLEAR'],
  COURTESY: ['THANKS', 'WELL_DONE', 'GOOD_SHIFT'],
};

export const ALLIANCE_MESSAGE_MAX = 500;
export const ALLIANCE_MAX_MENTIONS = 5;

export const AllianceChannelDto = z.object({
  id: publicId(IdPrefix.allianceChannel),
  kind: AllianceChannelKind,
  /** `alliance.channel.GENERAL`, or the operation's title. */
  name: I18nText,
  operationId: publicId(IdPrefix.allianceOperation).nullable(),
  /** OPERATION channels: read-only once the operation ended (kept 90 days like every message). */
  archived: z.boolean(),
  createdAt: IsoDateTime,
  lastMessageAt: IsoDateTime.nullable(),
  /** Messages after the viewer's read marker. */
  unread: z.number().int(),
});
export type AllianceChannelDto = z.infer<typeof AllianceChannelDto>;

export const AllianceMentionDto = z.object({ careerId: publicId(IdPrefix.career), directorName: z.string() });

export const AllianceMessageDto = z.object({
  id: publicId(IdPrefix.allianceMessage),
  channelId: publicId(IdPrefix.allianceChannel),
  kind: AllianceMessageKind,
  author: AllianceAuthorDto,
  /** TEXT: the (possibly masked) text; null when removed / hidden / hiddenByBlock, and for QUICK. */
  text: z.string().nullable(),
  /** QUICK: the phrase; the client renders `alliance.quick.<code>` with `params`. */
  quick: z.object({ code: AllianceQuickCode, params: z.record(z.union([z.string(), z.number()])) }).nullable(),
  /** Directors named with `@` (03 §3.2); each one got a notification (+ push `ALLIANCE_SOCIAL`). */
  mentions: z.array(AllianceMentionDto),
  createdAt: IsoDateTime,
  /** "Messaggio rimosso" (author within 5 min, or a high role). */
  removed: z.boolean(),
  /** Auto-hidden pending moderation. */
  hidden: z.boolean(),
  /** The viewer blocked the author ("Messaggio di un utente bloccato"); the author is not told. */
  hiddenByBlock: z.boolean(),
  mine: z.boolean(),
  /** Until when the author may still delete it (5 min); null = no more / not mine. */
  deletableUntil: IsoDateTime.nullable(),
});
export type AllianceMessageDto = z.infer<typeof AllianceMessageDto>;

/** GET /careers/:careerId/alliance/channels/:channelId/messages?cursor&limit — newest first; `meta.nextCursor` pages towards older. */
export const AllianceMessagesQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).optional() });
export type AllianceMessagesQuery = z.infer<typeof AllianceMessagesQuery>;

/**
 * ★POST /careers/:careerId/alliance/channels/:channelId/messages (201). TEXT: `mentions` lists the careers named in the text
 * (members of the alliance, ≤ 5; unknown ones are dropped). QUICK: `params` as the phrase needs (none today).
 */
export const SendAllianceMessageBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TEXT'),
    text: z.string().trim().min(1).max(ALLIANCE_MESSAGE_MAX),
    mentions: z.array(publicId(IdPrefix.career)).max(ALLIANCE_MAX_MENTIONS).optional(),
  }),
  z.object({
    kind: z.literal('QUICK'),
    code: AllianceQuickCode,
    params: z.record(z.union([z.string(), z.number()])).optional(),
  }),
]);
export type SendAllianceMessageBody = z.infer<typeof SendAllianceMessageBody>;

/** ★POST /careers/:careerId/alliance/channels/:channelId/read — marks up to `lastReadMessageId` (default: the latest) as read. */
export const MarkChannelReadBody = z.object({ lastReadMessageId: publicId(IdPrefix.allianceMessage).optional() });
export type MarkChannelReadBody = z.infer<typeof MarkChannelReadBody>;

/** `alliance.presence.updated` payload item; also GET /careers/:careerId/alliance/presence → `AlliancePresenceDto[]`. */
export const AlliancePresenceDto = z.object({ careerId: publicId(IdPrefix.career), presence: AlliancePresence });
export type AlliancePresenceDto = z.infer<typeof AlliancePresenceDto>;
