import type { FacilityDto, SiteDto, VehicleDto } from '@/contracts';
import { haversineMeters } from '@/lib/geo';
import {
  FACILITY_TYPES,
  UPGRADE_TYPES,
  VEHICLE_TYPES,
  resolvedFamilyLevel,
  type MockFacilityType,
} from '../data/catalog';
import { CANDIDATE_SITES, PESCARA, type MockCandidateSite } from '../data/pescara';
import { lockReason } from '../catalog-dto';
import { MockError, capacitiesFor, iso, text, type MockCareer, type MockEngine } from '../engine';
import { domainState } from './index';

/**
 * Simulation of the `facilities` area: candidate sites, acquisition (UNDER_CONSTRUCTION → FACILITY_READY), promotion to
 * the next type of the chain (PROMOTION_DONE) and vehicle transfers between facilities. Timers follow the binding
 * conventions of frontend-depth.md: `FACILITY_READY` / `PROMOTION_DONE`, ref = facilityId (speed-up target FACILITY_UPGRADE).
 */
interface FacilitiesState {
  /** Candidate site key → facility built on it. */
  sites: Record<string, string>;
}
const stateOf = (career: MockCareer): FacilitiesState =>
  domainState<FacilitiesState>(career, 'facilities', () => ({ sites: {} }));

const SITE_PREFIX = 'cand:';
/** A facility closer than this to a site sits ON it (the headquarters picked at onboarding has no site record). */
const SAME_SPOT_METERS = 30;

const typeOf = (code: string): MockFacilityType | undefined => FACILITY_TYPES.find((f) => f.code === code);
/** Level gate of a facility type for THIS territory (WILDFIRE / ALPINE families open at a territory-dependent level). */
const gateLevel = (type: MockFacilityType): number =>
  Math.max(type.requiredLevel, type.family === 'SHARED' ? 1 : resolvedFamilyLevel(type.family));

/** Stable public id of a candidate site (starter sites keep the id they got at onboarding). */
function siteId(engine: MockEngine, site: MockCandidateSite): string {
  const known = Object.entries(engine.state.sites).find(
    ([, key]) => key === site.key || key === SITE_PREFIX + site.key,
  )?.[0];
  if (known) return known;
  const id = engine.id('sit');
  engine.state.sites[id] = SITE_PREFIX + site.key;
  return id;
}

function siteById(engine: MockEngine, id: string): MockCandidateSite | undefined {
  const key = engine.state.sites[id];
  if (!key) return undefined;
  return CANDIDATE_SITES.find((s) => s.key === key || SITE_PREFIX + s.key === key);
}

function isOwned(career: MockCareer, site: MockCandidateSite): boolean {
  const facilityId = stateOf(career).sites[site.key];
  if (facilityId && career.facilities.some((f) => f.id === facilityId)) return true;
  return career.facilities.some((f) => haversineMeters(f.position, site.position) < SAME_SPOT_METERS);
}

/** Lock reason of one facility type for this career (family gate first, then level). */
export function facilityTypeLock(career: MockCareer, type: MockFacilityType): string | null {
  return lockReason(career, type.family, gateLevel(type));
}

export function siteDto(engine: MockEngine, career: MockCareer, site: MockCandidateSite): SiteDto {
  const owned = isOwned(career, site);
  return {
    id: siteId(engine, site),
    name: site.name,
    real: site.real,
    family: site.family,
    position: site.position,
    address: site.address,
    locationId: PESCARA.id,
    capacityPoints: site.capacityPoints,
    expansionPotential: site.expansionPotential,
    profile: site.profile,
    owned,
    options: site.compatibleFacilityTypes.flatMap((code) => {
      const type = typeOf(code);
      if (!type) return [];
      const lockedReason = owned ? 'SITE_NOT_AVAILABLE' : facilityTypeLock(career, type);
      return [
        {
          facilityTypeCode: type.code,
          family: type.family,
          tier: type.tier,
          price: String(type.price),
          requiredLevel: gateLevel(type),
          setupSeconds: Math.round(type.setupSeconds / engine.speed),
          available: lockedReason === null,
          lockedReason,
        },
      ];
    }),
  };
}

