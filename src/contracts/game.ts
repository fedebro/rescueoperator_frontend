import { z } from 'zod';
import { Amount, Domain, FacilityFamily, I18nText, IdPrefix, IsoDateTime, LineCoords, LngLat, ServiceFamily, publicId } from './common';

/* ───────────────────────────── statuses ───────────────────────────── */

export const IncidentStatus = z.enum([
  'CREATED', 'PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE', 'RESOLVING',
  'RESOLVED', 'FAILED', 'CANCELLED', 'EXPIRED',
]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;
export const INCIDENT_ACTIVE_STATUSES: IncidentStatus[] = ['PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE', 'RESOLVING'];

export const VehicleStatus = z.enum([
  'IN_DELIVERY', 'AVAILABLE', 'PREPARING', 'EN_ROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_HOSPITAL',
  'RETURNING', 'RESTOCKING', 'MAINTENANCE', 'BROKEN_DOWN', 'BEING_RECOVERED', 'OUT_OF_SERVICE',
]);
export type VehicleStatus = z.infer<typeof VehicleStatus>;

export const DispatchVehicleStatus = z.enum([
  'PREPARING', 'EN_ROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_HOSPITAL', 'RETURNING',
  'DONE', 'RECALLED', 'BROKEN_DOWN', 'CANCELLED',
]);

export const PersonnelStatus = z.enum([
  'ONBOARDING', 'AVAILABLE', 'ASSIGNED', 'ON_MISSION', 'RESTING', 'TRAINING',
  'INJURED', 'TRANSFERRING', 'UNAVAILABLE', 'RETIRED',
]);
export const FatigueBand = z.enum(['RESTED', 'TIRED', 'FATIGUED', 'REST_REQUIRED']);

export const PatientStatus = z.enum([
  'UNASSESSED', 'ASSESSED', 'TREATING', 'STABILIZED', 'AWAITING_TRANSPORT',
  'IN_TRANSPORT', 'HANDOFF', 'ADMITTED', 'RELEASED_ON_SCENE', 'DECEASED',
]);
export const TriageCode = z.enum(['RED', 'ORANGE', 'BLUE', 'GREEN', 'WHITE']);

export const FacilityStatus = z.enum(['OPERATIONAL', 'UNDER_CONSTRUCTION', 'OFFLINE']);
export const RequirementLevel = z.enum(['REQUIRED', 'RECOMMENDED', 'OPTIONAL']);
export const HealthBand = z.enum(['EXCELLENT', 'GOOD', 'WORN', 'HIGH_RISK', 'CRITICAL', 'INOPERABLE']);
export const DayPhase = z.enum(['DAY', 'TWILIGHT', 'NIGHT']);
export const WeatherCode = z.enum(['CLEAR', 'CLOUDY', 'RAIN', 'HEAVY_RAIN', 'STORM', 'HIGH_WIND', 'FOG', 'SNOW', 'EXTREME_HEAT']);

/* ───────────────────────────── locations & onboarding ───────────────────────────── */

/** GET /locations/search?q= */
export const LocationSummary = z.object({
  id: z.string(), // territory node public code, e.g. "IT-068028" (ISTAT)
  name: z.string(),
  province: z.string().nullable(),
  region: z.string().nullable(),
  population: z.number().int().nullable(),
  center: LngLat,
  playable: z.boolean(),
});

/** GET /locations/:id/starter-sites */
export const StarterSite = z.object({
  id: publicId(IdPrefix.site),
  name: z.string(),
  real: z.boolean(),
  facilityTypeCode: z.string(),
  position: LngLat,
  address: z.string().nullable(),
  coveragePopulationPct: z.number(), // within the response-time target
  avgResponseMinutes: z.number(),
  capacityPoints: z.number().int(),
  expansionPotential: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  profile: z.enum(['CENTRAL', 'BALANCED', 'PERIPHERAL']),
});

/** POST /careers (Idempotency-Key) */
export const CreateCareerBody = z.object({ locationId: z.string(), siteId: publicId(IdPrefix.site) });

/* ───────────────────────────── core DTOs ───────────────────────────── */

export const CapabilityValue = z.object({ code: z.string(), value: z.number().int().min(0) });

export const CareerSummary = z.object({
  id: publicId(IdPrefix.career),
  directorName: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  timezone: z.string(),
  center: LngLat,
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]), // w,s,e,n
  onDuty: z.boolean(),
  level: z.number().int(),
  xp: Amount,
  xpForCurrentLevel: Amount,
  xpForNextLevel: Amount,
  reputation: z.number(),
  credits: Amount,
  coveragePct: z.number().nullable(),
  unlockedFamilies: z.array(ServiceFamily),
  tutorial: z.object({ completed: z.boolean(), step: z.string().nullable() }),
  createdAt: IsoDateTime,
});
export type CareerSummary = z.infer<typeof CareerSummary>;

