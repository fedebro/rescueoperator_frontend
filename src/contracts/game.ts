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
  /* water-supply aircraft refill (additive): the water run between two drops on the same incident. */
  'TO_WATER_SOURCE', 'AT_WATER_SOURCE',
  /* AIR-domain taxi + takeoff (additive): between PREPARING and EN_ROUTE, only for helicopters/planes. */
  'TAXIING', 'TAKING_OFF',
]);
export type VehicleStatus = z.infer<typeof VehicleStatus>;

export const DispatchVehicleStatus = z.enum([
  'PREPARING', 'EN_ROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_HOSPITAL', 'RETURNING',
  'DONE', 'RECALLED', 'BROKEN_DOWN', 'CANCELLED',
  'TO_WATER_SOURCE', 'AT_WATER_SOURCE',
  'TAXIING', 'TAKING_OFF',
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

/* ── water (D-23 [U] / D-68 [C], analisi/note-agenti/water-backend.md) ── */

/** Water body kinds of the geodata (schema 1.1.0): open sea, lake / reservoir, river / canal. */
export const WaterBodyKind = z.enum(['SEA', 'LAKE', 'RIVER']);
export type WaterBodyKind = z.infer<typeof WaterBodyKind>;

/**
 * A nautical site / a Base nautica (D-23: boats live only in a "Base nautica", bought on nautical sites — harbours, seafront,
 * main lakes). `position` of the site/facility stays the road-side point; the boats start from `berth`, on the water.
 */
export const SiteNauticalDto = z.object({
  waterBody: WaterBodyKind.exclude(['RIVER']),
  /** Stable water body id (`sea:adriatic`, `lake:osm:w17671525`…): a base serves incidents on the same body directly. */
  waterBodyId: z.string(),
  waterBodyName: z.string().nullable(),
  berth: LngLat,
});
export type SiteNauticalDto = z.infer<typeof SiteNauticalDto>;

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
  /** Additive (water): set on a Base nautica — its water body and the berth on the water its boats start from. */
  nautical: SiteNauticalDto.nullable().optional(),
});
export type FacilityDto = z.infer<typeof FacilityDto>;

/**
 * One piece of a boat's mixed leg (additive, D-68): `ROAD` = on the trailer by road (draw solid), `LAUNCH` / `RECOVERY` =
 * stationary at a launch point while the boat is put into / taken out of the water, `WATER` = straight line on the water
 * (draw dashed). Segments tile the movement: the first departs at `movement.departAt`, the last arrives at `arriveAt`.
 */
export const MovementSegmentDto = z.object({
  mode: z.enum(['ROAD', 'LAUNCH', 'WATER', 'RECOVERY']),
  /** ≥ 2 points for ROAD/WATER; a single point (where it stands) for LAUNCH/RECOVERY. */
  path: z.array(LngLat).min(1),
  departAt: IsoDateTime,
  arriveAt: IsoDateTime,
  distanceMeters: z.number(),
});
export type MovementSegmentDto = z.infer<typeof MovementSegmentDto>;

/** A movement leg the client interpolates: position = along(path, (now-departAt)/(arriveAt-departAt)). */
export const MovementDto = z.object({
  path: LineCoords,
  departAt: IsoDateTime,
  arriveAt: IsoDateTime,
  distanceMeters: z.number(),
  purpose: z.enum(['TO_INCIDENT', 'TO_HOSPITAL', 'TO_BASE', 'DELIVERY', 'RECOVERY', 'TO_WATER_SOURCE', 'TAXIING', 'PATROLLING']),
  /**
   * Additive (water): a boat's leg by trailer + launch + water (or back). When present, interpolate inside the segment that
   * contains `now` instead of along the whole `path` (the road and the water parts do not move at the same speed, and the
   * launch is a pause). Absent for every other vehicle.
   */
  segments: z.array(MovementSegmentDto).optional(),
});
export type MovementDto = z.infer<typeof MovementDto>;