/** GET /sites?bbox=w,s,e,n[&family=] */
export function listSites(
  engine: MockEngine,
  career: MockCareer,
  bbox: [number, number, number, number] | null,
  family?: string | null,
): SiteDto[] {
  const sites = CANDIDATE_SITES.filter((s) => {
    if (bbox) {
      const [w, south, e, n] = bbox;
      const [lng, lat] = s.position;
      if (lng < w || lng > e || lat < south || lat > n) return false;
    }
    return true;
  })
    .map((s) => siteDto(engine, career, s))
    // `family` matches the family of the facility types on offer, so SHARED sites are reachable with family=SHARED.
    .filter((s) => !family || s.family === family || s.options.some((o) => o.family === family));
  engine.save();
  return sites;
}

/** Sum of the capacity added by the upgrades already built, per capacity domain. */
function upgradeBonus(facility: FacilityDto): Record<string, number> {
  const bonus: Record<string, number> = {};
  for (const built of facility.upgrades) {
    const type = UPGRADE_TYPES.find((u) => u.code === built.code);
    if (!type || type.domain === 'TRAINING') continue;
    bonus[type.domain] = (bonus[type.domain] ?? 0) + type.delta * built.level;
  }
  return bonus;
}

/** ★POST /facilities {siteId, facilityTypeCode, name?} */
export function acquireFacility(
  engine: MockEngine,
  career: MockCareer,
  body: { siteId?: unknown; facilityTypeCode?: unknown; name?: unknown },
) {
  const site = typeof body.siteId === 'string' ? siteById(engine, body.siteId) : undefined;
  const type = typeof body.facilityTypeCode === 'string' ? typeOf(body.facilityTypeCode) : undefined;
  if (!site) throw new MockError(404, 'NOT_FOUND', 'Unknown site');
  if (!type || !site.compatibleFacilityTypes.includes(type.code))
    throw new MockError(422, 'VALIDATION_ERROR', 'Facility type not compatible with this site', {
      compatibleFacilityTypes: site.compatibleFacilityTypes,
    });
  if (isOwned(career, site)) throw new MockError(409, 'SITE_NOT_AVAILABLE', 'Site already owned');
  const lock = facilityTypeLock(career, type);
  if (lock === 'NOT_UNLOCKED')
    throw new MockError(422, 'NOT_UNLOCKED', 'Family not unlocked', { family: type.family });
  if (lock === 'LEVEL_TOO_LOW')
    throw new MockError(422, 'LEVEL_TOO_LOW', 'Level too low', { requiredLevel: gateLevel(type) });
  const custom = typeof body.name === 'string' ? body.name.trim() : '';
  if (custom && (custom.length < 2 || custom.length > 60))
    throw new MockError(422, 'VALIDATION_ERROR', 'Invalid facility name');
  engine.credit(
    career,
    -type.price,
    'FACILITY_ACQUISITION',
    true,
    text('ledger.FACILITY_ACQUISITION', { item: type.code }),
  );
  const facility: FacilityDto = {
    id: engine.id('fac'),
    typeCode: type.code,
    family: type.family,
    name: custom || site.name,
    position: site.position,
    status: 'UNDER_CONSTRUCTION',
    capacities: capacitiesFor(type.baseCapacity, site.capacityPoints),
    upgrades: [],
    address: site.address,
    headquarters: false,
    operationalAt: iso(engine.now() + engine.dur(type.setupSeconds)),
    promotion: null,
  };
  career.facilities.push(facility);
  career.facilityAddress[facility.id] = site.address;
  stateOf(career).sites[site.key] = facility.id;
  engine.schedule(career, 'FACILITY_READY', type.setupSeconds, facility.id);
  engine.emit(career, 'facility.updated', { facility, career: career.summary });
  engine.save();
  return engine.facilityDetail(career, facility.id);
}

function patchFacility(career: MockCareer, id: string, patch: Partial<FacilityDto>): FacilityDto | null {
  let out: FacilityDto | null = null;
  career.facilities = career.facilities.map((f) => (f.id === id ? (out = { ...f, ...patch }) : f));
  return out;
}