export const FacilityDto = z.object({
  id: publicId(IdPrefix.facility),
  typeCode: z.string(),
  family: FacilityFamily,
  name: z.string(),
  position: LngLat,
  status: FacilityStatus,
  capacities: z.array(z.object({ domain: z.union([Domain, z.enum(['PERSONNEL', 'STORAGE', 'WORKSHOP'])]), total: z.number().int(), used: z.number().int() })),
  upgrades: z.array(z.object({ code: z.string(), level: z.number().int(), buildingUntil: IsoDateTime.nullable() })),
  /* additive (wave 2a) */
  address: z.string().nullable().optional(),
  headquarters: z.boolean().optional(),
  /** UNDER_CONSTRUCTION until this instant (acquired facilities). */
  operationalAt: IsoDateTime.nullable().optional(),
  promotion: z.object({ toTypeCode: z.string(), completeAt: IsoDateTime }).nullable().optional(),
});
export type FacilityDto = z.infer<typeof FacilityDto>;

/** A movement leg the client interpolates: position = along(path, (now-departAt)/(arriveAt-departAt)). */
export const MovementDto = z.object({
  path: LineCoords,
  departAt: IsoDateTime,
  arriveAt: IsoDateTime,
  distanceMeters: z.number(),
  purpose: z.enum(['TO_INCIDENT', 'TO_HOSPITAL', 'TO_BASE', 'DELIVERY', 'RECOVERY']),
});
export type MovementDto = z.infer<typeof MovementDto>;

export const VehicleDto = z.object({
  id: publicId(IdPrefix.vehicle),
  typeCode: z.string(),
  family: ServiceFamily,
  callSign: z.string(),
  facilityId: publicId(IdPrefix.facility),
  status: VehicleStatus,
  /** Resting position when not moving (facility, scene or hospital). */
  position: LngLat,
  movement: MovementDto.nullable(),
  incidentId: publicId(IdPrefix.incident).nullable(),
  capabilities: z.array(CapabilityValue),
  health: z.number().min(0).max(100),
  healthBand: HealthBand,
  crew: z.object({ min: z.number().int(), optimal: z.number().int(), assigned: z.number().int() }),
  busyUntil: IsoDateTime.nullable(),
});
export type VehicleDto = z.infer<typeof VehicleDto>;

export const IncidentRequirementDto = z.object({
  capability: z.string(),
  level: RequirementLevel,
  required: z.number().int(),
  onScene: z.number().int(),
  enRoute: z.number().int(),
  /** Family responsible for the need (wave 2a). */
  family: ServiceFamily.nullable().optional(),
  /** True while that family is locked for the career: the need is covered by external support and ignored in coverage. */
  external: z.boolean().optional(),
});

/** System unit (UNG) requested while the incident is RESOLVING. It never blocks the player's reward. */
export const ExternalSupportDto = z.object({
  id: z.string(),
  unitTypeCode: z.string(),
  name: I18nText,
  status: z.enum(['REQUESTED', 'WORKING', 'DONE', 'CANCELLED']),
  arriveAt: IsoDateTime,
  completeAt: IsoDateTime,
  keepsRoadClosed: z.boolean(),
});