/**
 * Vehicle autonomy (D-22 [U] / D-67, additive): onboard stock + fuel in game km, and the ONE resupply rule evaluated now.
 * Labels ship in the catalog i18n bundle under `autonomy.*` (e.g. `autonomy.fuel`, `autonomy.missionsLeft` with `{count}`).
 */
export const VehicleAutonomyDto = z.object({
  /** Which halves are active for this career: onboard stock from level 2, fuel from level 3 (config `depth.autonomy`). */
  unlocked: z.object({ stock: z.boolean(), fuel: z.boolean() }),
  /** `null` while fuel is not tracked for this vehicle: locked by level (fuel from level 3), foot teams. */
  fuel: z.object({
    /** Autonomy left in `unit` (one decimal): game km, or minutes of flight for helicopters and the AIB plane. */
    km: z.number(),
    /** A full tank in `unit`. */
    rangeKm: z.number(),
    /** km / rangeKm, 0..1. */
    ratio: z.number(),
    /**
     * Under the reserve light (fuelReserveRatio). For an aircraft the reserve it never flies into: over the scene it turns
     * back to refuel when the endurance left is the flight home + this reserve.
     */
    reserve: z.boolean(),
    /** Under the resupply threshold: the next stop at base refuels. */
    low: z.boolean(),
    /**
     * Additive (flight endurance, analisi/note-agenti/air-endurance.md): the unit of `km` / `rangeKm` — `KM` (game km of a
     * road/water tank) or `MIN` (REAL minutes of flight of a helicopter / the AIB plane; label `autonomy.flight`, value
     * `autonomy.flightMinutes` with `{count}`). Absent = `KM`.
     */
    unit: z.enum(['KM', 'MIN']).optional(),
  }).nullable(),
  /** One line per item carried at this level (empty below level 2, or for a vehicle that carries nothing). */
  items: z.array(z.object({ itemCode: z.string(), quantity: z.number().int(), capacity: z.number().int(), low: z.boolean() })),
  /** Average missions left before the next resupply stop (the minimum over fuel and items); `null` when nothing is tracked. */
  missionsLeftEstimate: z.number().int().nullable(),
  /** The single resupply rule, now: true = the next stop at base resupplies (items that the shelf can refill, or fuel). */
  needsResupply: z.boolean(),
  /** A manual "return to resupply" is pending: applied at the next stop at base. */
  resupplyRequested: z.boolean(),
});
export type VehicleAutonomyDto = z.infer<typeof VehicleAutonomyDto>;

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
  /** Autonomy (additive, D-22): always present with the YAML catalog; absent only without depth content (core-loop tests). */
  autonomy: VehicleAutonomyDto.optional(),
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
  /** Additive (water): who covers an `external` need — `FAMILY` (service locked / not owned yet) or `COAST_GUARD` (no boat able to do the water part). */
  externalSource: z.enum(['FAMILY', 'COAST_GUARD', /* major incidents: fully covered by an external reinforcement column */ 'REINFORCEMENTS']).nullable().optional(),
  /**
   * Additive (water incidents only): where this need is served — `WATER` on the scene (boats, aircraft) or `SHORE` at the
   * meeting point (land units deliver only their shore-side capabilities there). Absent on land incidents.
   */
  side: z.enum(['WATER', 'SHORE']).optional(),
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

/* ── major incidents (D-24 [U] / D-69 [C], analisi/note-agenti/major-incidents.md) — the full DTO lives in major.ts ── */

/** Phases of a major incident: ALARM → CONTAINMENT → RESCUE → SECURING, then ENDED. Labels: catalog bundle `major.phase.<P>.name`. */
export const MajorPhase = z.enum(['ALARM', 'CONTAINMENT', 'RESCUE', 'SECURING', 'ENDED']);
export type MajorPhase = z.infer<typeof MajorPhase>;
/** `MAIN` = the main scene, `SUB` = a linked incident spawned around it (phase, growth or a catalog secondary). */
export const MajorMemberRole = z.enum(['MAIN', 'SUB']);
export type MajorMemberRole = z.infer<typeof MajorMemberRole>;
/**
 * Compact reference carried by every incident that belongs to a major incident (`IncidentDto.major`): enough to badge the
 * incident card, draw the event area and the link lines on the map, and open `GET /major-incidents/:id` for the full view.
 */
