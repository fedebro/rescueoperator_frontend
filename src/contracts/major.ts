import { z } from 'zod';
import { Amount, I18nText, IdPrefix, IsoDateTime, LngLat, ServiceFamily, publicId } from './common';
import { IncidentStatus, MajorMemberRole, MajorPhase, RequirementLevel, WeatherCode } from './game';
import { IncidentAlliedColumnDto } from './alliance-aid';

/**
 * Major incidents ("maxi-emergenze") — D-24 [U] / D-69 [C], analisi/studio-2026-09-27/06, analisi/note-agenti/major-incidents.md.
 *
 * A rare, dedicated event sized on the career's own fleet: a MAIN scene plus LINKED incidents spawned around it phase by phase
 * (ALARM → CONTAINMENT → RESCUE → SECURING), that grows instead of failing when coverage is low, and that external
 * reinforcements can always complete at a proportional cost in reward. Every member is a normal incident (`IncidentDto`,
 * dispatched the usual way) carrying `IncidentDto.major` (a `MajorIncidentRefDto`); this file is the coordination view.
 *
 * Realtime: no new event type. Every change of the major (phase, growth, reinforcements, end) is broadcast as a
 * `career.updated` event whose payload carries `{ major: MajorIncidentDto }` (no `career` key), and the member incidents keep
 * their own `incident.*` events. The start also creates a CRITICAL notification (`notification.created`, action
 * OPEN_INCIDENT on the main scene). Texts: catalog bundle `major.*` (`GET /public/i18n/catalog/:locale`).
 */

export const MajorOutcome = z.enum(['SUCCESS', 'PARTIAL', 'FAILURE', 'CANCELLED']);
export type MajorOutcome = z.infer<typeof MajorOutcome>;
export const MajorMedal = z.enum(['BRONZE', 'SILVER', 'GOLD']);
export type MajorMedal = z.infer<typeof MajorMedal>;
/** Why a member exists: reported with the alarm, born in a phase, caused by low coverage, or a catalog secondary of the main scene. */
export const MajorMemberCause = z.enum(['INITIAL', 'PHASE', 'GROWTH', 'SECONDARY']);
export const MajorReinforcementStatus = z.enum(['EN_ROUTE', 'ON_SCENE', 'RELEASED']);
/** Labels: catalog bundle `major.reinforcements.blocked.<CODE>`. */
export const MajorReinforcementBlock = z.enum(['NOTHING_TO_COVER', 'ALREADY_EN_ROUTE', 'MAJOR_ENDED', 'NO_OWN_UNIT']);

/** One capability need, summed over the member incidents it is shown for (`reinforced` = covered by external reinforcements). */
export const MajorCapabilityDto = z.object({
  capability: z.string(),
  level: RequirementLevel,
  /** What the career's own fleet still has to bring (after reinforcements). */
  required: z.number().int(),
  onScene: z.number().int(),
  enRoute: z.number().int(),
  /** Capability supplied by reinforcement columns already requested (en route or on scene). */
  reinforced: z.number().int(),
  /** True when nothing of it is left to the career (locked/unowned family, or fully reinforced). */
  external: z.boolean(),
  /** Additive (alliances, D-102): capability brought by allied columns on scene — revocable, so never folded into `reinforced`. */
  allied: z.number().int().optional(),
});
export type MajorCapabilityDto = z.infer<typeof MajorCapabilityDto>;

/**
 * Requirement bars GROUPED BY SERVICE (study §2.6: "barre dei requisiti raggruppate per servizio, non 15 righe piatte").
 * `coverage` = mean over the REQUIRED capabilities of min(1, (onScene + reinforced on scene) / (required + reinforced)).
 */
export const MajorGroupDto = z.object({
  family: ServiceFamily.nullable(),
  required: z.number().int(),
  onScene: z.number().int(),
  enRoute: z.number().int(),
  reinforced: z.number().int(),
  coverage: z.number(),
  capabilities: z.array(MajorCapabilityDto),
});
export type MajorGroupDto = z.infer<typeof MajorGroupDto>;

