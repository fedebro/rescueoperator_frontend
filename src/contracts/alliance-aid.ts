import { z } from 'zod';
import { Amount, I18nText, IdPrefix, IsoDateTime, ServiceFamily, publicId } from './common';
import { AidColumnStatus, AidRequestStatus, AllianceDirectorRefDto } from './alliances';

/**
 * Mutual aid — the allied column ("Mutuo soccorso", "Colonna alleata") — D-102/D-104/D-116/D-117, study 05, 08 §3.4, §4.
 * Flag `alliance_aid`. Enums `AidRequestStatus` / `AidColumnStatus` live in alliances.ts (game.ts embeds them).
 *
 * 1. The requester shares an incident he cannot cover: only with a REAL gap (REQUIRED / RECOMMENDED needs minus his units on
 *    scene + en route minus allied cover; the server computes it, 409 `NO_REAL_GAP`), one request per incident, at most 2 OPEN
 *    per career (+ one per major), 60 s between requests (429 `AID_LIMIT_REACHED` `details.reason`). The incident becomes
 *    `visibility: 'ALLIANCE'`; the request expires with the incident deadline.
 * 2. A helper composes a column from his AVAILABLE vehicles that bring at least one missing capability (≤ 4; ≤ 8 towards a
 *    major), one column per request, ≤ 2 in flight per career (3 from alliance level 6). ETA = preparation + real travel ×
 *    compression, clamped 2–15 min; a column that would arrive after the deadline is refused (409 `COLUMN_TOO_LATE`).
 *    His vehicles go `ALLIED_SUPPORT` (crew busy, not dispatchable, not counted in his coverage); in his fleet they show
 *    "In supporto a [TAG] Name · rientro tra …" (`VehicleDto.alliedSupport`). He may recall them anytime.
 * 3. On arrival the column's capabilities add to the requester's coverage and patient care (`IncidentDto.allied`,
 *    `IncidentRequirementDto.allied`), never to transport. The column returns when the incident ends, when recalled, or after
 *    20 min on scene; fuel / autonomy of the round trip is deducted, never a breakdown.
 * 4. Settlement when the incident ends: fund = 40 % of the base reward (25 % of a major's bonus), split by useful contribution
 *    (gap I covered / total gap × time on scene before the end / time the gap waited for me), minimum 10 %, 8 rewarded aids per
 *    helper per day, same-pair decay (3 full, then ×0.5, ×0.25), suspicious pairs → `UNDER_REVIEW`. Ledger `ALLIANCE_AID`,
 *    idempotency `aid:<col_…>`. The requester keeps his full reward; in a major, no gold medal once aid was used.
 *
 * Realtime: `alliance.aid.updated` {request} and `alliance.column.updated` {column} on the alliance stream; `vehicle.updated`,
 * `incident.updated`, `credits.changed` on each world's career stream.
 */

/** Only REQUIRED / RECOMMENDED needs can be a gap (05 §2.1). */
export const AidGapLevel = z.enum(['REQUIRED', 'RECOMMENDED']);
export const AidGapDto = z.object({
  capability: z.string(),
  level: AidGapLevel,
  /** What is still missing after own units (on scene + en route) and allied columns (en route + on scene). */
  missing: z.number().int(),
  /** Of the original gap, what allied columns already bring. */
  allied: z.number().int(),
  /** The gap when the request was created (the "photograph"). */
  initial: z.number().int(),
});
export type AidGapDto = z.infer<typeof AidGapDto>;

/** What the requester's incident looks like to the alliance: municipality, never coordinates (08 §8). */
export const AidIncidentRefDto = z.object({
  id: publicId(IdPrefix.incident),
  templateCode: z.string(),
  title: I18nText,
  icon: z.string(),
  severity: z.number().int(),
  municipality: z.string().nullable(),
  families: z.array(ServiceFamily),
  /** `isMajor`: the request covers a whole major incident (one per major; columns are spread over its sectors). */
  major: z.object({ id: publicId(IdPrefix.majorIncident), scenarioCode: z.string(), title: I18nText }).nullable(),
  /** Incident deadline = request expiry. */
  expiresAt: IsoDateTime.nullable(),
});
export type AidIncidentRefDto = z.infer<typeof AidIncidentRefDto>;

export const AidColumnItemDto = z.object({
  vehicleId: publicId(IdPrefix.vehicle),
  typeCode: z.string(),
  callSign: z.string(),
  family: ServiceFamily,
  /** Photograph of the capabilities at departure. */
  capabilities: z.array(z.object({ capability: z.string(), value: z.number().int() })),
});
export type AidColumnItemDto = z.infer<typeof AidColumnItemDto>;

