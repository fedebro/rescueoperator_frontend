import { describe, expect, it } from 'vitest';
import { FacilityDetailV2Dto, SiteDto, TransferVehicleResult, type RealtimeEnvelope } from '@/contracts';
import { MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { FACILITY_TYPES, UPGRADE_TYPES, VEHICLE_TYPES, xpThreshold } from '../data/catalog';
import { CANDIDATE_SITES, PESCARA } from '../data/pescara';
import { installDomains } from './index';
import { acquireFacility, listSites, promoteFacility, transferVehicle } from './facilities';

function world() {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  const ch = engine.requestOtp('f@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Director F',
      acceptTerms: true,
      confirmAge: true,
    },
    'vitest',
  );
  const account = engine.authenticate(`Bearer ${auth.accessToken}`);
  const summary = engine.createCareer(account, {
    locationId: PESCARA.id,
    siteId: engine.starterSites()[1]!.id,
  });
  const career = engine.state.careers[summary.id] as MockCareer;
  const advance = (seconds: number) => {
    now += seconds * 1000;
    engine.process();
  };
  const level = (n: number) => engine.awardXp(career, xpThreshold(n) - Number(career.summary.xp));
  const rich = (credits = 500_000) => engine.credit(career, credits, 'ADMIN_ADJUSTMENT', true);
  const site = (key: string) =>
    listSites(engine, career, null).find((s) => s.name === CANDIDATE_SITES.find((c) => c.key === key)!.name)!;
  return { engine, events, career, advance, level, rich, site };
}
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof MockError ? e.code : 'THROWN';
  }
  return 'OK';
};

describe('candidate sites', () => {
  it('offers at least 14 Pescara sites covering the five families + SHARED, real and generated', () => {
    const w = world();
    const sites = listSites(w.engine, w.career, null);
    expect(sites.length).toBeGreaterThanOrEqual(14);
    for (const s of sites) expect(SiteDto.safeParse(s).success, s.name).toBe(true);
    const families = new Set(sites.flatMap((s) => s.options.map((o) => o.family)));
    expect([...families].sort()).toEqual(['ALPINE', 'EMS', 'FIRE', 'POLICE', 'SHARED', 'WILDFIRE']);
    expect(sites.some((s) => s.real)).toBe(true);
    expect(sites.some((s) => !s.real)).toBe(true);
    // every facility type on offer exists in the catalog
    for (const c of CANDIDATE_SITES)
      for (const t of c.compatibleFacilityTypes)
        expect(
          FACILITY_TYPES.some((f) => f.code === t),
          t,
        ).toBe(true);
  });

  it('marks the onboarding site as owned, keeps ids stable and filters by bbox / family', () => {
    const w = world();
    const all = listSites(w.engine, w.career, null);
    expect(all.filter((s) => s.owned).map((s) => s.name)).toEqual([
      'Comando Vigili del Fuoco — Viale Pindaro',
    ]);
    expect(all.find((s) => s.owned)!.options.every((o) => !o.available)).toBe(true);
    expect(listSites(w.engine, w.career, null).map((s) => s.id)).toEqual(all.map((s) => s.id));
    const south = listSites(w.engine, w.career, [14.15, 42.41, 14.27, 42.445]);
    expect(south.length).toBeGreaterThan(0);
    expect(south.every((s) => s.position[1] <= 42.445)).toBe(true);
    expect(listSites(w.engine, w.career, [0, 0, 1, 1])).toEqual([]);
    const shared = listSites(w.engine, w.career, null, 'SHARED');
    expect(shared).toHaveLength(1);
    expect(listSites(w.engine, w.career, null, 'EMS').every((s) => s.family === 'EMS')).toBe(true);
  });

  it('locks options by family and by level, with the reason', () => {
    const w = world();
    const ems = w.site('ems-south');
    expect(ems.options.map((o) => o.lockedReason)).toEqual(['NOT_UNLOCKED', 'NOT_UNLOCKED', 'NOT_UNLOCKED']);
    w.level(3);
    const after = w.site('ems-south');
    expect(after.options.find((o) => o.facilityTypeCode === 'EMS_POST')).toMatchObject({
      available: true,
      lockedReason: null,
    });
    expect(after.options.find((o) => o.facilityTypeCode === 'EMS_STATION')).toMatchObject({
      available: false,
      lockedReason: 'LEVEL_TOO_LOW',
      requiredLevel: 8,
    });
  });
});