/** One sector of the event = one member incident, with the vehicles assigned to it ("mezzi assegnati per settore"). */
export const MajorSectorDto = z.object({
  incidentId: publicId(IdPrefix.incident),
  role: MajorMemberRole,
  cause: MajorMemberCause,
  /** Phase in which the member appeared. */
  phase: MajorPhase,
  /** 0 = main scene (`major.sector.main`), 1…n = linked incidents (`major.sector.sub` with `{count}`). */
  sector: z.number().int(),
  templateCode: z.string(),
  title: I18nText,
  status: IncidentStatus,
  severity: z.number().int(),
  /** Where the member's marker is: its scene (on the water for a water rescue, whose land units meet on the shore road). */
  position: LngLat,
  /** From the event centre (the main scene): the client draws a link line to every linked incident. */
  distanceMeters: z.number().int(),
  families: z.array(ServiceFamily),
  coverageRatio: z.number(),
  assignedVehicleIds: z.array(publicId(IdPrefix.vehicle)),
  groups: z.array(MajorGroupDto),
});
export type MajorSectorDto = z.infer<typeof MajorSectorDto>;

/** An external reinforcement column ("Chiedi rinforzi"): neighbouring province / Civil Protection / system units. */
export const MajorReinforcementDto = z.object({
  id: publicId(IdPrefix.majorReinforcement),
  status: MajorReinforcementStatus,
  requestedAt: IsoDateTime,
  arriveAt: IsoDateTime,
  /** Share (0..1) of the major's requirement volume this column covers. */
  coverageShare: z.number(),
  families: z.array(ServiceFamily),
  capabilities: z.array(z.object({ capability: z.string(), value: z.number().int() })),
  /** `major.reinforcements.source`. */
  source: I18nText,
});
export type MajorReinforcementDto = z.infer<typeof MajorReinforcementDto>;

/** What "Chiedi rinforzi" would do right now (also `GET /major-incidents/:id/reinforcements/quote`). */
export const MajorReinforcementQuoteDto = z.object({
  available: z.boolean(),
  blockedReason: MajorReinforcementBlock.nullable(),
  /** Share (0..1) of the major's requirement volume the column would cover (what the career's committed units do not). */
  coverageShare: z.number(),
  /** Share (0..1) by which the major's bonus would shrink (`coverageShare × rewardPenalty`, compounded with earlier columns). */
  rewardReductionShare: z.number(),
  /** Real seconds until the column is on scene (night / weather slow it down; PRIORITY_EXTERNAL_SUPPORT speeds it up). */
  etaSeconds: z.number().int(),
  /** True from the level of the PRIORITY_EXTERNAL_SUPPORT feature: the column arrives sooner. */
  priority: z.boolean(),
  families: z.array(ServiceFamily),
  capabilities: z.array(z.object({ capability: z.string(), value: z.number().int() })),
});
export type MajorReinforcementQuoteDto = z.infer<typeof MajorReinforcementQuoteDto>;