/** Promotion offer of GET /facilities/:id — null at the end of a chain. */
export function promotionOffer(engine: MockEngine, career: MockCareer, facility: FacilityDto) {
  const type = typeOf(facility.typeCode);
  const next = type?.promotion ? typeOf(type.promotion.to) : undefined;
  if (!type?.promotion || !next) return null;
  const missingUpgrade = Object.entries(type.promotion.requiredUpgradeLevels).some(
    ([code, level]) => (facility.upgrades.find((u) => u.code === code)?.level ?? 0) < level,
  );
  const lockedReason = facility.promotion
    ? 'PROMOTION_IN_PROGRESS'
    : facility.status !== 'OPERATIONAL'
      ? 'FACILITY_NOT_OPERATIONAL'
      : gateLevel(next) > career.summary.level
        ? 'LEVEL_TOO_LOW'
        : missingUpgrade
          ? 'UPGRADES_REQUIRED'
          : facility.upgrades.some((u) => u.buildingUntil)
            ? 'UPGRADE_IN_PROGRESS'
            : null;
  return {
    toTypeCode: next.code,
    name: text(`facility.${next.code}.name`),
    price: String(type.promotion.cost),
    buildSeconds: Math.round(type.promotion.buildSeconds / engine.speed),
    requiredLevel: gateLevel(next),
    requiredUpgradeLevels: type.promotion.requiredUpgradeLevels,
    available: lockedReason === null,
    lockedReason,
  };
}

/** ★POST /facilities/:id/promote */
export function promoteFacility(engine: MockEngine, career: MockCareer, facilityId: string) {
  const facility = career.facilities.find((f) => f.id === facilityId);
  if (!facility) throw new MockError(404, 'NOT_FOUND', 'Facility not found');
  const offer = promotionOffer(engine, career, facility);
  const type = typeOf(facility.typeCode);
  if (!offer || !type?.promotion)
    throw new MockError(409, 'INVALID_STATE_TRANSITION', 'This facility cannot be promoted');
  if (offer.lockedReason === 'LEVEL_TOO_LOW')
    throw new MockError(422, 'LEVEL_TOO_LOW', 'Level too low', { requiredLevel: offer.requiredLevel });
  if (!offer.available)
    throw new MockError(409, 'INVALID_STATE_TRANSITION', 'Promotion not available', {
      reason: offer.lockedReason,
      requiredUpgradeLevels: offer.requiredUpgradeLevels,
    });
  engine.credit(
    career,
    -type.promotion.cost,
    'FACILITY_UPGRADE',
    true,
    text('ledger.FACILITY_UPGRADE', { item: offer.toTypeCode }),
  );
  const next = patchFacility(career, facilityId, {
    promotion: {
      toTypeCode: offer.toTypeCode,
      completeAt: iso(engine.now() + engine.dur(type.promotion.buildSeconds)),
    },
  })!;
  engine.schedule(career, 'PROMOTION_DONE', type.promotion.buildSeconds, facilityId);
  engine.emit(career, 'facility.updated', { facility: next, career: career.summary });
  engine.save();
  return engine.facilityDetail(career, facilityId);
}