describe('facility acquisition', () => {
  it('enforces the gates with contract error codes', () => {
    const w = world();
    const ems = w.site('ems-south');
    const body = { siteId: ems.id, facilityTypeCode: 'EMS_POST' };
    expect(code(() => acquireFacility(w.engine, w.career, body))).toBe('NOT_UNLOCKED');
    w.level(3);
    expect(
      code(() => acquireFacility(w.engine, w.career, { ...body, facilityTypeCode: 'EMS_STATION' })),
    ).toBe('LEVEL_TOO_LOW');
    expect(
      code(() => acquireFacility(w.engine, w.career, { ...body, facilityTypeCode: 'POLICE_POST' })),
    ).toBe('VALIDATION_ERROR');
    expect(
      code(() => acquireFacility(w.engine, w.career, { siteId: 'sit_nope', facilityTypeCode: 'EMS_POST' })),
    ).toBe('NOT_FOUND');
    w.engine.credit(w.career, -Number(w.career.summary.credits), 'ADMIN_ADJUSTMENT', true);
    expect(code(() => acquireFacility(w.engine, w.career, body))).toBe('INSUFFICIENT_CREDITS');
    expect(w.career.facilities).toHaveLength(1);
  });

  it('goes UNDER_CONSTRUCTION → OPERATIONAL through the FACILITY_READY action', () => {
    const w = world();
    w.level(3);
    w.rich();
    const before = BigInt(w.career.summary.credits);
    const ems = w.site('ems-south');
    const detail = acquireFacility(w.engine, w.career, { siteId: ems.id, facilityTypeCode: 'EMS_POST' });
    expect(FacilityDetailV2Dto.safeParse(detail).success).toBe(true);
    expect(detail).toMatchObject({ status: 'UNDER_CONSTRUCTION', typeCode: 'EMS_POST', family: 'EMS' });
    expect(detail.operationalAt).not.toBeNull();
    // the site's own garage is larger than the type's base capacity
    expect(detail.capacities.find((c) => c.domain === 'GROUND')).toMatchObject({ total: 4, used: 0 });
    expect(BigInt(w.career.summary.credits)).toBe(before - 1200n);
    expect(w.career.ledger[0]).toMatchObject({ entryType: 'FACILITY_ACQUISITION', amount: '-1200' });
    expect(w.engine.findAction(w.career, ['FACILITY_READY'], detail.id)).toBeDefined();
    const event = w.events.filter((e) => e.type === 'facility.updated').at(-1)!;
    expect(event.payload).toMatchObject({ facility: { id: detail.id }, career: { id: w.career.summary.id } });
    // the site is now taken, and vehicles cannot be bought into a construction site
    expect(w.site('ems-south').owned).toBe(true);
    expect(
      code(() => acquireFacility(w.engine, w.career, { siteId: ems.id, facilityTypeCode: 'EMS_POST' })),
    ).toBe('SITE_NOT_AVAILABLE');
    expect(
      code(() => w.engine.buyVehicle(w.career, { vehicleTypeCode: 'EMS_MSB', facilityId: detail.id })),
    ).toBe('VALIDATION_ERROR');
    const setup = FACILITY_TYPES.find((f) => f.code === 'EMS_POST')!.setupSeconds;
    w.advance(setup - 1);
    expect(w.career.facilities.find((f) => f.id === detail.id)!.status).toBe('UNDER_CONSTRUCTION');
    w.advance(2);
    expect(w.career.facilities.find((f) => f.id === detail.id)).toMatchObject({
      status: 'OPERATIONAL',
      operationalAt: null,
    });
    expect(w.career.notifications[0]!.title.key).toBe('notifications.facilityReady');
    expect(w.engine.buyVehicle(w.career, { vehicleTypeCode: 'EMS_MSB', facilityId: detail.id }).family).toBe(
      'EMS',
    );
  });

  it('a speed-up (completeNow) finishes the construction through the same executor', () => {
    const w = world();
    w.level(3);
    w.rich();
    const detail = acquireFacility(w.engine, w.career, {
      siteId: w.site('ems-marconi').id,
      facilityTypeCode: 'EMS_POST',
    });
    w.engine.completeNow(w.career, w.engine.findAction(w.career, ['FACILITY_READY'], detail.id)!);
    expect(w.career.facilities.find((f) => f.id === detail.id)!.status).toBe('OPERATIONAL');
  });
});

