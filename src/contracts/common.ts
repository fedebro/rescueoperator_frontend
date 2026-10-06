import { z } from 'zod';

/** Public ids are prefixed ULIDs, e.g. "inc_01J8Z…". */
export const publicId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`), `expected ${prefix}_<ULID>`);

export const IdPrefix = {
  user: 'usr',
  career: 'car',
  facility: 'fac',
  vehicle: 'veh',
  personnel: 'per',
  team: 'tem',
  department: 'dep',
  incident: 'inc',
  dispatch: 'dsp',
  dispatchVehicle: 'dsv',
  patient: 'pat',
  hospital: 'hos',
  site: 'sit',
  order: 'ord',
  purchase: 'pur',
  notification: 'ntf',
  candidate: 'cnd',
  maintenance: 'mnt',
  training: 'trn',
  /* major incidents (D-24/D-69) */
  majorIncident: 'mjr',
  majorReinforcement: 'rnf',
  /* web push (D-97…D-99) */
  pushSubscription: 'psb',
  /* alliances (D-102…D-123, analisi/brief-alleanze/00-regole-comuni.md §2) */
  alliance: 'all',
  allianceMember: 'alm',
  allianceInvite: 'ali',
  allianceJoinRequest: 'alj',
  alliancePost: 'alp',
  alliancePostReply: 'alr',
  allianceChannel: 'alc',
  allianceMessage: 'alx',
  aidRequest: 'aid',
  aidColumn: 'col',
  allianceOperation: 'aop',
  allianceObjective: 'aob',
  /* moderation (platform agent: moderation.ts / account.ts) */
  report: 'rep',
  sanction: 'san',
  block: 'blk',
} as const;

export const IsoDateTime = z.string().datetime({ offset: true });
/** Credits and XP travel as integer strings (BIGINT safe). */
export const Amount = z.string().regex(/^-?\d+$/);
export const LngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** GeoJSON LineString coordinates, [lng, lat][]. */
export const LineCoords = z.array(LngLat).min(2);

export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'MAINTENANCE_MODE',
  // auth
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_TOO_MANY_ATTEMPTS',
  'OTP_COOLDOWN',
  'DIRECTOR_NAME_REQUIRED',
  'DIRECTOR_NAME_INVALID',
  'SESSION_REVOKED',
  // career
  'CAREER_ALREADY_EXISTS',
  'LOCATION_NOT_PLAYABLE',
  'SITE_NOT_AVAILABLE',
  // economy
  'INSUFFICIENT_CREDITS',
  'LEVEL_TOO_LOW',
  'NOT_UNLOCKED',
  'PACKAGE_NOT_FOUND',
  'AD_LIMIT_REACHED',
  'AD_COOLDOWN',
  // operations
  'INCIDENT_NOT_DISPATCHABLE',
  'VEHICLE_NOT_AVAILABLE',
  'VEHICLE_NOT_RECALLABLE',
  'VEHICLE_NOT_CHAINABLE',
  /**
   * A WATER-domain vehicle (boat) sent to an incident that is not on the water, or a GROUND vehicle sent to a water incident
   * while it brings none of the shore-side capabilities the incident asks for (land units work at the meeting point).
   */
  'VEHICLE_DOMAIN_MISMATCH',
  /** D-23: a boat can only be bought for / transferred to a Base nautica (`NAUTICAL_BASE`), never a station on a street. */
  'NEEDS_NAUTICAL_BASE',
  /** D-23: a Base nautica can only be acquired on a nautical site (harbour, seafront, main lake: `SiteDto.nautical`). */
  'NAUTICAL_SITE_REQUIRED',
  /** An aircraft sent to an incident none of whose requirements it can contribute anything to. */
  'AIR_SUPPORT_NOT_NEEDED',
  /** An aircraft whose flight endurance (even after refuelling at base) cannot cover there and back with its reserve intact. */
  'ENDURANCE_INSUFFICIENT',
  /** The free undo of a dispatch came too late (config `dispatch.cancelGraceSeconds`): the vehicles can only be recalled. */
  'CANCEL_WINDOW_EXPIRED',
  /** The dispatch cannot be undone for free: a vehicle already left its origin, or it is not a player dispatch (`details.reason`). */
  'DISPATCH_NOT_CANCELLABLE',
  'CREW_INSUFFICIENT',
  'CREW_UNQUALIFIED',
  'CREW_EXHAUSTED',
  'INVENTORY_INSUFFICIENT',
  'CAPACITY_EXCEEDED',
  'ROUTE_UNAVAILABLE',
  'HOSPITAL_NOT_COMPATIBLE',
  'INVALID_STATE_TRANSITION',
  'FEATURE_DISABLED',
  // alliances (D-102…D-123) — statuses in BE/src/shared/errors.ts
  /** 409: no free member slot at the alliance's level. */
  'ALLIANCE_FULL',
  /** 409: the career already has an ACTIVE membership (one alliance per career). */
  'ALREADY_IN_ALLIANCE',
  /** 429: 24 h after leaving / being removed before joining or founding again (`details.until`). */
  'ALLIANCE_COOLDOWN',
  /** 403: the caller is not an ACTIVE member of that alliance (own-alliance routes; a foreign alliance id answers 404). */
  'NOT_ALLIANCE_MEMBER',
  /** 403: the action needs DEPUTY / COORDINATOR (`details.role`). */
  'ROLE_REQUIRED',
  /** 403: muted by a high role or by the platform (`details.until`, `details.scope` = ALLIANCE | PLATFORM). */
  'MUTED',
  /** 422: the text filter refused the text (`details.reason` = BANNED_TERM | URL | EMAIL | PHONE | SOCIAL_HANDLE). */
  'TEXT_REJECTED',
  /** 403: the community rules (current version) must be accepted before writing free text. */
  'RULES_NOT_ACCEPTED',
  /** 409: the incident has no uncovered REQUIRED / RECOMMENDED need (or nothing is left for a column to cover). */
  'NO_REAL_GAP',
  /** 409: the column would arrive after the incident deadline. */
  'COLUMN_TOO_LATE',
  /** 429: aid limits (`details.reason` = OPEN_REQUESTS | MIN_INTERVAL | ALREADY_REQUESTED | ACTIVE_COLUMNS | ONE_PER_REQUEST | TOO_MANY_VEHICLES). */
  'AID_LIMIT_REACHED',
  /** 429: a Director / alliance name or tag may change once every 30 days (`details.until`). */
  'NAME_CHANGE_COOLDOWN',
  /** 403: the target Director blocked the caller (or vice versa) — direct invites, mentions. */
  'BLOCKED',
  // account lifecycle (platform agent: account.ts)
  /** 403: the account is waiting for its scheduled deletion (`details.scheduledAt`); sign in with `cancelDeletion: true` to keep it. */
  'ACCOUNT_DELETING',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Meta = z.object({
  serverTime: IsoDateTime,
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
});

/** Every successful response is `{ data, meta }`. */
export const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data, meta: Meta });

export const ServiceFamily = z.enum(['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE', 'UNG']);
export type ServiceFamily = z.infer<typeof ServiceFamily>;
/** Facilities may also be SHARED (multi-agency coordination centre). */
export const FacilityFamily = z.enum(['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE', 'SHARED']);
export type FacilityFamily = z.infer<typeof FacilityFamily>;

export const Domain = z.enum(['GROUND', 'AIR', 'WATER']);
export type Domain = z.infer<typeof Domain>;

export const SupportedLocale = z.enum(['it', 'en', 'fr', 'de', 'es']);
export type SupportedLocale = z.infer<typeof SupportedLocale>;

/** Translatable text is sent as an i18n key + params; the client resolves it. */
export const I18nText = z.object({ key: z.string(), params: z.record(z.union([z.string(), z.number()])).optional() });
export type I18nText = z.infer<typeof I18nText>;

export const HEADER_IDEMPOTENCY_KEY = 'Idempotency-Key';
export const HEADER_REQUEST_ID = 'X-Request-Id';
export const API_PREFIX = '/api/v1';
