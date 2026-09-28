import type { I18nText, IncidentDto, VehicleDto } from '@/contracts';
import { haversineMeters, type LngLat } from '@/lib/geo';
import {
  INCIDENT_TEMPLATES,
  SHORE_CAPABILITIES,
  VEHICLE_TYPES,
  bandFor,
  type MockIncidentTemplate,
  type WaterBodyType,
} from '../data/catalog';
import { LAUNCH_POINTS, WATER_BODIES, WATER_POINTS, type MockWaterPoint } from '../data/water';
import {
  MockError,
  sceneOf,
  text,
  type DispatchLeg,
  type MockCareer,
  type MockEngine,
  type MockLeg,
  type MockLegSegment,
  type SpawnOptions,
  type SpawnPlace,
} from '../engine';
import type { QaHelpers } from '../qa';
import { domainState } from './index';

/**
 * Water scene of the mock — the same rules as the backend (analisi/note-agenti/water-backend.md, D-23 [U] / D-68 [C]):
 *
 * - a water incident has its SCENE on the water (marker, boats, aircraft) and a MEETING POINT on the shore road (`position`:
 *   land units, the ambulance that takes the rescued to hospital); land units there deliver only their shore-side capabilities;
 * - the Coast Guard covers every water-side need of a SEA incident the career's boats cannot do (reward and XP × 0.6);
 * - a water template spawns only when the career's boats can do its REQUIRED water part, or on the sea when the Coast Guard
 *   covers it and a REQUIRED shore-side need of an owned family is left for the player (weight × 0.5);
 * - boats: same water as their Base nautica → straight from the berth (`DIRECT`); another water → trailer to the nearest launch
 *   point within 2.5 km of the scene (`TRAILER`) or launched from the bank at the meeting point (`BANK`); back home they land the
 *   rescued at the meeting point's shore first. Their legs carry segments (ROAD / LAUNCH / WATER / RECOVERY).
 */
export const WATER_KNOBS = {
  coastGuard: { waterBodies: ['SEA'] as WaterBodyType[], rewardShare: 0.6, spawnWeight: 0.5 },
  /** Server seconds (before the demo speed-up), like the backend's `depth.water`. */
  launchSeconds: 40,
  recoverySeconds: 30,
  bankLaunchMaxMeters: 2500,
  adminSearchRadiusMeters: 20_000,
  landAtMeetingPoint: true,
  /** Default water speed of a boat type without `waterSpeedKmh` (never shipped: the catalog validates it). */
  defaultWaterSpeedKmh: 40,
};
const AIR_SUPPORT = 'AIR_SUPPORT';
/** The mock's travel compression (D-63), the same factor as `MockEngine.travelSeconds`. */
const TRAVEL_COMPRESSION = 0.25;

interface WaterState {
  /** Per water incident: the meeting point and the water's edge where boats land the rescued (kept after it closes). */
  incidents: Record<string, { meetingPoint: LngLat; landing: LngLat | null; pointKey: string }>;
}
const stateOf = (career: MockCareer): WaterState =>
  domainState<WaterState>(career, 'water', () => ({ incidents: {} }));

const typeOf = (code: string) => VEHICLE_TYPES.find((t) => t.code === code);
export const isShoreCapability = (code: string): boolean => SHORE_CAPABILITIES.has(code);
export const isBoat = (v: Pick<VehicleDto, 'typeCode'>): boolean => typeOf(v.typeCode)?.domain === 'WATER';
export const isWaterTemplate = (t: Pick<MockIncidentTemplate, 'water'>): boolean => t.water !== null;
const bodyType = (p: MockWaterPoint): WaterBodyType => WATER_BODIES[p.bodyId]!.type;

type Requirement = { capability: string; level: string; family: string | null };