describe('facility promotion', () => {
  const buildAll = (w: ReturnType<typeof world>, facilityId: string, upgradeCode: string, times: number) => {
    for (let i = 0; i < times; i++) {
      w.engine.buyUpgrade(w.career, facilityId, upgradeCode);
      w.advance(UPGRADE_TYPES.find((u) => u.code === upgradeCode)!.buildSeconds * 10);
    }
  };

  it('offers the next type with a checklist, then swaps type and capacities keeping what was built', () => {
    const w = world();
    w.rich();
    const hq = w.career.facilities[0]!;
    const first = w.engine.facilityDetail(w.career, hq.id) as FacilityDetailV2Dto;
    expect(first.promotionOffer).toMatchObject({
      toTypeCode: 'FIRE_DETACHMENT',
      available: false,
      lockedReason: 'LEVEL_TOO_LOW',
      requiredLevel: 7,
      requiredUpgradeLevels: { GARAGE: 2, QUARTERS: 2 },
    });
    expect(code(() => promoteFacility(w.engine, w.career, hq.id))).toBe('LEVEL_TOO_LOW');
    w.level(7);
    expect(
      (w.engine.facilityDetail(w.career, hq.id) as FacilityDetailV2Dto).promotionOffer?.lockedReason,
    ).toBe('UPGRADES_REQUIRED');
    expect(code(() => promoteFacility(w.engine, w.career, hq.id))).toBe('INVALID_STATE_TRANSITION');
    buildAll(w, hq.id, 'GARAGE', 2);
    buildAll(w, hq.id, 'QUARTERS', 2);
    const ready = w.engine.facilityDetail(w.career, hq.id) as FacilityDetailV2Dto;
    expect(ready.promotionOffer).toMatchObject({ available: true, lockedReason: null, price: '6800' });
    const groundBefore = ready.capacities.find((c) => c.domain === 'GROUND')!;

    const before = BigInt(w.career.summary.credits);
    const started = promoteFacility(w.engine, w.career, hq.id);
    expect(FacilityDetailV2Dto.safeParse(started).success).toBe(true);
    expect(started.promotion?.toTypeCode).toBe('FIRE_DETACHMENT');
    expect((started as FacilityDetailV2Dto).promotionOffer?.lockedReason).toBe('PROMOTION_IN_PROGRESS');
    expect(BigInt(w.career.summary.credits)).toBe(before - 6800n);
    expect(w.engine.findAction(w.career, ['PROMOTION_DONE'], hq.id)).toBeDefined();
    expect(code(() => promoteFacility(w.engine, w.career, hq.id))).toBe('INVALID_STATE_TRANSITION');

    w.advance(FACILITY_TYPES.find((f) => f.code === 'FIRE_LOCAL_STATION')!.promotion!.buildSeconds + 1);
    const done = w.career.facilities[0]!;
    expect(done).toMatchObject({ typeCode: 'FIRE_DETACHMENT', promotion: null, status: 'OPERATIONAL' });
    // FIRE_DETACHMENT base GROUND 10 + 2 garage levels × 2; WATER appears; used points are kept
    expect(done.capacities.find((c) => c.domain === 'GROUND')).toEqual({
      domain: 'GROUND',
      total: 14,
      used: groundBefore.used,
    });
    expect(done.capacities.find((c) => c.domain === 'WATER')!.total).toBe(1);
    expect(done.capacities.find((c) => c.domain === 'PERSONNEL')!.total).toBe(20 + 2 * 4);
    expect(done.upgrades.find((u) => u.code === 'GARAGE')!.level).toBe(2);
    expect(w.career.notifications[0]!.title.key).toBe('notifications.facilityPromoted');
    // the chain continues
    expect((w.engine.facilityDetail(w.career, hq.id) as FacilityDetailV2Dto).promotionOffer?.toTypeCode).toBe(
      'FIRE_COMMAND',
    );
  });
});