export const IncidentDto = z.object({
  id: publicId(IdPrefix.incident),
  templateCode: z.string(),
  category: z.string(),
  families: z.array(ServiceFamily),
  title: I18nText,
  report: I18nText,
  address: z.string(),
  position: LngLat,
  status: IncidentStatus,
  severity: z.number().int().min(1).max(10),
  escalating: z.boolean(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  nextEscalationAt: IsoDateTime.nullable(),
  /** Work model anchor: remaining = max(0, workRemaining - workRate * (now - workAnchorAt)). */
  work: z.object({ total: z.number(), remaining: z.number(), ratePerSecond: z.number(), anchorAt: IsoDateTime, estimatedEndAt: IsoDateTime.nullable() }),
  coverageRatio: z.number(),
  requirements: z.array(IncidentRequirementDto),
  assignedVehicleIds: z.array(publicId(IdPrefix.vehicle)),
  patientCount: z.number().int(),
  estimatedReward: z.object({ min: Amount, max: Amount }),
  isTutorial: z.boolean(),
  /* ── additive (wave 2a) ── */
  /** `report.params` carries the block indexes {intro, detail, condition, closing} + {address, municipality}: the client composes the text from the catalog i18n bundle. */
  summary: I18nText.optional(),
  radio: I18nText.optional(),
  icon: z.string().optional(),
  municipality: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  /** Families of the template that are still locked for this career: their part is handled by external support. */
  externalFamilies: z.array(ServiceFamily).optional(),
  externalSupport: z.array(ExternalSupportDto).optional(),
  /** Set once the reward was paid (an incident may stay RESOLVING afterwards while system units finish). */
  rewardedAt: IsoDateTime.nullable().optional(),
});
export type IncidentDto = z.infer<typeof IncidentDto>;

/** GET /careers/:id/incidents/:incidentId/dispatch-options */
export const DispatchOption = z.object({
  vehicleId: publicId(IdPrefix.vehicle),
  etaSeconds: z.number().int(),
  distanceMeters: z.number(),
  dispatchable: z.boolean(),
  blockedReason: z.string().nullable(), // ErrorCode
  warnings: z.array(z.string()),
  contributes: z.array(CapabilityValue),
  recommended: z.boolean(),
  /**
   * Crew that would ride this vehicle right now (personnel wave, additive). Absent when the personnel system is off.
   * Same shape as `CrewPreview` in depth.ts — declared inline here to keep game.ts free of a cycle with depth.ts.
   */
  crew: z.object({
    available: z.number().int(), min: z.number().int(), optimal: z.number().int(),
    missingQualifications: z.array(z.string()), maxFatigueBand: FatigueBand, efficiency: z.number(),
  }).optional(),
  /**
   * Chaining (additive). Present for every vehicle that is NOT `AVAILABLE` right now and is on a mission or returning
   * (`PREPARING|EN_ROUTE|ON_SCENE|TRANSPORTING|AT_HOSPITAL|RETURNING|RESTOCKING`) — absent for `AVAILABLE` vehicles
   * (already fully described by the fields above) and for `MAINTENANCE|BROKEN_DOWN|BEING_RECOVERED|OUT_OF_SERVICE|IN_DELIVERY`.
   * `dispatchable`/`blockedReason` above still describe "can this vehicle be sent right now" (always false here);
   * `chain` describes what `★POST /vehicles/:vehicleId/chain` would do for THIS incident if called now.
   */
  chain: z.object({
    vehicleStatus: VehicleStatus,
    /** True only when the vehicle is `RETURNING` AND all three chaining conditions hold: calling `chain` now redirects it immediately. */
    redirectEligible: z.boolean(),
    /** Why `redirectEligible` is false: `VEHICLE_NOT_RETURNING` (still outbound/on scene/transporting — not yet at the fork in the road),
     * `VEHICLE_INOPERABLE`, `MAINTENANCE_DUE`, `GROUNDED_BY_CONDITIONS`, `INVENTORY_NEEDS_RESTOCK`, or a crew reason
     * (`CREW_INSUFFICIENT`/`CREW_UNQUALIFIED`/`CREW_EXHAUSTED`). `null` when `redirectEligible` is true. */
    blockedReason: z.string().nullable(),
    /** Always true for a vehicle in the tracked set: `chain` always either redirects or queues. */
    queueable: z.boolean(),
    /** Best-effort ISO instant this vehicle is expected to reach AVAILABLE on its own. Known precisely only while
     * RETURNING (its planned return arrival, before any RESTOCKING stop); `null` otherwise (depends on future work). */
    availableAt: IsoDateTime.nullable(),
    /** This vehicle's crew projected through the current mission's fatigue load, against ITS OWN vehicle type's crew
     * requirement — the same `CrewPreview` shape used for an idle vehicle, so `efficiency` is directly comparable.
     * `null` when the personnel system is off. */
    crew: z.object({
      available: z.number().int(), min: z.number().int(), optimal: z.number().int(),
      missingQualifications: z.array(z.string()), maxFatigueBand: FatigueBand, efficiency: z.number(),
    }).nullable(),
    /** This vehicle's current queue slot, if any (set by a previous `chain` call that queued instead of redirecting). */
    queuedIncidentId: publicId(IdPrefix.incident).nullable(),
  }).optional(),
});
export const DispatchOptionsResult = z.object({
  options: z.array(DispatchOption),
  recommendedVehicleIds: z.array(publicId(IdPrefix.vehicle)),
  recommendationCoversRequired: z.boolean(),
});

/** POST /careers/:id/incidents/:incidentId/dispatch (Idempotency-Key) */
export const DispatchBody = z.object({ vehicleIds: z.array(publicId(IdPrefix.vehicle)).min(1).max(50) });
/** POST /careers/:id/vehicles/:vehicleId/recall */

/**
 * ★POST /careers/:id/vehicles/:vehicleId/chain (Idempotency-Key) — ONE UI action ("send this busy vehicle to a new
 * call"), driven by `DispatchOption.chain` above. The server decides the mode: `REDIRECTED` when the vehicle was
 * RETURNING and every chaining condition held at commit time (the vehicle diverts immediately, rerouted from its
 * actual current position); `QUEUED` otherwise (the vehicle keeps doing what it is doing; the moment it becomes
 * AVAILABLE again — after return and, if needed, RESTOCKING — it auto-dispatches here through the normal dispatch
 * path, which re-checks everything). Only one queue slot per vehicle: calling this again replaces it.
 */
export const ChainVehicleBody = z.object({ incidentId: publicId(IdPrefix.incident) });
export const ChainVehicleResult = z.object({
  mode: z.enum(['REDIRECTED', 'QUEUED']),
  vehicle: VehicleDto,
  /** Present when `mode === 'REDIRECTED'`: the new incident, already updated with this vehicle responding. */
  incident: IncidentDto.optional(),
  /** Present when `mode === 'QUEUED'`: this vehicle's (only) queue slot. */
  queue: z.object({ incidentId: publicId(IdPrefix.incident), queuedAt: IsoDateTime }).optional(),
});

export const IncidentOutcomeDto = z.object({
  incidentId: publicId(IdPrefix.incident),
  result: z.enum(['SUCCESS', 'PARTIAL', 'FAILURE']),
  stars: z.number().int().min(0).max(3),
  responseSeconds: z.number().int(),
  durationSeconds: z.number().int(),
  grossCredits: Amount,
  costs: z.array(z.object({ code: z.string(), amount: Amount })),
  netCredits: Amount,
  xp: Amount,
  reputationDelta: z.number(),
  notes: z.array(I18nText),
});
export type IncidentOutcomeDto = z.infer<typeof IncidentOutcomeDto>;

/* ───────────────────────────── catalog & shop ───────────────────────────── */

export const VehicleTypeDto = z.object({
  code: z.string(), family: ServiceFamily, domain: Domain, name: I18nText, description: I18nText,
  price: Amount, requiredLevel: z.number().int(), capacityPoints: z.number().int(),
  crewMin: z.number().int(), crewOptimal: z.number().int(), speedFactor: z.number(),
  deliverySeconds: z.number().int(), capabilities: z.array(CapabilityValue),
  compatibleFacilityTypes: z.array(z.string()), icon: z.string(),
  unlocked: z.boolean(), lockedReason: z.string().nullable(),
  /* additive (wave 2a) */
  movement: z.enum(['ROAD', 'ROAD_TRAILER', 'AIR']).optional(), airSpeedKmh: z.number().nullable().optional(), sirenFactor: z.number().optional(),
  preparationSeconds: z.number().optional(), tags: z.array(z.string()).optional(), shortName: I18nText.optional(),
  unlockConditions: z.array(z.record(z.unknown())).optional(),
});
export const FacilityTypeDto = z.object({
  code: z.string(), family: FacilityFamily, name: I18nText, description: I18nText, tier: z.number().int(),
  price: Amount, requiredLevel: z.number().int(), domains: z.array(Domain),
  baseCapacity: z.record(z.number().int()), icon: z.string(), unlocked: z.boolean(), lockedReason: z.string().nullable(),
  /* additive (wave 2a) */
  chain: z.string().optional(), upgradeCaps: z.record(z.number().int()).optional(), setupSeconds: z.number().int().optional(),
  promotion: z.object({ to: z.string(), cost: Amount, buildSeconds: z.number().int(), requiredUpgradeLevels: z.record(z.number().int()) }).nullable().optional(),
  effects: z.array(z.record(z.unknown())).optional(), unlockConditions: z.array(z.record(z.unknown())).optional(),
});
export const CapabilityDto = z.object({ code: z.string(), name: I18nText, icon: z.string(), group: z.string().optional() });
export const FacilityUpgradeTypeDto = z.object({
  code: z.string(), name: I18nText, description: I18nText, requiredLevel: z.number().int(), basePrice: Amount, costGrowth: z.number(), baseBuildSeconds: z.number().int(),
  buildGrowth: z.number(), maxLevel: z.number().int(), effect: z.object({ domain: z.string(), delta: z.number().int() }),
});
export const UngUnitTypeDto = z.object({ code: z.string(), name: I18nText, icon: z.string(), keepsRoadClosed: z.boolean() });
export const IncidentTemplateSummaryDto = z.object({
  code: z.string(), category: z.string(), primaryFamily: ServiceFamily, families: z.array(ServiceFamily), requiredLevel: z.number().int(), rarity: z.string().nullable(),
  title: I18nText, icon: z.string(), severityMin: z.number().int(), severityMax: z.number().int(), unlocked: z.boolean(),
});
export const CatalogDto = z.object({
  version: z.string(),
  families: z.array(z.object({
    code: ServiceFamily, name: I18nText, color: z.string(), requiredLevel: z.number().int(),
    /* additive (wave 2a): `requiredLevel` is already resolved for THIS career (WILDFIRE/ALPINE depend on the territory). */
    icon: z.string().optional(), playerManaged: z.boolean().optional(), unlocked: z.boolean().optional(), spawnsIncidents: z.boolean().optional(),
  })),
  capabilities: z.array(CapabilityDto), vehicleTypes: z.array(VehicleTypeDto), facilityTypes: z.array(FacilityTypeDto),
  /* ── additive (wave 2a) ── */
  /** Content hash: version of `GET /public/i18n/catalog/:locale?v=<hash>`. Text keys are relative to that bundle. */
  i18nHash: z.string().optional(),
  facilityUpgrades: z.array(FacilityUpgradeTypeDto).optional(),
  ungUnitTypes: z.array(UngUnitTypeDto).optional(),
  incidentTemplates: z.array(IncidentTemplateSummaryDto).optional(),
  levels: z.array(z.object({ level: z.number().int(), xpToNext: Amount, stipendBase: Amount, levelUpCredits: Amount, maxActiveIncidents: z.number().int() })).optional(),
  ranks: z.array(z.object({ code: z.string(), fromLevel: z.number().int(), toLevel: z.number().int(), name: I18nText })).optional(),
  features: z.array(z.object({ feature: z.string(), requiredLevel: z.number().int(), unlocked: z.boolean() })).optional(),
  /** Raw catalog sections for the systems of the next wave (shape = catalog/README.md). */
  items: z.array(z.record(z.unknown())).optional(),
  roles: z.array(z.record(z.unknown())).optional(),
  qualifications: z.array(z.record(z.unknown())).optional(),
  courses: z.array(z.record(z.unknown())).optional(),
});

/** POST /careers/:id/shop/vehicles (Idempotency-Key) */
export const BuyVehicleBody = z.object({ vehicleTypeCode: z.string(), facilityId: publicId(IdPrefix.facility) });
/** POST /careers/:id/facilities/:facilityId/upgrades (Idempotency-Key) */
export const BuyUpgradeBody = z.object({ upgradeCode: z.string() });
/** POST /careers/:id/facilities (Idempotency-Key) */
export const AcquireFacilityBody = z.object({ siteId: publicId(IdPrefix.site), facilityTypeCode: z.string() });

export const LedgerEntryDto = z.object({
  id: z.string(), amount: Amount, balanceAfter: Amount, entryType: z.string(),
  description: I18nText, createdAt: IsoDateTime,
});

/* ───────────────────────────── sync snapshot ───────────────────────────── */

export const WorldContextDto = z.object({
  localTime: IsoDateTime, timezone: z.string(), dayPhase: DayPhase,
  weather: z.object({ code: WeatherCode, temperatureC: z.number().nullable(), windKmh: z.number().nullable(), degraded: z.boolean() }),
  trafficLevel: z.enum(['FREE_FLOW', 'LIGHT', 'MODERATE', 'HEAVY', 'SEVERE']),
  closures: z.array(z.object({
    id: z.string(), polygon: z.array(LngLat), reason: I18nText, endsAt: IsoDateTime.nullable(),
    /* additive */ kind: z.enum(['PARTIAL', 'FULL']).optional(), multiplier: z.number().optional(), incidentId: z.string().nullable().optional(),
  })),
  /* ── additive (wave 2a) ── */
  hourBand: z.string().optional(), season: z.string().optional(), weekdayType: z.string().optional(),
  trafficMultiplier: z.number().optional(),
  weatherCell: z.string().nullable().optional(), weatherObservedAt: IsoDateTime.nullable().optional(), weatherSource: z.string().optional(),
  /** Dynamic risk multipliers by risk kind (road, wildfire, flood…), weather × events. */
  riskMultipliers: z.record(z.number()).optional(),
  events: z.array(z.object({ id: z.string(), type: z.string(), title: I18nText, startsAt: IsoDateTime, endsAt: IsoDateTime, effects: z.record(z.unknown()) })).optional(),
});

/** GET /careers/:id/sync → full operational snapshot; `seq` is the last realtime sequence included. */
export const SyncSnapshot = z.object({
  seq: z.number().int(),
  career: CareerSummary,
  facilities: z.array(FacilityDto),
  vehicles: z.array(VehicleDto),
  incidents: z.array(IncidentDto),
  world: WorldContextDto,
  pendingOutcomes: z.array(IncidentOutcomeDto),
  unreadNotifications: z.number().int(),
  featureFlags: z.record(z.boolean()),
  configVersion: z.string(),
});
export type SyncSnapshot = z.infer<typeof SyncSnapshot>;

/** GET /careers/:id/away-report */
export const AwayReport = z.object({
  since: IsoDateTime, incidentsResolved: z.number().int(), incidentsFailed: z.number().int(),
  creditsEarned: Amount, xpEarned: Amount, stipendPaid: Amount, events: z.array(I18nText),
});

/* ───────────────────────────── realtime ───────────────────────────── */

export const RealtimeEventType = z.enum([
  'career.updated', 'credits.changed', 'xp.awarded', 'level.reached', 'unlock.granted', 'stipend.paid',
  'incident.created', 'incident.updated', 'incident.escalated', 'incident.resolved', 'incident.failed', 'incident.expired', 'incident.cancelled',
  'vehicle.updated', 'vehicle.departed', 'vehicle.arrived', 'vehicle.returning', 'vehicle.returned', 'vehicle.broke_down', 'vehicle.delivered',
  'facility.updated', 'personnel.updated', 'patient.updated', 'inventory.updated', 'maintenance.updated',
  'world.updated', 'notification.created', 'config.updated',
]);
export type RealtimeEventType = z.infer<typeof RealtimeEventType>;

/** Socket.IO namespace "/game", single event name "event". Auth: handshake.auth = { accessToken, careerId }. */
export const SOCKET_NAMESPACE = '/game';
export const SOCKET_EVENT = 'event';
export const RealtimeEnvelope = z.object({
  type: RealtimeEventType,
  v: z.literal(1),
  careerId: publicId(IdPrefix.career),
  seq: z.number().int(),
  occurredAt: IsoDateTime,
  serverTime: IsoDateTime,
  /** Payload carries the full updated DTO(s): { incident?, vehicle?, vehicles?, career?, outcome?, … }. */
  payload: z.record(z.unknown()),
});
export type RealtimeEnvelope = z.infer<typeof RealtimeEnvelope>;