/** What the career's boats can do on the water, together (a boat of any status but OUT_OF_SERVICE). */
export function boatCapabilities(career: MockCareer): Set<string> {
  const out = new Set<string>();
  for (const v of career.vehicles) {
    if (v.status === 'OUT_OF_SERVICE' || !isBoat(v)) continue;
    for (const [code, value] of Object.entries(typeOf(v.typeCode)!.caps)) if (value > 0) out.add(code);
  }
  return out;
}

const requiredWaterSide = (requirements: readonly Requirement[]): string[] =>
  requirements
    .filter((r) => r.level === 'REQUIRED' && r.capability !== AIR_SUPPORT && !isShoreCapability(r.capability))
    .map((r) => r.capability);

/** The career's boats, together, can do every REQUIRED water-side need (the number of boats is gameplay, not a gate). */
export const boatsCanServe = (requirements: readonly Requirement[], boats: ReadonlySet<string>): boolean =>
  requiredWaterSide(requirements).every((c) => boats.has(c));

const coastGuardServes = (water: WaterBodyType | null | undefined): boolean =>
  !!water && WATER_KNOBS.coastGuard.waterBodies.includes(water);

/** Water bodies that have at least one point in the mock world (Pescara: the sea and the river). */
const bodiesWithPoints = (): Set<WaterBodyType> => new Set(WATER_POINTS.map(bodyType));

/**
 * The generation gate of a water template (backend `waterSpawnVerdict`): with boats able to do the water part, every water
 * the template allows; without, only the waters the Coast Guard serves — and only when a REQUIRED shore-side need of an
 * owned family is left for the player's land units, or the incident would give him nothing to do.
 */
export function spawnVerdict(
  career: MockCareer,
  t: MockIncidentTemplate,
): { bodies: WaterBodyType[]; coastGuardOnly: boolean } {
  const allowed = (t.water?.bodies ?? []).filter((b) => bodiesWithPoints().has(b));
  const level = career.summary.level;
  const atLevel = t.bands.filter((b) => b.minLevel <= level).flatMap((b) => b.requirements);
  if (boatsCanServe(atLevel, boatCapabilities(career))) return { bodies: allowed, coastGuardOnly: false };
  const first = t.bands[0]?.requirements ?? [];
  const playerPart = first.some(
    (r) =>
      r.level === 'REQUIRED' &&
      isShoreCapability(r.capability) &&
      career.summary.unlockedFamilies.includes(r.family),
  );
  if (!playerPart) return { bodies: [], coastGuardOnly: false };
  const bodies = allowed.filter(coastGuardServes);
  return { bodies, coastGuardOnly: bodies.length > 0 };
}

/**
 * "Al largo di …" — the place line of a water incident, coherent with the radio text (catalog bundle `water.place.*`,
 * params `place` = the display address and `water` = the name of a lake / river).
 */
export function waterPlaceText(
  water: { type: WaterBodyType; name: string | null },
  address: string,
): I18nText {
  const named = water.type !== 'SEA' && water.name ? water.name : null;
  const key =
    water.type === 'SEA' ? 'water.place.SEA' : `water.place.${water.type}${named ? '' : '_UNNAMED'}`;
  const fallback =
    water.type === 'SEA'
      ? `Al largo di ${address}`
      : water.type === 'LAKE'
        ? `${named ?? 'Sul lago'}, davanti a ${address}`
        : `${named ?? 'Sul fiume'}, all’altezza di ${address}`;
  return { key, params: { place: address, ...(named ? { water: named } : {}), fallback } };
}

/**
 * Decorates a water incident right after it exists (backend `createIncident` + `toDto`): who covers each need (FAMILY /
 * COAST_GUARD), on which side it is served (WATER / SHORE), the Coast Guard block, the place text, the reward × share.
 */