describe('vehicle transfer', () => {
  function twoStations() {
    const w = world();
    w.rich();
    const detail = acquireFacility(w.engine, w.career, {
      siteId: w.site('fire-north').id,
      facilityTypeCode: 'FIRE_LOCAL_STATION',
    });
    return { w, targetId: detail.id };
  }

  it('moves an AVAILABLE vehicle: capacity on both sides, IN_DELIVERY for the drive, then AVAILABLE', () => {
    const { w, targetId } = twoStations();
    const vehicle = w.career.vehicles[0]!;
    expect(code(() => transferVehicle(w.engine, w.career, vehicle.id, targetId))).toBe('VALIDATION_ERROR'); // under construction
    w.advance(FACILITY_TYPES.find((f) => f.code === 'FIRE_LOCAL_STATION')!.setupSeconds + 1);
    const from = w.career.facilities[0]!;
    const usedBefore = from.capacities.find((c) => c.domain === 'GROUND')!.used;
    const result = transferVehicle(w.engine, w.career, vehicle.id, targetId);
    expect(TransferVehicleResult.safeParse(result).success).toBe(true);
    expect(result.vehicle).toMatchObject({ facilityId: targetId, status: 'IN_DELIVERY' });
    expect(result.vehicle.busyUntil).not.toBeNull();
    expect(result.facilities.map((f) => f.id).sort()).toEqual([from.id, targetId].sort());
    const points = VEHICLE_TYPES.find((t) => t.code === vehicle.typeCode)!.capacityPoints;
    expect(w.career.facilities[0]!.capacities.find((c) => c.domain === 'GROUND')!.used).toBe(
      usedBefore - points,
    );
    expect(w.career.facilities[1]!.capacities.find((c) => c.domain === 'GROUND')!.used).toBe(points);
    expect(w.events.at(-1)).toMatchObject({ type: 'vehicle.updated', payload: { transfer: true } });
    // not transferable (nor dispatchable) while it drives over
    expect(code(() => transferVehicle(w.engine, w.career, vehicle.id, from.id))).toBe(
      'VEHICLE_NOT_AVAILABLE',
    );
    w.advance(600);
    expect(w.career.vehicles[0]).toMatchObject({
      status: 'AVAILABLE',
      busyUntil: null,
      facilityId: targetId,
    });
    expect(w.career.vehicles[0]!.position).toEqual(w.career.facilities[1]!.position);
  });

  it('rejects incompatible, full and identical targets', () => {
    const { w, targetId } = twoStations();
    w.level(3);
    const ems = acquireFacility(w.engine, w.career, {
      siteId: w.site('ems-marconi').id,
      facilityTypeCode: 'EMS_POST',
    });
    w.advance(3600);
    const vehicle = w.career.vehicles[0]!;
    expect(code(() => transferVehicle(w.engine, w.career, vehicle.id, vehicle.facilityId))).toBe(
      'VALIDATION_ERROR',
    );
    expect(code(() => transferVehicle(w.engine, w.career, vehicle.id, ems.id))).toBe('VALIDATION_ERROR');
    w.career.facilities = w.career.facilities.map((f) =>
      f.id === targetId ? { ...f, capacities: f.capacities.map((c) => ({ ...c, used: c.total })) } : f,
    );
    expect(code(() => transferVehicle(w.engine, w.career, vehicle.id, targetId))).toBe('CAPACITY_EXCEEDED');
    expect(code(() => transferVehicle(w.engine, w.career, 'veh_nope', targetId))).toBe('NOT_FOUND');
  });
});

describe('AIR movement', () => {
  it('routes AIR vehicles as one straight segment at their own speed, road vehicles along a polyline', () => {
    const { engine } = world();
    const from: [number, number] = [14.19, 42.44];
    const to: [number, number] = [14.23, 42.47];
    const air = engine.route(from, to, 'seed', 'EMS_HELI');
    expect(air.path).toEqual([from, to]);
    const road = engine.route(from, to, 'seed', 'FIRE_APS');
    expect(road.path.length).toBeGreaterThan(2);
    expect(road.distanceMeters).toBeGreaterThan(air.distanceMeters);
    // 240 km/h × time compression 0.25 → seconds = metres / (240/3.6) × 0.25
    expect(engine.travelSeconds(air.distanceMeters, 'EMS_HELI')).toBe(
      Math.max(8, Math.round((air.distanceMeters / (240 / 3.6)) * 0.25)),
    );
    expect(engine.travelSeconds(air.distanceMeters, 'EMS_HELI')).toBeLessThan(
      engine.travelSeconds(road.distanceMeters, 'FIRE_APS'),
    );
  });
});