/** `PENDING` until settlement · `PAID` · `NONE` (below 10 %, aborted, recalled before use) · `CAPPED` (9th+ of the day: XP and points only) · `UNDER_REVIEW` (collusion signals). */
export const AidRewardStatus = z.enum(['PENDING', 'PAID', 'NONE', 'CAPPED', 'UNDER_REVIEW']);
export type AidRewardStatus = z.infer<typeof AidRewardStatus>;

export const AidColumnDto = z.object({
  id: publicId(IdPrefix.aidColumn),
  requestId: publicId(IdPrefix.aidRequest),
  allianceId: publicId(IdPrefix.alliance),
  helper: AllianceDirectorRefDto,
  requester: AllianceDirectorRefDto,
  incident: AidIncidentRefDto,
  status: AidColumnStatus,
  items: z.array(AidColumnItemDto),
  /** Helper only (null for everyone else): where the column left from. */
  fromFacility: z.object({ id: publicId(IdPrefix.facility), name: z.string() }).nullable(),
  departedAt: IsoDateTime,
  arriveAt: IsoDateTime,
  onSceneAt: IsoDateTime.nullable(),
  /** Latest instant on scene (arrival + 20 min) — the column returns by itself then. */
  maxStayUntil: IsoDateTime.nullable(),
  recalledAt: IsoDateTime.nullable(),
  /** Expected back at base (set when RETURNING). */
  returnAt: IsoDateTime.nullable(),
  returnedAt: IsoDateTime.nullable(),
  /** Helper's own world: did the departure leave his territory under-covered (05 §3.2 warning at composition time)? */
  contribution: z.object({
    /** Useful share of the fund (0..1), null until settlement. */
    share: z.number().nullable(),
    /** Capability points that were actually needed and brought (05 §6.2: "se la mancanza era 80 e porto 200, conta 80"). */
    usefulCoverage: z.number().int().nullable(),
    /** Seconds on scene before the incident ended. */
    secondsOnScene: z.number().int().nullable(),
  }),
  reward: z.object({
    status: AidRewardStatus,
    credits: Amount.nullable(),
    xp: Amount.nullable(),
    /** Same-pair decay applied (1, 0.5, 0.25). */
    pairFactor: z.number().nullable(),
    /** Travel costs deducted (D-41/D-42: one net amount, never negative). */
    travelCost: Amount.nullable(),
  }),
  /** Alliance-operation context, if the request belongs to an operation front. */
  operationId: publicId(IdPrefix.allianceOperation).nullable(),
  mine: z.boolean(),
});
export type AidColumnDto = z.infer<typeof AidColumnDto>;

/** Why the caller cannot send a column to this request now (`AidRequestDto.viewer.blockedReason`). Labels `alliance.aid.blocked.<CODE>`. */
export const AidSendBlock = z.enum([
  'OWN_REQUEST', 'NOT_OPEN', 'NO_USEFUL_VEHICLE', 'COLUMN_LIMIT', 'ALREADY_SENT', 'TOO_LATE', 'FEATURE_DISABLED', 'NOT_ON_DUTY',
]);
export type AidSendBlock = z.infer<typeof AidSendBlock>;

export const AidRequestDto = z.object({
  id: publicId(IdPrefix.aidRequest),
  allianceId: publicId(IdPrefix.alliance),
  requester: AllianceDirectorRefDto,
  incident: AidIncidentRefDto,
  status: AidRequestStatus,
  gaps: z.array(AidGapDto),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  closedAt: IsoDateTime.nullable(),
  /** Every column towards this request (the requester's "Unità alleate" and the alliance's "chi ha colonne in viaggio"). */
  columns: z.array(AidColumnDto),
  /** Road distance from the caller's nearest operational facility, km (null = own request or unknown). */
  distanceKm: z.number().nullable(),
  mine: z.boolean(),
  viewer: z.object({ canSend: z.boolean(), blockedReason: AidSendBlock.nullable() }),
  operationId: publicId(IdPrefix.allianceOperation).nullable(),
});
export type AidRequestDto = z.infer<typeof AidRequestDto>;