export function decorateWaterIncident(
  engine: MockEngine,
  career: MockCareer,
  incident: IncidentDto,
  point: MockWaterPoint,
): IncidentDto {
  const template = INCIDENT_TEMPLATES.find((t) => t.code === incident.templateCode)!;
  const band = bandFor(template, incident.severity);
  const water = WATER_BODIES[point.bodyId]!;
  const coastGuard =
    coastGuardServes(water.type) &&
    !boatsCanServe(
      band.requirements.map((r) => ({ capability: r.capability, level: r.level, family: r.family })),
      boatCapabilities(career),
    );
  stateOf(career).incidents[incident.id] = {
    meetingPoint: point.snapped,
    landing: point.shore ?? point.snapped,
    pointKey: point.key,
  };
  const requirements = incident.requirements.map((r) => {
    const waterSide = !isShoreCapability(r.capability);
    const externalSource =
      coastGuard && waterSide && r.capability !== AIR_SUPPORT
        ? ('COAST_GUARD' as const)
        : (r.externalSource ?? null);
    return {
      ...r,
      external: externalSource !== null,
      externalSource,
      side: waterSide ? ('WATER' as const) : ('SHORE' as const),
    };
  });
  const share = coastGuard ? WATER_KNOBS.coastGuard.rewardShare : 1;
  const scaled = (amount: string) => String(Math.round(Number(amount) * share));
  return engine.patchIncident(career, incident.id, {
    requirements,
    placeText: waterPlaceText(water, incident.address),
    waterSupport: coastGuard
      ? {
          provider: 'COAST_GUARD',
          name: text('water.coastGuard.name'),
          capabilities: requirements
            .filter((r) => r.externalSource === 'COAST_GUARD')
            .map((r) => r.capability),
          rewardShare: share,
        }
      : null,
    estimatedReward: {
      min: scaled(incident.estimatedReward.min),
      max: scaled(incident.estimatedReward.max),
    },
  })!;
}

/** A water point for a water template: random, near a position (admin / QA), or beyond a distance (QA). */
function pickWaterPoint(
  engine: MockEngine,
  career: MockCareer,
  t: MockIncidentTemplate,
  opts: SpawnOptions,
): MockWaterPoint {
  let bodies = opts.organic ? spawnVerdict(career, t).bodies : (t.water?.bodies ?? []);
  if (opts.waterBody) bodies = bodies.filter((b) => b === opts.waterBody);
  const eligible = WATER_POINTS.filter((p) => bodies.includes(bodyType(p)));
  const used = new Set(career.incidents.map((i) => sceneOf(i).join(',')));
  const free = eligible.filter((p) => !used.has(p.position.join(',')));
  const pool = free.length > 0 ? free : eligible;
  const noPoint = () =>
    new MockError(400, 'VALIDATION_ERROR', 'No water point for this template near there', {
      reason: 'NO_WATER_POINT',
    });
  if (pool.length === 0) throw noPoint();
  if (opts.position) {
    const nearest = [...pool].sort(
      (a, b) => haversineMeters(opts.position!, a.position) - haversineMeters(opts.position!, b.position),
    )[0]!;
    if (haversineMeters(opts.position, nearest.position) > WATER_KNOBS.adminSearchRadiusMeters)
      throw noPoint();
    return nearest;
  }
  if (opts.minDistanceMeters !== undefined) {
    const base = career.facilities[0]!.position;
    const sorted = [...pool].sort(
      (a, b) => haversineMeters(base, a.position) - haversineMeters(base, b.position),
    );
    return sorted.find((p) => haversineMeters(base, p.position) >= opts.minDistanceMeters!) ?? sorted.at(-1)!;
  }
  return pool[Math.floor(engine.random() * pool.length)] ?? pool[0]!;
}

/* ───────────── boat legs ───────────── */

/** A straight water leg: server seconds at `speedKmh`, compressed like every travel leg (min 5 s when it moves at all). */
function waterPiece(
  from: LngLat,
  to: LngLat,
  speedKmh: number,
): { path: LngLat[]; meters: number; seconds: number } {
  const meters = haversineMeters(from, to);
  const seconds =
    meters < 1 ? 0 : Math.max(5, (meters / ((Math.max(1, speedKmh) * 1000) / 3600)) * TRAVEL_COMPRESSION);
  return { path: [from, to], meters, seconds };
}

