import type { FacilityDto, IncidentDto, VehicleDto } from '@/contracts';
import type { LngLat } from '@/lib/geo';

/**
 * Water scene helpers of the UI (D-23 [U] "solo Base nautica", D-68 [C], analisi/note-agenti/water-backend.md):
 * a water incident has its SCENE on the water (the marker, where boats and aircraft go) and a MEETING POINT on the shore
 * road (`position`, where land units stop and the boat lands the rescued). Boats live only in a Base nautica.
 */

export type WaterBodyKind = NonNullable<IncidentDto['waterBody']>['type'];
type Requirement = IncidentDto['requirements'][number];

/** Where the incident really is: on the water for a water incident, its position otherwise (older payloads too). */
export const incidentScene = (incident: Pick<IncidentDto, 'position' | 'scenePosition'>): LngLat =>
  incident.scenePosition ?? incident.position;

export const isWaterIncident = (incident: Pick<IncidentDto, 'domain' | 'waterBody'>): boolean =>
  incident.domain === 'WATER' || !!incident.waterBody;

/** The meeting point on the shore road of a water incident (null on land). */
export const meetingPointOf = (
  incident: Pick<IncidentDto, 'domain' | 'waterBody' | 'position' | 'meetingPoint'>,
): LngLat | null => (isWaterIncident(incident) ? (incident.meetingPoint ?? incident.position) : null);

/** Kind of water of a water incident (sea / lake / river), null on land or when unknown (pre-geodata incidents). */
export const waterKindOf = (incident: Pick<IncidentDto, 'domain' | 'waterBody'>): WaterBodyKind | null =>
  isWaterIncident(incident) ? (incident.waterBody?.type ?? null) : null;

/**
 * A vehicle type that reaches the people in the water (water patients, analisi/note-agenti/water-patients.md): a boat, or a
 * helicopter able to do a water rescue — a winch, or WATER_RESCUE among the catalog type's (or the vehicle's) capabilities.
 */
export function isWaterUnitType(
  type:
    | { domain?: string; tags?: readonly string[]; capabilities?: readonly { code: string; value: number }[] }
    | undefined,
  capabilities: readonly { code: string; value: number }[] = [],
): boolean {
  if (!type) return false;
  if (type.domain === 'WATER') return true;
  if (type.domain !== 'AIR') return false;
  return (
    !!type.tags?.includes('WINCH') ||
    [...(type.capabilities ?? []), ...capabilities].some((c) => c.code === 'WATER_RESCUE' && c.value > 0)
  );
}

/**
 * When the Coast Guard still has to land the people in the water (`waterSupport.recoveryAt`), else null: an instant in the
 * past is done, and nobody waiting for it (the patients known) means there is nothing left for it to do.
 */
export function pendingCoastGuardLanding(
  incident: Pick<IncidentDto, 'waterSupport'>,
  waitingForCoastGuard: boolean | null,
  now: number,
): string | null {
  const at = incident.waterSupport?.recoveryAt ?? null;
  if (!at || Date.parse(at) <= now || waitingForCoastGuard === false) return null;
  return at;
}

/** The facility type that keeps boats. */
export const NAUTICAL_BASE = 'NAUTICAL_BASE';
export const PIER_UPGRADE = 'PIER';

/** A Base nautica: the only facility that keeps boats (its berth is on the water). */
export const isNauticalBase = (facility: Pick<FacilityDto, 'typeCode' | 'nautical'>): boolean =>
  facility.typeCode === NAUTICAL_BASE || !!facility.nautical;

/** Free berths of a facility (its WATER capacity). */
export function freeBerths(facility: Pick<FacilityDto, 'capacities'>): number {
  const water = facility.capacities.find((c) => c.domain === 'WATER');
  return water ? Math.max(0, water.total - water.used) : 0;
}

/** The player's Bases nautiche, operational first, the roomiest first. */
export function nauticalBases(facilities: readonly FacilityDto[]): FacilityDto[] {
  return facilities
    .filter(isNauticalBase)
    .sort(
      (a, b) =>
        Number(b.status === 'OPERATIONAL') - Number(a.status === 'OPERATIONAL') ||
        freeBerths(b) - freeBerths(a),
    );
}

/** The Base nautica a boat can move to right now (operational, a free berth), if any. */
export function transferTargetForBoat(
  facilities: readonly FacilityDto[],
  points: number,
  exceptFacilityId?: string,
): FacilityDto | null {
  return (
    nauticalBases(facilities).find(
      (f) => f.id !== exceptFacilityId && f.status === 'OPERATIONAL' && freeBerths(f) >= points,
    ) ?? null
  );
}

/**
 * Boats still kept at a facility that is not a Base nautica (berths of a fire station from before D-23): they keep working
 * there, and move to a Base nautica for free (studio 05 §2.4).
 */
export function grandfatheredBoats(
  vehicles: readonly VehicleDto[],
  facilities: readonly FacilityDto[],
  isBoat: (typeCode: string) => boolean,
): VehicleDto[] {
  return vehicles.filter((v) => {
    if (!isBoat(v.typeCode) || v.status === 'OUT_OF_SERVICE') return false;
    const facility = facilities.find((f) => f.id === v.facilityId);
    return !!facility && !isNauticalBase(facility);
  });
}

/**
 * Requirements of a water incident by where they are served: in the water (boats, aircraft — or the Coast Guard) and at
 * the meeting point on the shore (land units). `null` on land incidents or payloads without `side`.
 */
export function requirementsBySide(
  requirements: readonly Requirement[],
): { water: Requirement[]; shore: Requirement[] } | null {
  if (!requirements.some((r) => r.side)) return null;
  return {
    water: requirements.filter((r) => r.side === 'WATER'),
    shore: requirements.filter((r) => r.side !== 'WATER'),
  };
}

/** Deep link of the facilities page: the new-facility section filtered on the nautical sites. */
export const NAUTICAL_SITES_HREF = '/game/facilities?new=NAUTICAL';
/** Deep link of the shop filtered on the boats. */
export const BOAT_SHOP_HREF = '/game/shop?domain=WATER';