/** GET /careers/:careerId/alliance/aid-requests?status=OPEN|ALL&cursor&limit (default OPEN; newest first). */
export const AidRequestsQuery = z.object({
  status: z.enum(['OPEN', 'ALL']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type AidRequestsQuery = z.infer<typeof AidRequestsQuery>;
/** GET /careers/:careerId/alliance/aid-columns?role=GIVEN|RECEIVED|ALL&active=1&cursor&limit — the caller's columns, newest first. */
export const AidColumnsQuery = z.object({
  role: z.enum(['GIVEN', 'RECEIVED', 'ALL']).optional(),
  active: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type AidColumnsQuery = z.infer<typeof AidColumnsQuery>;

/** One of the helper's vehicles that can bring a missing capability (`GET …/aid-requests/:requestId/column-options`). */
export const AidColumnVehicleOptionDto = z.object({
  vehicleId: publicId(IdPrefix.vehicle),
  typeCode: z.string(),
  callSign: z.string(),
  family: ServiceFamily,
  facilityId: publicId(IdPrefix.facility),
  facilityName: z.string(),
  /** Per capability: what it brings and how much of that is still useful (min(value, missing)). */
  capabilities: z.array(z.object({ capability: z.string(), value: z.number().int(), useful: z.number().int() })),
  /** Game seconds until on scene (after travel compression, clamped to [minEta, maxEta]). */
  etaSeconds: z.number().int(),
  arriveAt: IsoDateTime,
  /** Would arrive after the incident deadline: not selectable (`COLUMN_TOO_LATE` if forced). */
  tooLate: z.boolean(),
  /** Crew / autonomy short: not selectable (`details.reason` on the command). */
  blockedReason: z.enum(['TOO_LATE', 'CREW_INSUFFICIENT', 'FUEL_INSUFFICIENT', 'NOT_AVAILABLE']).nullable(),
});
export type AidColumnVehicleOptionDto = z.infer<typeof AidColumnVehicleOptionDto>;

export const AidColumnOptionsDto = z.object({
  request: AidRequestDto,
  /** Null = may send; else why not (the list may still be shown greyed). */
  blockedReason: AidSendBlock.nullable(),
  /** 4 for an incident, 8 towards a major (config). */
  maxVehicles: z.number().int(),
  vehicles: z.array(AidColumnVehicleOptionDto),
  /** The whole fund for this incident (credits, xp) — a column's estimate = fund × its useful share × time factor. */
  fund: z.object({ credits: Amount, xp: Amount }),
  /** Helper's territory coverage now and if every listed vehicle left (`alliance.aid.coverage.<band>`; "La tua copertura scende a Critica"). */
  ownCoverage: z.object({ currentPct: z.number().nullable(), ifAllSentPct: z.number().nullable() }),
  /** Daily rewarded aids used so far / cap (05 §6.3) and the same-pair factor that would apply. */
  dailyRewarded: z.object({ used: z.number().int(), cap: z.number().int() }),
  pairFactor: z.number(),
});
export type AidColumnOptionsDto = z.infer<typeof AidColumnOptionsDto>;

/** ★POST /careers/:careerId/incidents/:incidentId/aid-request (201) — no body: the server lists the gaps itself (05 §2.2). */
export const CreateAidRequestBody = z.object({}).strict();
/** ★POST /careers/:careerId/alliance/aid-requests/:requestId/columns (201). */
export const SendAidColumnBody = z.object({ vehicleIds: z.array(publicId(IdPrefix.vehicle)).min(1).max(8) });
export type SendAidColumnBody = z.infer<typeof SendAidColumnBody>;

/** A column towards MY incident, as the requester's incident card shows it (`IncidentDto.allied`, `MajorIncidentDto.alliedColumns`). */
export const IncidentAlliedColumnDto = z.object({
  columnId: publicId(IdPrefix.aidColumn),
  requestId: publicId(IdPrefix.aidRequest),
  helper: AllianceDirectorRefDto.extend({ tag: z.string() }),
  status: AidColumnStatus,
  arriveAt: IsoDateTime,
  onSceneAt: IsoDateTime.nullable(),
  vehicles: z.array(z.object({ typeCode: z.string(), callSign: z.string(), family: ServiceFamily })),
  capabilities: z.array(z.object({ capability: z.string(), value: z.number().int() })),
});
export type IncidentAlliedColumnDto = z.infer<typeof IncidentAlliedColumnDto>;

/** `VehicleDto.alliedSupport`: my vehicle lent to an ally ("In supporto a [TAG] Name · rientro tra …"). */
export const VehicleAlliedSupportDto = z.object({
  columnId: publicId(IdPrefix.aidColumn),
  requestId: publicId(IdPrefix.aidRequest),
  requester: AllianceDirectorRefDto.extend({ tag: z.string() }),
  incidentTitle: I18nText,
  incidentIcon: z.string(),
  status: AidColumnStatus,
  arriveAt: IsoDateTime,
  /** Expected back at base (null until the return leg starts). */
  returnAt: IsoDateTime.nullable(),
});
export type VehicleAlliedSupportDto = z.infer<typeof VehicleAlliedSupportDto>;