/** Lays the pieces end to end (a zero-length road/water hop is dropped, a pause never is). */
function layOut(
  pieces: { mode: MockLegSegment['mode']; path: LngLat[]; meters: number; seconds: number }[],
): MockLegSegment[] {
  const out: MockLegSegment[] = [];
  let clock = 0;
  for (const p of pieces) {
    if ((p.mode === 'ROAD' || p.mode === 'WATER') && p.meters < 1 && p.seconds <= 0) continue;
    out.push({
      mode: p.mode,
      path: p.path,
      meters: Math.round(p.meters),
      startSeconds: clock,
      endSeconds: clock + p.seconds,
    });
    clock += p.seconds;
  }
  return out;
}

function joinPath(segments: readonly MockLegSegment[]): LngLat[] {
  const path: LngLat[] = [];
  for (const s of segments)
    for (const point of s.path) {
      const last = path.at(-1);
      if (!last || last[0] !== point[0] || last[1] !== point[1]) path.push(point);
    }
  if (path.length === 1) path.push(path[0]!);
  return path;
}

const metersOf = (segments: readonly MockLegSegment[], mode: MockLegSegment['mode']): number =>
  segments.filter((s) => s.mode === mode).reduce((sum, s) => sum + s.meters, 0);

function toLeg(segments: MockLegSegment[], end?: LngLat): MockLeg {
  const road = metersOf(segments, 'ROAD');
  const water = metersOf(segments, 'WATER');
  return {
    path: joinPath(segments),
    distanceMeters: Math.round(road + water),
    seconds: Math.max(
      1,
      segments.reduce((m, s) => Math.max(m, s.endSeconds), 0),
    ),
    segments,
    fuelMeters: Math.round(water),
    ...(end ? { end } : {}),
  };
}

export interface BoatPlan {
  kind: 'DIRECT' | 'TRAILER' | 'BANK';
  leg: MockLeg;
  roadMeters: number;
  waterMeters: number;
  launchSeconds: number;
  launchPoint: { name: string | null; position: LngLat } | null;
}

/** The boat's outbound leg (backend `planBoatLeg`). */
export function planBoatLeg(
  engine: MockEngine,
  career: MockCareer,
  vehicle: VehicleDto,
  incident: IncidentDto,
): BoatPlan {
  const type = typeOf(vehicle.typeCode);
  const facility = career.facilities.find((f) => f.id === vehicle.facilityId);
  const scene = sceneOf(incident);
  const speed = type?.waterSpeedKmh ?? WATER_KNOBS.defaultWaterSpeedKmh;
  const body = incident.waterBody;
  const berth = facility?.nautical;
  if (berth && body?.id && berth.waterBodyId === body.id) {
    const water = waterPiece(berth.berth, scene, speed);
    const segments = layOut([
      { mode: 'WATER', path: water.path, meters: water.meters, seconds: water.seconds },
    ]);
    return {
      kind: 'DIRECT',
      leg: toLeg(segments),
      roadMeters: 0,
      waterMeters: Math.round(water.meters),
      launchSeconds: 0,
      launchPoint: null,
    };
  }
  const launch = body?.id
    ? LAUNCH_POINTS.filter((l) => l.bodyId === body.id).sort(
        (a, b) => haversineMeters(a.water, scene) - haversineMeters(b.water, scene),
      )[0]
    : undefined;
  const useLaunch = !!launch && haversineMeters(launch.water, scene) <= WATER_KNOBS.bankLaunchMaxMeters;
  const landing = stateOf(career).incidents[incident.id]?.landing ?? null;
  const roadTarget = useLaunch ? launch!.position : incident.position;
  const waterStart = useLaunch ? launch!.water : (landing ?? incident.position);
  const origin = facility?.position ?? vehicle.position;
  const road = engine.route(origin, roadTarget, `${vehicle.id}${incident.id}:trailer`, vehicle.typeCode);
  const roadSeconds = engine.travelSeconds(road.distanceMeters, vehicle.typeCode, career, road.path);
  const water = waterPiece(waterStart, scene, speed);
  const segments = layOut([
    { mode: 'ROAD', path: road.path, meters: road.distanceMeters, seconds: roadSeconds },
    { mode: 'LAUNCH', path: [waterStart], meters: 0, seconds: WATER_KNOBS.launchSeconds },
    { mode: 'WATER', path: water.path, meters: water.meters, seconds: water.seconds },
  ]);
  return {
    kind: useLaunch ? 'TRAILER' : 'BANK',
    leg: toLeg(segments),
    roadMeters: Math.round(road.distanceMeters),
    waterMeters: Math.round(water.meters),
    launchSeconds: WATER_KNOBS.launchSeconds,
    launchPoint: { name: useLaunch ? launch!.name : null, position: roadTarget },
  };
}

