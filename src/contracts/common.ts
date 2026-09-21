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
  'CREW_INSUFFICIENT',
  'CREW_UNQUALIFIED',
  'CREW_EXHAUSTED',
  'INVENTORY_INSUFFICIENT',
  'CAPACITY_EXCEEDED',
  'ROUTE_UNAVAILABLE',
  'HOSPITAL_NOT_COMPATIBLE',
  'INVALID_STATE_TRANSITION',
  'FEATURE_DISABLED',
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