export const MajorIncidentDto = z.object({
  id: publicId(IdPrefix.majorIncident),
  scenarioCode: z.string(),
  /** `major.scenario.<CODE>.title` / `.description`; `alert` = the full-screen alert line (param `address`). */
  title: I18nText,
  description: I18nText,
  alert: I18nText,
  icon: z.string(),
  status: z.enum(['ACTIVE', 'ENDED']),
  /** Null while ACTIVE. */
  outcome: MajorOutcome.nullable(),
  phase: MajorPhase,
  phaseStartedAt: IsoDateTime,
  /** The four operational phases in order, with the instant each one was reached (null = not yet). */
  phases: z.array(z.object({ phase: MajorPhase, reached: z.boolean(), at: IsoDateTime.nullable() })),
  /** Work progress of the main scene, 0..1 (anchored: `progress` at `serverTime`; phases switch at 0.35 / 0.75 by default). */
  progress: z.number(),
  /** Event area to highlight on the map. */
  center: LngLat,
  areaRadiusMeters: z.number().int(),
  address: z.string(),
  municipality: z.string().nullable(),
  mainIncidentId: publicId(IdPrefix.incident).nullable(),
  /** Severity of the main scene; `severityBoosted` = one band above what this level normally sees (D-69). */
  severity: z.number().int(),
  severityBoosted: z.boolean(),
  /** Sized on the career's fleet (D-69): operational vehicles when it started, and the vehicle-equivalents it was built for. */
  fleet: z.object({ operational: z.number().int(), targetVehicles: z.number().int() }),
  /** The condition that made this scenario likely (weather code / world event), when there was one. */
  trigger: z.object({ weather: WeatherCode.nullable(), event: z.string().nullable() }),
  /** Growth instead of failure: steps taken so far (each spawns one more linked incident and widens the area). */
  growth: z.object({ level: z.number().int(), max: z.number().int(), nextCheckAt: IsoDateTime.nullable() }),
  sectors: z.array(MajorSectorDto),
  /** Requirement bars of every OPEN member, grouped by service. */
  groups: z.array(MajorGroupDto),
  reinforcements: z.object({
    quote: MajorReinforcementQuoteDto,
    requests: z.array(MajorReinforcementDto),
    /** Share (0..1) of the major covered by reinforcements so far (reduces the bonus by `× rewardPenalty`). */
    reinforcedShare: z.number(),
  }),
  reward: z.object({
    /** The major's own bonus (on top of every member incident's normal reward), quality 0.5 … 1.2 at the current reinforcement share. */
    estimated: z.object({ min: Amount, max: Amount }),
    /** Set when ENDED. */
    credits: Amount.nullable(),
    xp: Amount.nullable(),
    reputationDelta: z.number().nullable(),
    medal: MajorMedal.nullable(),
    quality: z.number().nullable(),
    notes: z.array(I18nText),
  }),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  /* ── additive (alliances, D-102/D-106 — analisi/note-agenti/alleanze-backend.md) ── */
  /** Set when this major is a FRONT of an alliance operation (`GET /careers/:id/alliance/operation` for the shared board). */
  allianceOperationId: publicId(IdPrefix.allianceOperation).nullable().optional(),
  /** The one aid request of this major (05 §7: one per major, columns spread over the sectors); null/absent when none. */
  aidRequestId: publicId(IdPrefix.aidRequest).nullable().optional(),
  /** Allied columns towards this major, shown next to the system reinforcements ("con aiuti niente medaglia d'oro"). */
  alliedColumns: z.array(IncidentAlliedColumnDto).optional(),
});
export type MajorIncidentDto = z.infer<typeof MajorIncidentDto>;

/** A career trophy per major scenario ("un riconoscimento per ogni tipo di maxi gestita"): the best medal so far. */
export const MajorTrophyDto = z.object({
  scenarioCode: z.string(),
  title: I18nText,
  icon: z.string(),
  medal: MajorMedal.nullable(),
  /** Majors of this scenario closed with SUCCESS or PARTIAL / every major of this scenario that ended. */
  handled: z.number().int(),
  attempts: z.number().int(),
  bestQuality: z.number().nullable(),
  firstAt: IsoDateTime.nullable(),
  lastAt: IsoDateTime.nullable(),
});
export type MajorTrophyDto = z.infer<typeof MajorTrophyDto>;

/** GET /careers/:id/major-incidents/trophies — every scenario of the catalog, won or not yet. */
export const MajorTrophiesResult = z.object({
  /** Majors start at this Director level (config `majorIncidents.minLevel`). */
  minLevel: z.number().int(),
  unlocked: z.boolean(),
  handled: z.number().int(),
  trophies: z.array(MajorTrophyDto),
});
export type MajorTrophiesResult = z.infer<typeof MajorTrophiesResult>;

/** ★POST /admin/careers/:careerId/major-incident — QA / support: start a major now (`scenarioCode` optional). */
export const AdminSpawnMajorBody = z.object({ scenarioCode: z.string().regex(/^MAJ_[A-Z0-9_]+$/).optional(), reason: z.string().min(5).max(500) });
export type AdminSpawnMajorBody = z.infer<typeof AdminSpawnMajorBody>;