/** Where the trailer put the boat in (road side) and the boat went in (water side), from an outbound leg's segments. */
export function launchOf(
  segments: readonly MockLegSegment[] | undefined,
): { road: LngLat; water: LngLat } | null {
  const list = segments ?? [];
  const launch = list.find((s) => s.mode === 'LAUNCH');
  if (!launch) return null;
  const road = [...list].reverse().find((s) => s.mode === 'ROAD' && s.startSeconds < launch.startSeconds);
  return { road: road?.path.at(-1) ?? launch.path[0]!, water: launch.path[0]! };
}

/**
 * The way home of a boat (backend `planBoatReturn`): on the water, it first lands the rescued at the meeting point's shore
 * (when it worked the scene), then sails to its berth when it came from it, else back to the launch point where its trailer
 * waits (RECOVERY) and home by road. Still on the trailer (or a leg without segments): null → the road home of the core.
 */
function planBoatHome(
  engine: MockEngine,
  career: MockCareer,
  vehicle: VehicleDto,
  from: LngLat,
  at: number,
): MockLeg | null {
  const leg: DispatchLeg | undefined = [...career.legs].reverse().find((l) => l.vehicleId === vehicle.id);
  const segments = leg?.segments;
  if (!leg || !segments || segments.length === 0) return null;
  if (vehicle.status === 'PREPARING') return null;
  if (vehicle.status === 'EN_ROUTE' && vehicle.movement?.segments) {
    const current =
      vehicle.movement.segments.find((s) => at < Date.parse(s.arriveAt)) ?? vehicle.movement.segments.at(-1)!;
    if (current.mode === 'ROAD') return null;
  }
  const facility = career.facilities.find((f) => f.id === vehicle.facilityId);
  if (!facility) return null;
  const type = typeOf(vehicle.typeCode);
  const speed = type?.waterSpeedKmh ?? WATER_KNOBS.defaultWaterSpeedKmh;
  const water = stateOf(career).incidents[leg.incidentId];
  const pieces: { mode: MockLegSegment['mode']; path: LngLat[]; meters: number; seconds: number }[] = [];
  let point = from;
  const sail = (to: LngLat) => {
    const piece = waterPiece(point, to, speed);
    pieces.push({ mode: 'WATER', path: piece.path, meters: piece.meters, seconds: piece.seconds });
    point = to;
  };
  if (WATER_KNOBS.landAtMeetingPoint && vehicle.status === 'ON_SCENE' && water?.landing) sail(water.landing);
  const launch = launchOf(segments);
  const berth = facility.nautical;
  if (!launch && berth) {
    sail(berth.berth);
    return toLeg(layOut(pieces), berth.berth);
  }
  const put = launch ?? {
    road: water?.meetingPoint ?? facility.position,
    water: water?.landing ?? point,
  };
  sail(put.water);
  pieces.push({ mode: 'RECOVERY', path: [put.water], meters: 0, seconds: WATER_KNOBS.recoverySeconds });
  const road = engine.route(put.road, facility.position, `${vehicle.id}home${at}`, vehicle.typeCode);
  pieces.push({
    mode: 'ROAD',
    path: road.path,
    meters: road.distanceMeters,
    seconds: engine.travelSeconds(road.distanceMeters, vehicle.typeCode, career, road.path),
  });
  return toLeg(layOut(pieces));
}

