import { z } from 'zod';
import { Amount, I18nText, IdPrefix, IsoDateTime, publicId } from './common';
import { MajorPhase } from './game';
import { AllianceDirectorRefDto } from './alliances';

/**
 * Alliance operations ("Operazione di alleanza") — D-106/D-120, study 07, 08 §3.5. Flag `alliance_operations`.
 *
 * One operation = one personal major incident per participant (his "front", `MajorIncidentDto.allianceOperationId`), linked
 * by a shared board and clock. Trigger (`ALLIANCE_OPERATION_CHECK` every 120 s per active alliance): members on duty with a
 * visible client ≥ max(2, 30 % of last week's active members, ≤ 6) accumulate shared time; past a random threshold
 * (90–180 min, first time 45–90) the operation starts, at most one every 20 h, not when more than half of the on-duty members
 * have a personal major open. ALERT lasts 5 min: full-screen alert to who is on duty (realtime `alliance.operation.updated`
 * + CRITICAL notification `OPEN_ALLIANCE` `operation:<aop_…>`), push `ALLIANCE_AID` to every member; join / decline; fewer
 * than 2 joined → CANCELLED, half of the accumulation refunded. ACTIVE: 60–120 min by scenario, four phases as the majors;
 * each front sized at 50–90 % of the owner's operational vehicles; the personal major generator pauses for participants;
 * late join until the start of the last phase; an OPERATION chat channel; aid between fronts = the allied column without the
 * daily cap. End: every front closed, or the clock runs out. Outcome (07 §5.1): GOLD all fronts closed with high mean quality
 * in time · SILVER ≥ 80 % overall progress · BRONZE ≥ 50 % · FAILED below (no penalty). Rewards: each participant's front bonus
 * × 1.3 / 1.15 / 1.0 / 0.7 (ledger `ALLIANCE_OPERATION`, key `aop:<aop_…>:<car_…>`; needs ≥ 1 sub-incident closed or a useful
 * column), aid shares as in 05, alliance XP 200–600, a trophy on the board.
 */

export const AllianceOperationStatus = z.enum(['ALERT', 'ACTIVE', 'ENDED', 'CANCELLED']);
export type AllianceOperationStatus = z.infer<typeof AllianceOperationStatus>;
export const AllianceOperationParticipantStatus = z.enum(['INVITED', 'JOINED', 'DECLINED']);
export type AllianceOperationParticipantStatus = z.infer<typeof AllianceOperationParticipantStatus>;
export const AllianceOperationOutcome = z.enum(['GOLD', 'SILVER', 'BRONZE', 'FAILED']);
export type AllianceOperationOutcome = z.infer<typeof AllianceOperationOutcome>;
/** Why the caller cannot join now (`AllianceOperationDto.me.blockedReason`). Labels `alliance.operation.blocked.<CODE>`. */
export const AllianceOperationJoinBlock = z.enum(['LEVEL_TOO_LOW', 'PERSONAL_MAJOR_OPEN', 'TOO_LATE', 'NOT_RUNNING', 'ALREADY_JOINED', 'DECLINED', 'FEATURE_DISABLED']);
export type AllianceOperationJoinBlock = z.infer<typeof AllianceOperationJoinBlock>;

/** The state of one participant's front, as the shared board shows it (one row per front, 07 §4). */
export const AllianceOperationFrontDto = z.object({
  majorId: publicId(IdPrefix.majorIncident),
  phase: MajorPhase,
  /** 0..1 work progress of the front. */
  progress: z.number(),
  /** Mean coverage of the REQUIRED needs of its open members, 0..1. */
  coverage: z.number(),
  sectors: z.number().int(),
  sectorsClosed: z.number().int(),
  /** The front's OPEN aid request, if any ("chi ha bisogno di una colonna"). */
  openAidRequestId: publicId(IdPrefix.aidRequest).nullable(),
  ended: z.boolean(),
});
export type AllianceOperationFrontDto = z.infer<typeof AllianceOperationFrontDto>;

