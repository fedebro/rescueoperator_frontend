/**
 * Web push notifications — D-97…D-99, analisi/studio-2026-09-28-notifiche-push.md §5 (analisi/note-agenti/push-backend.md).
 * Standard Web Push (RFC 8030 / 8291 aes128gcm / 8292 VAPID): the server signs and encrypts, the browsers' push services deliver.
 * Additive within v1: new routes, new shapes, one new id prefix (`psb`), one client → server socket event (`presence`).
 */
import { z } from 'zod';
import { IdPrefix, publicId } from './common';

/**
 * What a push can be about (D-97). Every category is on by default except ECONOMY.
 * Clients should parse unknown codes gracefully (new categories may be added within v1).
 */
export const PushCategory = z.enum([
  'INCIDENT_NEW', 'INCIDENT_EXPIRING', 'INCIDENT_CLOSED', 'MAJOR', 'PATIENT', 'FLEET', 'MANAGEMENT', 'PROGRESSION', 'ECONOMY',
]);
export type PushCategory = z.infer<typeof PushCategory>;

/** GET /push/config (bearer) — `enabled: false` + `vapidPublicKey: null` when the server has no VAPID keys (or the kill switch is off). */
export const PushConfigDto = z.object({
  enabled: z.boolean(),
  /** Application server key for `pushManager.subscribe({ applicationServerKey })`: base64url, 65-byte uncompressed P-256 point. */
  vapidPublicKey: z.string().nullable(),
  categories: z.array(z.object({ code: PushCategory, defaultEnabled: z.boolean() })),
});
export type PushConfigDto = z.infer<typeof PushConfigDto>;

export const PushPlatform = z.enum(['BROWSER', 'PWA']);
export type PushPlatform = z.infer<typeof PushPlatform>;

/**
 * ★POST /careers/:careerId/push/subscriptions — `PushSubscription.toJSON()` + platform. Upsert by endpoint (the browser owns the
 * endpoint: a subscription registered by another account on the same browser moves to the caller). → 201 `PushSubscriptionResult`.
 * Server-side validation (400 VALIDATION_ERROR, `details.reason`): `ENDPOINT_NOT_ALLOWED` (https only; in production the host must
 * be a known push service), `INVALID_KEYS` (p256dh = 65-byte uncompressed P-256 point, auth = 16 bytes, base64url).
 * 403 FEATURE_DISABLED when push is disabled on the server.
 */
export const PushSubscriptionBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(80).max(128), auth: z.string().min(16).max(64) }),
  /** `PushSubscription.expirationTime`: epoch milliseconds or null. */
  expirationTime: z.number().nullable().optional(),
  platform: PushPlatform,
  /** Stored truncated to 255 characters (shown to the player to tell devices apart). */
  userAgent: z.string().max(1024).optional(),
});
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBody>;
export const PushSubscriptionResult = z.object({ id: publicId(IdPrefix.pushSubscription) });

/** DELETE /careers/:careerId/push/subscriptions — always 204 (also when unknown or not the caller's). */
export const PushUnsubscribeBody = z.object({ endpoint: z.string().min(1).max(2048) });

/** 'HH:MM', 24 h. */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
/**
 * Quiet hours: no push inside [start, end) in `timeZone` (IANA, e.g. "Europe/Rome"); a window may cross midnight (23:00 → 07:00).
 * `start` must differ from `end` when enabled. Default: disabled, 23:00 → 07:00, Europe/Rome.
 */
export const QuietHoursDto = z.object({ enabled: z.boolean(), start: ClockTime, end: ClockTime, timeZone: z.string().min(1).max(64) });
export type QuietHoursDto = z.infer<typeof QuietHoursDto>;

export const PushCategoryPreference = z.object({ code: PushCategory, enabled: z.boolean() });
/** GET|PUT /careers/:careerId/push/preferences — every category, in `PushCategory` order. */
export const PushPreferencesDto = z.object({ categories: z.array(PushCategoryPreference), quietHours: QuietHoursDto });
export type PushPreferencesDto = z.infer<typeof PushPreferencesDto>;
/** PUT body: the full `PushPreferencesDto` (usual), or any part of it — a missing category / `quietHours` keeps its value. */
export const PushPreferencesBody = z.object({ categories: z.array(PushCategoryPreference).max(20).optional(), quietHours: QuietHoursDto.optional() });

/** POST /careers/:careerId/push/test → 202: a test push to the caller's own subscriptions of this career, ignoring presence, quiet hours and preferences. */
export const PushTestResult = z.object({ sent: z.number().int().nonnegative() });

/**
 * POST /auth/logout (additive body, see auth.ts `LogoutBody`): `{ pushEndpoint }` also deletes that endpoint's subscription of the
 * session's user — works even when the access token has expired (the refresh cookie identifies the user).
 */

/* ───────────── realtime: client → server ───────────── */

/**
 * Socket.IO namespace `/game`: the client emits `presence` `{ visible }` on every (re)connect and on every `visibilitychange`.
 * A user with at least one visible game client never receives a push (D-97). A socket that never sent it counts as not visible.
 */
export const SOCKET_PRESENCE_EVENT = 'presence';
export const PresenceEventBody = z.object({ visible: z.boolean() });

/* ───────────── the push message (encrypted, read by the service worker) ───────────── */

export const PUSH_FOCUS_KINDS = ['incident', 'major', 'vehicle', 'facility'] as const;
export type PushFocusKind = (typeof PUSH_FOCUS_KINDS)[number];
/** Deep links carried by `PushPayload.url` (same-origin relative paths): `/game?focus=<kind>:<publicId>`, or `/game`. */
export const pushFocusUrl = (kind: PushFocusKind, id: string): string => `/game?focus=${kind}:${id}`;
export const PUSH_HOME_URL = '/game';

/**
 * Plaintext of every push (UTF-8 JSON, ≤ ~3.9 KB). Texts are already localized in the player's `users.locale`.
 * `tag` is always set: a newer push with the same tag replaces the older one on the device (`renotify: true` re-alerts).
 * `timestamp` = epoch milliseconds of the event. `category` is `TEST` for the "Invia notifica di prova" push.
 */
export const PushPayload = z.object({
  v: z.literal(1),
  category: z.union([PushCategory, z.literal('TEST')]),
  title: z.string(),
  body: z.string(),
  tag: z.string(),
  url: z.string(),
  requireInteraction: z.boolean().optional(),
  renotify: z.boolean().optional(),
  timestamp: z.number().int(),
});
export type PushPayload = z.infer<typeof PushPayload>;