/** A land unit has a job at the meeting point: it brings a shore-side need asked at REQUIRED/RECOMMENDED, not external. */
function worksAtMeetingPoint(vehicle: VehicleDto, incident: IncidentDto): boolean {
  return incident.requirements.some(
    (r) =>
      r.level !== 'OPTIONAL' &&
      !r.external &&
      isShoreCapability(r.capability) &&
      (vehicle.capabilities.find((c) => c.code === r.capability)?.value ?? 0) > 0,
  );
}

/** The dispatch gate of the backend (`dispatchGateBlock`) for boats and land units (aircraft: `airGate`). */
export function waterGate(vehicle: VehicleDto, incident: IncidentDto): 'VEHICLE_DOMAIN_MISMATCH' | null {
  const domain = typeOf(vehicle.typeCode)?.domain;
  const onWater = incident.domain === 'WATER';
  if (domain === 'WATER') return onWater ? null : 'VEHICLE_DOMAIN_MISMATCH';
  if (domain === 'GROUND' && onWater && !worksAtMeetingPoint(vehicle, incident))
    return 'VEHICLE_DOMAIN_MISMATCH';
  return null;
}

/** REQUIRED and RECOMMENDED are what an incident actually asks for; OPTIONAL is a bonus, never a reason to fly. */
const essential = (level: string): boolean => level !== 'OPTIONAL';

/**
 * The air rule of the backend's `dispatchGateBlock` (dispatch-gating.ts): an aircraft is a drastic answer, it flies only
 * when the incident lists AIR_SUPPORT at REQUIRED or RECOMMENDED **and** its own service is one of those the template calls
 * out, bringing something the incident asks for. Merely sharing a capability is not enough: no helicopter for a door.
 */
export function airGate(vehicle: VehicleDto, incident: IncidentDto): 'AIR_SUPPORT_NOT_NEEDED' | null {
  const type = typeOf(vehicle.typeCode);
  if (type?.domain !== 'AIR') return null;
  const wantsAir = incident.requirements.some((r) => r.capability === 'AIR_SUPPORT' && essential(r.level));
  // An unknown template is not read as "nobody is called out": the family check then does not ground the aircraft.
  const families = INCIDENT_TEMPLATES.find((t) => t.code === incident.templateCode)?.families ?? [];
  const serves =
    (families.length === 0 || families.includes(type.family)) &&
    incident.requirements.some((r) => essential(r.level) && (type.caps[r.capability] ?? 0) > 0);
  return wantsAir && serves ? null : 'AIR_SUPPORT_NOT_NEEDED';
}

/** The whole gate, shared by the options list and the dispatch command so the two can never disagree. */
export function dispatchGate(
  vehicle: VehicleDto,
  incident: IncidentDto,
): 'VEHICLE_DOMAIN_MISMATCH' | 'AIR_SUPPORT_NOT_NEEDED' | null {
  return waterGate(vehicle, incident) ?? airGate(vehicle, incident);
}

/** The water QA helpers (`window.__rcMock.qa.*`), typed for unit tests. */
export interface WaterQaHelpers {
  spawnWater(
    templateCode?: string,
    opts?: { body?: WaterBodyType; severity?: number; far?: boolean },
  ): string;
  addBoat(typeCode?: string, facilityId?: string): string;
  grandfatherBoat(typeCode?: string): string;
  waterIncident(
    incidentId: string,
  ): { meetingPoint: LngLat; landing: LngLat | null; pointKey: string } | null;
  fillBerthsSilently(facilityId?: string): void;
}
export const waterQa = (engine: MockEngine): WaterQaHelpers => engine.qa as unknown as WaterQaHelpers;