/** ★POST /vehicles/:id/transfer {facilityId} — re-bases an AVAILABLE vehicle; it is IN_DELIVERY while it drives over. */
export function transferVehicle(
  engine: MockEngine,
  career: MockCareer,
  vehicleId: string,
  facilityId: unknown,
): { vehicle: VehicleDto; facilities: FacilityDto[] } {
  const vehicle = career.vehicles.find((v) => v.id === vehicleId);
  const target = career.facilities.find((f) => f.id === facilityId);
  if (!vehicle || !target) throw new MockError(404, 'NOT_FOUND', 'Unknown vehicle or facility');
  if (vehicle.status !== 'AVAILABLE')
    throw new MockError(409, 'VEHICLE_NOT_AVAILABLE', 'Only available vehicles can be transferred');
  const type = VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode);
  if (!type) throw new MockError(404, 'NOT_FOUND', 'Unknown vehicle type');
  if (target.id === vehicle.facilityId)
    throw new MockError(422, 'VALIDATION_ERROR', 'The vehicle is already based there');
  if (target.status !== 'OPERATIONAL' || !type.compatibleFacilityTypes.includes(target.typeCode))
    throw new MockError(422, 'VALIDATION_ERROR', 'Facility not compatible with this vehicle type', {
      compatibleFacilityTypes: type.compatibleFacilityTypes,
    });
  const room = target.capacities.find((c) => c.domain === type.domain);
  if (!room || room.total - room.used < type.capacityPoints)
    throw new MockError(422, 'CAPACITY_EXCEEDED', 'No room in this facility', { domain: type.domain });
  const fromId = vehicle.facilityId;
  const shift = (f: FacilityDto, delta: number): FacilityDto => ({
    ...f,
    capacities: f.capacities.map((c) =>
      c.domain === type.domain ? { ...c, used: Math.max(0, c.used + delta) } : c,
    ),
  });
  career.facilities = career.facilities.map((f) =>
    f.id === fromId ? shift(f, -type.capacityPoints) : f.id === target.id ? shift(f, type.capacityPoints) : f,
  );
  // Like the real backend: the vehicle is IN_DELIVERY for the driving time, then AVAILABLE at the new facility
  // (the core `VEHICLE_DELIVERED` action finishes it, so the speed-up target VEHICLE_DELIVERY works too).
  const from = career.facilities.find((f) => f.id === fromId);
  const { distanceMeters } = engine.route(
    from?.position ?? vehicle.position,
    target.position,
    `transfer:${vehicle.id}`,
    vehicle.typeCode,
  );
  const seconds = engine.travelSeconds(distanceMeters, vehicle.typeCode);
  const moved = engine.patchVehicle(career, vehicleId, {
    facilityId: target.id,
    position: target.position,
    status: 'IN_DELIVERY',
    busyUntil: iso(engine.now() + engine.dur(seconds)),
  })!;
  engine.schedule(career, 'VEHICLE_DELIVERED', seconds, vehicle.id);
  const facilities = career.facilities.filter((f) => f.id === fromId || f.id === target.id);
  engine.emit(career, 'vehicle.updated', { vehicle: moved, facilities, transfer: true });
  engine.save();
  return { vehicle: moved, facilities };
}

export function installFacilities(engine: MockEngine): void {
  engine.hooks.facilityDetail.push((career, facility) => ({
    promotionOffer: promotionOffer(engine, career, facility),
  }));

  engine.registerExecutor('FACILITY_READY', (career, action) => {
    const facility = career.facilities.find((f) => f.id === action.ref);
    if (!facility || facility.status !== 'UNDER_CONSTRUCTION') return; // idempotent
    const next = patchFacility(career, facility.id, { status: 'OPERATIONAL', operationalAt: null })!;
    engine.emit(career, 'facility.updated', { facility: next, career: career.summary });
    engine.notify(career, {
      category: 'FACILITIES',
      priority: 'IMPORTANT',
      title: text('notifications.facilityReady', { facility: next.name }),
      action: { kind: 'OPEN_FACILITY', targetId: next.id },
    });
  });

  engine.registerExecutor('PROMOTION_DONE', (career, action) => {
    const facility = career.facilities.find((f) => f.id === action.ref);
    const next = facility?.promotion ? typeOf(facility.promotion.toTypeCode) : undefined;
    if (!facility || !next) return; // idempotent
    // New type's base capacity + everything already built; the site's own garage size is kept when it was larger.
    const bonus = upgradeBonus(facility);
    const previous = typeOf(facility.typeCode);
    const groundNow = facility.capacities.find((c) => c.domain === 'GROUND')?.total ?? 0;
    const siteGround = Math.max(previous?.baseCapacity.GROUND ?? 0, groundNow - (bonus.GROUND ?? 0));
    const capacities = capacitiesFor(next.baseCapacity, siteGround).map((c) => ({
      ...c,
      total: c.total + (bonus[c.domain] ?? 0),
      used: facility.capacities.find((x) => x.domain === c.domain)?.used ?? 0,
    }));
    const promoted = patchFacility(career, facility.id, {
      typeCode: next.code,
      family: next.family,
      capacities,
      promotion: null,
    })!;
    engine.emit(career, 'facility.updated', { facility: promoted, career: career.summary });
    engine.notify(career, {
      category: 'FACILITIES',
      priority: 'IMPORTANT',
      title: text('notifications.facilityPromoted', { facility: promoted.name }),
      action: { kind: 'OPEN_FACILITY', targetId: promoted.id },
    });
  });
}