export const MajorIncidentRefDto = z.object({
  id: publicId(IdPrefix.majorIncident),
  scenarioCode: z.string(),
  title: I18nText,
  role: MajorMemberRole,
  phase: MajorPhase,
  /** The main scene (null only in the instant before it exists). */
  mainIncidentId: publicId(IdPrefix.incident).nullable(),
  /** 0 = main scene, 1…n = linked incidents in creation order (label `major.sector.sub` with `{count}`). */
  sector: z.number().int(),
  center: LngLat,
  areaRadiusMeters: z.number().int(),
});
export type MajorIncidentRefDto = z.infer<typeof MajorIncidentRefDto>;

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
  /* ── additive (water scene, D-68 — analisi/note-agenti/water-backend.md) ── */
  /** `WATER`: the incident is on the water (sea, lake, river): draw the marker at `scenePosition`, show the water badge. */
  domain: z.enum(['LAND', 'WATER']).optional(),
  /** The water body of the scene (`id`/`name` null for water incidents created before the water geodata). Null on land. */
  waterBody: z.object({ type: WaterBodyKind, id: z.string().nullable(), name: z.string().nullable() }).nullable().optional(),
  /**
   * Where the incident really is — the map marker, where boats and aircraft go. For a water incident a point on the water;
   * for a land incident the same as `position`.
   */
  scenePosition: LngLat.optional(),
  /**
   * Water incidents: the meeting point on the shore road where land units stop and the boat lands the rescued (= `position`,
   * which keeps meaning "where land units are routed"). Null on land incidents.
   */
  meetingPoint: LngLat.nullable().optional(),
  /**
   * Display line of the place, coherent with the radio text: water incidents "Al largo di <address>" / "<lake>, davanti a …"
   * / "<river>, all'altezza di …" (catalog bundle `water.place.*`, params `place`, `water`). Absent on land incidents: show `address`.
   */
  placeText: I18nText.optional(),
  /**
   * External support on the water (D-68): the career has no boat able to do the water part, so the Coast Guard covers the
   * listed capabilities (their requirements are `external`, `externalSource: 'COAST_GUARD'`). The land part at the meeting
   * point stays the player's; the reward is multiplied by `rewardShare`; never an automatic failure. Null otherwise.
   * `recoveryAt` (additive, water patients — analisi/note-agenti/water-patients.md): when the Coast Guard lands at the meeting
   * point the people still in the water (null/absent when the incident has no patient to recover; an instant in the past = done).
   */
  waterSupport: z.object({
    provider: z.literal('COAST_GUARD'), name: I18nText, capabilities: z.array(z.string()), rewardShare: z.number(), recoveryAt: IsoDateTime.nullable().optional(),
  }).nullable().optional(),
  /* ── additive (major incidents, D-24/D-69) ── */
  /** Set when the incident belongs to a major incident (main scene or linked incident); null/absent otherwise. */
  major: MajorIncidentRefDto.nullable().optional(),
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
    missingQualifications: z.array(z.string()), missingRoles: z.array(z.string()), maxFatigueBand: FatigueBand, efficiency: z.number(),
    /** Only meaningful (non-null) while `maxFatigueBand === 'REST_REQUIRED'` and the crew is short of `min`: seconds
     * until enough operators have recovered to reach the minimum. */
    restUntilSeconds: z.number().nullable(),
  }).optional(),
  /**
   * Autonomy for THIS incident (additive, D-22). Present for AVAILABLE vehicles once the stock or fuel half is unlocked.
   * Matching `warnings`: `RESUPPLY_BEFORE_DEPARTURE` (at base, reloads first — time already in `etaSeconds`),
   * `FUEL_RESERVE` (away from base without fuel for there + back), `FUEL_RANGE_INSUFFICIENT` (too far even with a full
   * tank), `LAST_MISSION_BEFORE_RESUPPLY`. The first three keep the vehicle out of the recommendation, never out of reach.
   * Aircraft (flight endurance, `fuelUnit: 'MIN'`): `FUEL_RANGE_INSUFFICIENT` = not enough endurance for there + back + a
   * minimal time over the scene with the reserve intact (flagged, still selectable); when not even there and back fit, the
   * option is not dispatchable at all: `blockedReason: 'ENDURANCE_INSUFFICIENT'` (label `autonomy.blocked.ENDURANCE_INSUFFICIENT`).
   */
  autonomy: z.object({
    /**
     * Fuel this incident needs, in `fuelUnit`: there + back to base + the on-scene estimate (game km). For an aircraft: there
     * + back + the minimal time over the scene + the reserve (longer operations rotate: at its reserve the aircraft turns back
     * to refuel and resumes). `null` = fuel not tracked.
     */
    fuelNeededKm: z.number().nullable(),
    /** Fuel on board now, in `fuelUnit`. `null` = fuel not tracked. */
    fuelKm: z.number().nullable(),
    /** Enough fuel for there + back once the refuel-before-departure (if any) is done. */
    enoughFuel: z.boolean(),
    /** Real seconds of resupply at base before leaving (already included in `etaSeconds`); 0 = leaves straight away. */
    resupplyBeforeDepartureSeconds: z.number().int(),
    /** This mission would leave the vehicle needing a resupply stop afterwards. */
    lastMissionBeforeResupply: z.boolean(),
    /** Additive: unit of `fuelNeededKm` / `fuelKm` — `KM` or `MIN` (minutes of flight). Absent = `KM`. */
    fuelUnit: z.enum(['KM', 'MIN']).optional(),
    /**
     * Additive (aircraft only): REAL minutes it can stay over the scene before turning back to refuel (after the refuel before
     * departure, if any; label `autonomy.onSceneFor` with `{count}`). `null` = no limit or not an aircraft.
     */
    onSceneMinutes: z.number().nullable().optional(),
  }).optional(),
  /**
   * Additive (water incidents only): where this vehicle would go — `SCENE` (boats, aircraft: the point on the water) or
   * `MEETING_POINT` (land units: the shore road, where they deliver only their shore-side capabilities).
   */
  destination: z.enum(['SCENE', 'MEETING_POINT']).optional(),
  /**
   * Additive (boats only): how the boat gets there. `DIRECT` = from its berth on the same water; `TRAILER` = by road to a
   * launch point (slipway, harbour or another Base nautica) on the incident's water, launched, then by water; `BANK` = by
   * road to the bank next to the meeting point (rivers without a slipway nearby). The seconds are already in `etaSeconds`.
   */
  boatRoute: z.object({
    kind: z.enum(['DIRECT', 'TRAILER', 'BANK']),
    roadMeters: z.number(),
    waterMeters: z.number(),
    launchSeconds: z.number().int(),
    launchPoint: z.object({ name: z.string().nullable(), position: LngLat }).nullable(),
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
     * `VEHICLE_RESTOCKING` (resupplying at base: queue only), `VEHICLE_INOPERABLE`, `MAINTENANCE_DUE`, `GROUNDED_BY_CONDITIONS`,
     * `INVENTORY_NEEDS_RESTOCK` (the single resupply rule wants a stop at base for items the shelf can refill), `FUEL_RESERVE`
     * (not enough fuel and no fuel station in reach), or a crew reason (`CREW_INSUFFICIENT`/`CREW_UNQUALIFIED`/`CREW_EXHAUSTED`).
     * `null` when `redirectEligible` is true. */
    blockedReason: z.string().nullable(),
    /** Always true for a vehicle in the tracked set: `chain` always either redirects or queues. */
    queueable: z.boolean(),
    /** Best-effort ISO instant this vehicle is expected to reach AVAILABLE on its own: while RETURNING its planned return
     * arrival PLUS the resupply stop the single rule predicts; while RESTOCKING the end of the stop; `null` otherwise. */
    availableAt: IsoDateTime.nullable(),
    /** Phase 2 (additive): the redirect would first detour to a fuel station (fuel only). `extraSeconds` is already in the
     * new leg's ETA; `premium` is the credit surcharge over the refilled km (refuelling at base is free). */
    fuelStop: z.object({ extraSeconds: z.number().int(), premium: Amount }).nullable().optional(),
    /** This vehicle's crew projected through the current mission's fatigue load, against ITS OWN vehicle type's crew
     * requirement — the same `CrewPreview` shape used for an idle vehicle, so `efficiency` is directly comparable.
     * `null` when the personnel system is off. */
    crew: z.object({
      available: z.number().int(), min: z.number().int(), optimal: z.number().int(),
      missingQualifications: z.array(z.string()), missingRoles: z.array(z.string()), maxFatigueBand: FatigueBand, efficiency: z.number(), restUntilSeconds: z.number().nullable(),
    }).nullable(),
    /** This vehicle's current queue slot, if any (set by a previous `chain` call that queued instead of redirecting). */
    queuedIncidentId: publicId(IdPrefix.incident).nullable(),
  }).optional(),
});
export const DispatchOptionsResult = z.object({
  options: z.array(DispatchOption),
  recommendedVehicleIds: z.array(publicId(IdPrefix.vehicle)),
  recommendationCoversRequired: z.boolean(),
  /**
   * Additive (major incidents): how many vehicles ONE dispatch command may send to this incident — the normal limit (12), more
   * for the incidents of a major incident (24). The recommendation never lists more; a larger scene takes a second dispatch.
   */
  maxVehiclesPerDispatch: z.number().int().positive().optional(),
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

/**
 * ★POST /careers/:id/vehicles/:vehicleId/resupply (Idempotency-Key, no body) — manual "return to resupply" (D-22 §3.4).
 * `RESTOCKING`: at base, the stop started now (`until` = its end). `RETURNING_TO_BASE`: out on patrol, heads home at its next
 * hop and resupplies there. `SCHEDULED_ON_RETURN`: on a mission's return leg, resupplies as soon as it is back.
 * `ALREADY_FULL` / `ALREADY_RESUPPLYING`: nothing to do (replaying the command is harmless). Refused with
 * `VEHICLE_NOT_AVAILABLE` (409) while the vehicle is committed to an incident or in the workshop.
 */
export const ResupplyVehicleResult = z.object({
  mode: z.enum(['RESTOCKING', 'RETURNING_TO_BASE', 'SCHEDULED_ON_RETURN', 'ALREADY_FULL', 'ALREADY_RESUPPLYING']),
  vehicle: VehicleDto,
  /** End of the resupply stop when `mode` is RESTOCKING or ALREADY_RESUPPLYING. */
  until: IsoDateTime.nullable(),
});
export type ResupplyVehicleResult = z.infer<typeof ResupplyVehicleResult>;

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
  /* additive: which incident this refers to — the outcome can outlive the incident's own entry in the active list */
  address: z.string().optional(),
  templateName: I18nText.optional(),
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
  /** Additive (water): cruise speed of a boat on the water, km/h; null for every other vehicle. */
  waterSpeedKmh: z.number().nullable().optional(),
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
export const CapabilityDto = z.object({
  code: z.string(), name: I18nText, icon: z.string(), group: z.string().optional(),
  /** Additive (water): a land unit delivers it from the meeting point of a water incident; anything else needs a boat on the scene. */
  shoreSide: z.boolean().optional(),
});
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
    /** A large wildfire's own evolving burn area, rendered distinctly from a generic road closure. */
    hazard: z.enum(['WILDFIRE']).optional(),
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
  /** Additive (major incidents, D-24/D-69): the running major incident, if any — fetch `GET /major-incidents/current` for the full view. */
  activeMajorIncidentId: publicId(IdPrefix.majorIncident).nullable().optional(),
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