export function installWater(engine: MockEngine): void {
  /* ───────────── spawning ───────────── */
  engine.hooks.spawnWeight.push((career, t) => {
    if (!isWaterTemplate(t)) return 1;
    const verdict = spawnVerdict(career, t);
    if (verdict.bodies.length === 0) return 0;
    return verdict.coastGuardOnly ? WATER_KNOBS.coastGuard.spawnWeight : 1;
  });
  engine.hooks.spawnPlace.push((career, t, opts): SpawnPlace | null => {
    if (!isWaterTemplate(t)) return null;
    const point = pickWaterPoint(engine, career, t, opts);
    const body = WATER_BODIES[point.bodyId]!;
    return {
      position: point.snapped,
      address: `${point.street}, ${point.municipality}`,
      municipality: point.municipality,
      scene: point.position,
      waterBody: { type: body.type, id: body.id, name: body.name },
      onCreated: (c, incident) => void decorateWaterIncident(engine, c, incident, point),
    };
  });

  /* ───────────── what each vehicle brings, where it goes, how a boat gets there ───────────── */
  engine.hooks.sceneCapabilities.push((_career, vehicle, incident, capabilities) =>
    incident.domain === 'WATER' && typeOf(vehicle.typeCode)?.domain === 'GROUND'
      ? capabilities.filter((c) => isShoreCapability(c.code))
      : capabilities,
  );
  engine.hooks.planLeg.push((career, vehicle, incident) =>
    isBoat(vehicle) && incident.domain === 'WATER'
      ? planBoatLeg(engine, career, vehicle, incident).leg
      : null,
  );
  engine.hooks.planHome.push((career, vehicle, from, at) =>
    isBoat(vehicle) ? planBoatHome(engine, career, vehicle, from, at) : null,
  );
  engine.hooks.dispatchOption.push((career, vehicle, option, incident) => {
    // Checked before every transient reason (installed before the crew / autonomy domains): it never resolves by waiting.
    const block = dispatchGate(vehicle, incident);
    let out = block ? { ...option, dispatchable: false, blockedReason: block, notRecommended: true } : option;
    if (incident.domain === 'WATER') {
      const domain = typeOf(vehicle.typeCode)?.domain;
      out = { ...out, destination: domain === 'GROUND' ? 'MEETING_POINT' : 'SCENE' };
      if (domain === 'WATER') {
        const plan = planBoatLeg(engine, career, vehicle, incident);
        out = {
          ...out,
          boatRoute: {
            kind: plan.kind,
            roadMeters: plan.roadMeters,
            waterMeters: plan.waterMeters,
            launchSeconds: Math.round(plan.launchSeconds / engine.speed),
            launchPoint: plan.launchPoint,
          },
        };
      }
    }
    return out;
  });
  engine.hooks.dispatchCheck.push((_career, incident, vehicles) => {
    for (const v of vehicles) {
      const block = dispatchGate(v, incident);
      if (block)
        throw new MockError(
          409,
          block,
          block === 'AIR_SUPPORT_NOT_NEEDED'
            ? 'This incident does not call for an aircraft'
            : 'This vehicle cannot work on this incident',
          { vehicleId: v.id, domain: typeOf(v.typeCode)?.domain },
        );
    }
  });
  // "On the trailer to the launch point" in the timeline of a boat that does not start from its berth.
  engine.hooks.vehicleDeparting.push((career, vehicle, at) => {
    if (!isBoat(vehicle) || !vehicle.incidentId) return 'OK';
    const incident = career.incidents.find((i) => i.id === vehicle.incidentId);
    if (!incident || incident.domain !== 'WATER') return 'OK';
    if (planBoatLeg(engine, career, vehicle, incident).kind !== 'DIRECT')
      engine.log(
        career,
        incident.id,
        'vehicle.boat_trailer',
        text('timeline.vehicle_boat_trailer', { callSign: vehicle.callSign }),
        at,
        vehicle.id,
      );
    return 'OK';
  });

  /* ───────────── QA helpers (window.__rcMock.qa) ───────────── */
  const helpers = {
    /**
     * Spawns a water incident: `body` SEA | LAKE | RIVER (default: any the template allows), `severity`, `far` = the
     * farthest water point from the headquarters (a longer, observable boat leg). Returns the incident id.
     */
    spawnWater: (
      templateCode = 'MED_SWIMMER_DISTRESS',
      opts: { body?: WaterBodyType; severity?: number; far?: boolean } = {},
    ): string => {
      const career = engine.qa.career();
      const incident = engine.spawnIncident(career, templateCode, false, {
        severity: opts.severity,
        waterBody: opts.body,
        ...(opts.far ? { minDistanceMeters: 1e9 } : {}),
      });
      engine.save();
      return incident.id;
    },
    /** Adds a boat, AVAILABLE at once, at a Base nautica (default: the first operational one). Returns its id. */
    addBoat: (typeCode = 'FIRE_BOAT', facilityId?: string): string => {
      const career = engine.qa.career();
      const base =
        career.facilities.find((f) => f.id === facilityId) ??
        career.facilities.find((f) => engine.isNauticalFacility(f) && f.status === 'OPERATIONAL');
      if (!base) throw new MockError(409, 'NEEDS_NAUTICAL_BASE', 'No operational Base nautica');
      const type = typeOf(typeCode);
      if (!type) throw new MockError(404, 'NOT_FOUND', 'Unknown vehicle type');
      engine.assertCanHost(type, base);
      const vehicle = engine.addVehicle(career, typeCode, base.id, true);
      engine.emit(career, 'vehicle.updated', {
        vehicle,
        facility: career.facilities.find((f) => f.id === base.id),
      });
      engine.save();
      return vehicle.id;
    },
    /**
     * A boat still kept at the headquarters fire station (a berth from before the Base nautica, grandfathered like the
     * backend's migration: the station's WATER row is widened to hold it). Returns its id.
     */
    grandfatherBoat: (typeCode = 'FIRE_BOAT'): string => {
      const career = engine.qa.career();
      const station = career.facilities[0]!;
      const points = typeOf(typeCode)?.capacityPoints ?? 1;
      career.facilities = career.facilities.map((f) =>
        f.id !== station.id
          ? f
          : {
              ...f,
              capacities: f.capacities.map((c) =>
                c.domain === 'WATER' ? { ...c, total: Math.max(c.total, c.used + points) } : c,
              ),
            },
      );
      const vehicle = engine.addVehicle(career, typeCode, station.id, true);
      engine.emit(career, 'vehicle.updated', {
        vehicle,
        facility: career.facilities.find((f) => f.id === station.id),
      });
      engine.save();
      return vehicle.id;
    },
    /** The water facts of an incident that the DTO does not carry (landing point), for tests. */
    waterIncident: (incidentId: string) => stateOf(engine.qa.career()).incidents[incidentId] ?? null,
    /**
     * Takes every free berth of a Base nautica WITHOUT telling the client (as if another session had just bought boats
     * there): the next purchase from this tab meets the server's real refusal (`CAPACITY_EXCEEDED` / `NO_ROOM`).
     */
    fillBerthsSilently: (facilityId?: string): void => {
      const career = engine.qa.career();
      const base =
        career.facilities.find((f) => f.id === facilityId) ??
        career.facilities.find((f) => engine.isNauticalFacility(f));
      if (!base) throw new MockError(404, 'NOT_FOUND', 'No Base nautica');
      career.facilities = career.facilities.map((f) =>
        f.id !== base.id
          ? f
          : {
              ...f,
              capacities: f.capacities.map((c) => (c.domain === 'WATER' ? { ...c, used: c.total } : c)),
            },
      );
      engine.save();
    },
  };
  const attach = () => Object.assign(engine.qa, helpers as unknown as Partial<QaHelpers>);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}
