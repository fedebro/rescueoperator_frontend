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
});
export const DispatchOptionsResult = z.object({
  options: z.array(DispatchOption),
  recommendedVehicleIds: z.array(publicId(IdPrefix.vehicle)),
  recommendationCoversRequired: z.boolean(),
});

/** POST /careers/:id/incidents/:incidentId/dispatch (Idempotency-Key) */
export const DispatchBody = z.object({ vehicleIds: z.array(publicId(IdPrefix.vehicle)).min(1).max(50) });
/** POST /careers/:id/vehicles/:vehicleId/recall */

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
});
export const FacilityTypeDto = z.object({
  code: z.string(), family: FacilityFamily, name: I18nText, description: I18nText, tier: z.number().int(),
  price: Amount, requiredLevel: z.number().int(), domains: z.array(Domain),
  baseCapacity: z.record(z.number().int()), icon: z.string(), unlocked: z.boolean(), lockedReason: z.string().nullable(),
});
export const CapabilityDto = z.object({ code: z.string(), name: I18nText, icon: z.string() });
export const CatalogDto = z.object({
  version: z.string(), families: z.array(z.object({ code: ServiceFamily, name: I18nText, color: z.string(), requiredLevel: z.number().int() })),
  capabilities: z.array(CapabilityDto), vehicleTypes: z.array(VehicleTypeDto), facilityTypes: z.array(FacilityTypeDto),
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
  closures: z.array(z.object({ id: z.string(), polygon: z.array(LngLat), reason: I18nText, endsAt: IsoDateTime.nullable() })),
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
