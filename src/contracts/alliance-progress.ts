import { z } from 'zod';
import { Amount, I18nText, IdPrefix, IsoDateTime, publicId } from './common';
import { AllianceDirectorRefDto, AllianceEmblemDto, AllianceFrame } from './alliances';

/**
 * Alliance progression — level & XP, weekly objectives, weekly ranking — D-105/D-118/D-119, study 06, 08 §3.5.
 * Flags `alliance_objectives` (objectives) and `alliance_ranking` (ranking); the level itself belongs to `alliances`.
 *
 * XP sources (06 §1.1): incident resolved by a member 1 (≤ 60 / week / member), useful allied column 15, weekly objective
 * 150–300, operation 200–600 by outcome, ranking placement 100–400. Levels 1…10 → 10…40 member slots (`AllianceLevelDto`,
 * alliances.ts); the level never goes down; only organisational / cosmetic unlocks.
 * Weekly objectives: 3 per week (Monday 00:00 Europe/Rome → Sunday), sized on last week's active members: VOLUME +
 * COOPERATION + one rotating. Reward on completion: alliance XP + a small personal credits/XP reward (ledger
 * `ALLIANCE_OBJECTIVE`, key `aobj:<aob_…>:<car_…>`) to members who contributed ≥ 5 % of the target or 3 incidents.
 * Ranking: operational points per member (severity/outcome weighted incidents, response time, useful columns, operations);
 * alliance score = sum of its best 10 members; ≥ 3 scoring members to be listed; resets every Monday; top 20 + own position;
 * cosmetic frame for the top 3; never credits. Aids beyond the daily caps give no points.
 *
 * Realtime: `alliance.objectives.updated` {objectives}, `alliance.ranking.updated` {ranking}.
 */

export const AllianceObjectiveType = z.enum(['VOLUME', 'QUALITY', 'COOPERATION', 'MEDICAL', 'OPERATIONS', 'PRESENCE']);
export type AllianceObjectiveType = z.infer<typeof AllianceObjectiveType>;

/** Monday 00:00 → next Monday 00:00, Europe/Rome, as instants. */
export const AllianceWeekDto = z.object({ start: IsoDateTime, end: IsoDateTime });

export const AllianceObjectiveDto = z.object({
  id: publicId(IdPrefix.allianceObjective),
  type: AllianceObjectiveType,
  /** `alliance.objective.<TYPE>.title` / `.description` with `{target}` and type-specific params. */
  title: I18nText,
  description: I18nText,
  target: z.number().int(),
  progress: z.number().int(),
  completed: z.boolean(),
  completedAt: IsoDateTime.nullable(),
  reward: z.object({
    allianceXp: z.number().int(),
    memberCredits: Amount,
    memberXp: Amount,
    /** Personal reward threshold: share of the target (0.05) or absolute count (3), whichever is lower. */
    minShare: z.number(),
    minCount: z.number().int(),
  }),
  /** Every contributing member, highest first. */
  contributions: z.array(AllianceDirectorRefDto.extend({ value: z.number().int() })),
  myContribution: z.number().int(),
  myRewardEligible: z.boolean(),
  /** Set once the personal reward was paid to the caller. */
  myRewardPaidAt: IsoDateTime.nullable(),
});
export type AllianceObjectiveDto = z.infer<typeof AllianceObjectiveDto>;

/** GET /careers/:careerId/alliance/objectives → `AllianceObjectivesDto | null` (null = flag off / no alliance). */
export const AllianceObjectivesDto = z.object({
  week: AllianceWeekDto,
  objectives: z.array(AllianceObjectiveDto),
  /** Members active last week: the sizing base. */
  activeMembersLastWeek: z.number().int(),
  generatedAt: IsoDateTime,
  /** Last week's objectives, for the "settimana scorsa" line (completed count). */
  lastWeek: z.object({ completed: z.number().int(), total: z.number().int() }).nullable(),
});
export type AllianceObjectivesDto = z.infer<typeof AllianceObjectivesDto>;

/** Alliance XP ledger entry (GET /careers/:careerId/alliance/xp?cursor&limit, newest first). Labels `alliance.xp.<SOURCE>`. */
export const AllianceXpSource = z.enum(['INCIDENT_RESOLVED', 'AID_COLUMN', 'OBJECTIVE', 'OPERATION', 'RANKING']);
export type AllianceXpSource = z.infer<typeof AllianceXpSource>;
export const AllianceXpEntryDto = z.object({
  id: z.string(),
  source: AllianceXpSource,
  points: z.number().int(),
  /** The member who earned it (null for alliance-wide sources). */
  member: AllianceDirectorRefDto.nullable(),
  /** Weekly per-member cap reached: the points were not counted (shown struck through). */
  capped: z.boolean(),
  createdAt: IsoDateTime,
});
export type AllianceXpEntryDto = z.infer<typeof AllianceXpEntryDto>;
export const AllianceXpQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

export const AllianceRankingEntryDto = z.object({
  position: z.number().int(),
  alliance: z.object({ id: publicId(IdPrefix.alliance), name: z.string(), tag: z.string(), emblem: AllianceEmblemDto, level: z.number().int() }),
  /** Sum of the best 10 members' operational points this week. */
  score: z.number().int(),
  scoringMembers: z.number().int(),
  /** Only for the caller's own alliance (06 §3.3: never member data of other alliances); null otherwise. */
  topContributors: z.array(AllianceDirectorRefDto.extend({ points: z.number().int() })).nullable(),
  isMine: z.boolean(),
});
export type AllianceRankingEntryDto = z.infer<typeof AllianceRankingEntryDto>;

/** GET /alliances/ranking (bearer) → the current week; `enabled: false` (flag off) comes with empty lists, never 403. */
export const AllianceRankingDto = z.object({
  enabled: z.boolean(),
  week: AllianceWeekDto,
  /** Config knobs: best-N members summed (10), minimum scoring members (3). */
  bestOf: z.number().int(),
  minScoringMembers: z.number().int(),
  /** Top 20. */
  entries: z.array(AllianceRankingEntryDto),
  /** The caller's alliance (also when outside the top 20); null without an alliance or when not yet listed. */
  mine: AllianceRankingEntryDto.nullable(),
  /** The caller's own operational points this week. */
  myPoints: z.number().int(),
  /** Last week's final result of the caller's alliance (snapshot `alliance_rankings`). */
  lastWeek: z.object({ position: z.number().int(), score: z.number().int(), frame: AllianceFrame.nullable(), totalRanked: z.number().int() }).nullable(),
  /** Instant of the next weekly rollover (Monday 00:00 Europe/Rome). */
  rolloverAt: IsoDateTime,
});
export type AllianceRankingDto = z.infer<typeof AllianceRankingDto>;