export const AllianceOperationParticipantDto = z.object({
  participant: AllianceDirectorRefDto,
  status: AllianceOperationParticipantStatus,
  joinedAt: IsoDateTime.nullable(),
  /** Null until JOINED (the front is created on join). */
  front: AllianceOperationFrontDto.nullable(),
  contribution: z.object({ incidentsClosed: z.number().int(), usefulColumns: z.number().int(), points: z.number().int() }),
  reward: z.object({
    /** Below the personal threshold (no sub-incident closed, no useful column): nothing is paid (07 §5.2). */
    eligible: z.boolean(),
    multiplier: z.number().nullable(),
    credits: Amount.nullable(),
    xp: Amount.nullable(),
  }),
});
export type AllianceOperationParticipantDto = z.infer<typeof AllianceOperationParticipantDto>;

export const AllianceOperationDto = z.object({
  id: publicId(IdPrefix.allianceOperation),
  allianceId: publicId(IdPrefix.alliance),
  /** Catalog scenario (`major-incidents.yaml`, alliance-scale entries): `alliance.operation.scenario.<CODE>.title|description|alert`. */
  scenarioCode: z.string(),
  title: I18nText,
  description: I18nText,
  /** The full-screen alert line. */
  alert: I18nText,
  icon: z.string(),
  status: AllianceOperationStatus,
  triggeredBy: z.enum(['SYSTEM', 'ADMIN']),
  /** Collective phase = the least advanced open front (null before ACTIVE / after the end). */
  phase: MajorPhase.nullable(),
  /** 0..1 collective progress (mean of the fronts). */
  progress: z.number(),
  durationMinutes: z.number().int(),
  /** ALERT start. */
  alertedAt: IsoDateTime,
  alertEndsAt: IsoDateTime,
  /** ACTIVE start (null while ALERT / when CANCELLED). */
  startedAt: IsoDateTime.nullable(),
  /** The clock: the operation ends here at the latest. */
  endsAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
  /** Late join allowed until the start of the last phase (07 §3.3); null = closed. */
  lateJoinUntil: IsoDateTime.nullable(),
  outcome: AllianceOperationOutcome.nullable(),
  participants: z.array(AllianceOperationParticipantDto),
  joinedCount: z.number().int(),
  /** Allied columns in flight between fronts ("chi ha colonne in viaggio e verso chi"). */
  columnsInFlight: z.array(z.object({
    columnId: publicId(IdPrefix.aidColumn), helper: AllianceDirectorRefDto, requester: AllianceDirectorRefDto, arriveAt: IsoDateTime,
  })),
  /** OPERATION chat channel (created at ACTIVE). */
  channelId: publicId(IdPrefix.allianceChannel).nullable(),
  me: z.object({
    status: AllianceOperationParticipantStatus.nullable(),
    canJoin: z.boolean(),
    blockedReason: AllianceOperationJoinBlock.nullable(),
    /** My front's major id (open it with `GET /major-incidents/:majorId`). */
    majorId: publicId(IdPrefix.majorIncident).nullable(),
  }),
  reward: z.object({
    /** Alliance XP by outcome (200–600), set at the end. */
    allianceXp: z.number().int().nullable(),
    /** Trophy pinned on the board of trophies (`alliance.post.system.OPERATION_ENDED`). */
    trophy: z.boolean(),
    /** Collective quality 0..1 (mean quality of the fronts). */
    quality: z.number().nullable(),
  }),
});
export type AllianceOperationDto = z.infer<typeof AllianceOperationDto>;

/**
 * GET /careers/:careerId/alliance/operation → `AllianceOperationDto | null`: the ALERT / ACTIVE operation, or the last one
 * ENDED / CANCELLED within the past 60 min (so the outcome summary can be shown); null otherwise or flag off.
 */
export const AllianceOperationsQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).optional() });
/** GET /careers/:careerId/alliance/operations?cursor&limit — history, newest first (the trophy board). */

/** ★POST /admin/alliances/:allianceId/operation (GAME_ADMIN; QA) — starts an ALERT now; 409 `CONFLICT` `details.reason = OPERATION_RUNNING` | `COOLDOWN`. */
export const AdminStartAllianceOperationBody = z.object({
  scenarioCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
  /** Skip the 20 h cooldown and the on-duty threshold (default true for QA). */
  force: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500),
});
export type AdminStartAllianceOperationBody = z.infer<typeof AdminStartAllianceOperationBody>;
