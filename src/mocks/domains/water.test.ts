import { describe, expect, it } from 'vitest';
import { IncidentDto, SiteDto, VehicleDto, type RealtimeEnvelope } from '@/contracts';
import { haversineMeters } from '@/lib/geo';
import { MockEngine, MockError, OTP_CODE, memoryStorage, sceneOf, type MockCareer } from '../engine';
import { INCIDENT_TEMPLATES, VEHICLE_TYPES, xpThreshold } from '../data/catalog';
import { NAUTICAL_SITES, WATER_POINTS } from '../data/water';
import { PESCARA } from '../data/pescara';
import { installDomains } from './index';
import { acquireFacility, listSites, transferVehicle } from './facilities';
import {
  airGate,
  boatCapabilities,
  dispatchGate,
  spawnVerdict,
  waterGate,
  waterQa,
  WATER_KNOBS,
} from './water';

/** A Pescara career at `level` with plenty of credits, off duty (no random spawns), ready to play. */
function world(level = 9) {
  let now = Date.parse('2026-07-01T10:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 11;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  const ch = engine.requestOtp('water@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Water',
      acceptTerms: true,
      confirmAge: true,
    },
    'vitest',
  );
  const account = engine.authenticate(`Bearer ${auth.accessToken}`);
  engine.state.currentSession = { email: 'water@example.com', sessionId: 'x' };
  const summary = engine.createCareer(account, {
    locationId: PESCARA.id,
    siteId: engine.starterSites()[1]!.id,
  });
  const career = engine.state.careers[summary.id] as MockCareer;
  const tutorial = career.incidents.find((i) => i.isTutorial)!;
  engine.close(career, tutorial, 'CANCELLED', now);
  career.pendingOutcomes = [];
  engine.advanceTutorial(career, 'DONE');
  engine.setDuty(career, false);
  engine.awardXp(career, xpThreshold(level) - Number(career.summary.xp));
  engine.credit(career, 900_000, 'ADMIN_ADJUSTMENT', true);
  const until = (done: () => boolean, budgetMs = 1_800_000, step = 250) => {
    for (let t = 0; t < budgetMs && !done(); t += step) {
      now += step;
      engine.process();
    }
    return done();
  };
  const advance = (seconds: number) => {
    now += seconds * 1000;
    engine.process();
  };
  const incident = (id: string) => career.incidents.find((i) => i.id === id)!;
  const vehicle = (id: string) => career.vehicles.find((v) => v.id === id)!;
  const nauticalSite = (key = 'nautical-marina') =>
    listSites(engine, career, null, null, 'NAUTICAL').find(
      (s) => s.name === NAUTICAL_SITES.find((n) => n.key === key)!.name,
    )!;
  /** Buys a Base nautica and waits for the end of the construction. */
  const buildBase = (key = 'nautical-marina') => {
    const detail = acquireFacility(engine, career, {
      siteId: nauticalSite(key).id,
      facilityTypeCode: 'NAUTICAL_BASE',
    });
    until(() => career.facilities.find((f) => f.id === detail.id)!.status === 'OPERATIONAL');
    return career.facilities.find((f) => f.id === detail.id)!;
  };
  const addVehicle = (typeCode: string, facilityId = career.facilities[0]!.id) =>
    engine.addVehicle(career, typeCode, facilityId, true);
  return {
    engine,
    water: waterQa(engine),
    events,
    career,
    now: () => now,
    until,
    advance,
    incident,
    vehicle,
    nauticalSite,
    buildBase,
    addVehicle,
  };
}

const code = (fn: () => unknown): { code: string; details?: unknown } => {
  try {
    fn();
  } catch (e) {
    return e instanceof MockError ? { code: e.code, details: e.details } : { code: 'THROWN' };
  }
  return { code: 'OK' };
};
const template = (c: string) => INCIDENT_TEMPLATES.find((t) => t.code === c)!;

describe('water incidents: the scene on the water, the meeting point on the road', () => {
  it('places a sea incident offshore with its meeting point, place text and water badge data', () => {
    const w = world();
    const id = w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 });
    const inc = w.incident(id);
    expect(IncidentDto.safeParse(inc).success).toBe(true);
    expect(inc).toMatchObject({ domain: 'WATER', waterBody: { type: 'SEA', id: 'sea:adriatic' } });
    const point = WATER_POINTS.find((p) => p.position[0] === inc.scenePosition![0])!;
    expect(point.bodyId).toBe('sea:adriatic');
    // the marker is on the water, the land units stop on the shore road: two different points
    expect(inc.meetingPoint).toEqual(inc.position);
    expect(inc.position).toEqual(point.snapped);
    expect(haversineMeters(inc.scenePosition!, inc.position)).toBeGreaterThan(150);
    expect(inc.placeText).toMatchObject({ key: 'water.place.SEA', params: { place: inc.address } });
    expect(inc.address).toContain(point.street);
    expect(inc.requirements.find((r) => r.capability === 'WATER_RESCUE')!.side).toBe('WATER');
    expect(inc.requirements.find((r) => r.capability === 'MEDICAL_BASIC')!.side).toBe('SHORE');
  });

  it('keeps land incidents on land with scene = position and no water fields', () => {
    const w = world();
    const land = w.incident(w.engine.qa.spawn('FIRE_TRASH_BIN', 2));
    expect(land).toMatchObject({ domain: 'LAND', waterBody: null, meetingPoint: null, waterSupport: null });
    expect(land.scenePosition).toEqual(land.position);
    expect(land.placeText).toBeUndefined();
  });

  it('puts river-only rescues on the river with an "all’altezza di" place', () => {
    const w = world();
    const inc = w.incident(w.water.spawnWater('MULTI_PERSON_IN_WATER', { body: 'RIVER' }));
    expect(inc.waterBody).toMatchObject({ type: 'RIVER', name: 'Fiume Pescara' });
    expect(inc.placeText).toMatchObject({ key: 'water.place.RIVER', params: { water: 'Fiume Pescara' } });
    // no Coast Guard on rivers
    expect(inc.waterSupport).toBeNull();
  });

  it('refuses a water template far from any water (admin/QA position) with NO_WATER_POINT', () => {
    const w = world();
    const refusal = code(() =>
      w.engine.spawnIncident(w.career, 'MED_SWIMMER_DISTRESS', false, { position: [13.4, 42.35] }),
    );
    expect(refusal).toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'NO_WATER_POINT' } });
  });
});

describe('Coast Guard (external support on the sea, D-68)', () => {
  it('covers the water part when the career has no suitable boat, with a reduced reward', () => {
    const w = world();
    const inc = w.incident(w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 }));
    expect(inc.waterSupport).toMatchObject({
      provider: 'COAST_GUARD',
      rewardShare: 0.6,
      capabilities: ['WATER_RESCUE'],
    });
    const water = inc.requirements.find((r) => r.capability === 'WATER_RESCUE')!;
    expect(water).toMatchObject({ external: true, externalSource: 'COAST_GUARD' });
    const shore = inc.requirements.find((r) => r.capability === 'MEDICAL_BASIC')!;
    expect(shore).toMatchObject({ external: false, externalSource: null });
    // the land part at the meeting point is the player's: an ambulance resolves it
    const ambulance = w.addVehicle('EMS_MSB');
    w.engine.qa.staffAll();
    w.engine.dispatch(w.career, inc.id, [ambulance.id]);
    expect(w.until(() => w.career.pendingOutcomes.some((o) => o.incidentId === inc.id))).toBe(true);
    const outcome = w.career.pendingOutcomes.find((o) => o.incidentId === inc.id)!;
    expect(outcome.notes.map((n) => n.key)).toContain('outcome.note.COAST_GUARD');
    const t = template('MED_SWIMMER_DISTRESS');
    expect(Number(outcome.grossCredits)).toBe(
      Math.round(
        t.baseReward * t.complexity * (0.7 + 0.1 * inc.severity) * WATER_KNOBS.coastGuard.rewardShare,
      ),
    );
  });

  it('stays out when a boat of the career can do the water part', () => {
    const w = world();
    const base = w.buildBase();
    w.addVehicle('FIRE_BOAT', base.id);
    expect(boatCapabilities(w.career).has('WATER_RESCUE')).toBe(true);
    const inc = w.incident(w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 }));
    expect(inc.waterSupport).toBeNull();
    expect(inc.requirements.every((r) => r.externalSource !== 'COAST_GUARD')).toBe(true);
  });
});

describe('spawn gate: only water incidents the career can handle', () => {
  it('follows the backend verdict (boats → every allowed water; Coast Guard → sea only, with a player part)', () => {
    const w = world(15);
    // No boat: the vessel adrift gives the player nothing to do at the shore → never; the swimmer → the sea, CG-only.
    expect(spawnVerdict(w.career, template('TECH_VESSEL_ADRIFT'))).toEqual({
      bodies: [],
      coastGuardOnly: false,
    });
    expect(spawnVerdict(w.career, template('MED_SWIMMER_DISTRESS'))).toEqual({
      bodies: ['SEA'],
      coastGuardOnly: true,
    });
    expect(spawnVerdict(w.career, template('MULTI_PERSON_IN_WATER')).bodies).toEqual(['SEA']);
    const base = w.buildBase();
    w.addVehicle('FIRE_BOAT', base.id);
    // With a boat: the river too (Pescara has no lake point), never CG-only.
    expect(spawnVerdict(w.career, template('MULTI_PERSON_IN_WATER'))).toEqual({
      bodies: ['SEA', 'RIVER'],
      coastGuardOnly: false,
    });
    expect(spawnVerdict(w.career, template('TECH_VESSEL_ADRIFT')).bodies).toEqual(['SEA']);
  });

  it('never puts a water template on land nor a land template on the water (organic spawns)', () => {
    const w = world(15);
    w.engine.setDuty(w.career, true);
    for (let i = 0; i < 60; i++) {
      w.advance(90);
      for (const inc of [...w.career.incidents]) {
        const t = template(inc.templateCode);
        if (t.water) {
          expect(inc.domain, inc.templateCode).toBe('WATER');
          expect(t.water.bodies).toContain(inc.waterBody!.type);
          expect(spawnVerdict(w.career, t).bodies).toContain(inc.waterBody!.type);
        } else expect(inc.domain, inc.templateCode).toBe('LAND');
        w.engine.close(w.career, inc, 'CANCELLED', w.now());
      }
    }
  });
});

describe('dispatch gate and destinations', () => {
  it('sends land units to the meeting point for shore-side needs only, and keeps boats off land incidents', () => {
    const w = world();
    // The water tanker brings nothing a swimmer rescue needs at the shore (the fire engine would: MEDICAL_BASIC 15).
    const engineAps = w.addVehicle('FIRE_ABP');
    const ambulance = w.addVehicle('EMS_MSB');
    w.engine.qa.staffAll();
    const inc = w.incident(w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 }));
    const { options } = w.engine.dispatchOptions(w.career, inc.id);
    const aps = options.find((o) => o.vehicleId === engineAps.id)!;
    expect(aps).toMatchObject({
      dispatchable: false,
      blockedReason: 'VEHICLE_DOMAIN_MISMATCH',
      recommended: false,
    });
    const msb = options.find((o) => o.vehicleId === ambulance.id)!;
    expect(msb).toMatchObject({ dispatchable: true, destination: 'MEETING_POINT', recommended: true });
    expect(
      msb.contributes.every((c) =>
        ['MEDICAL_BASIC', 'MEDICAL_ADVANCED', 'PATIENT_TRANSPORT'].includes(c.code),
      ),
    ).toBe(true);
    expect(code(() => w.engine.dispatch(w.career, inc.id, [engineAps.id]))).toMatchObject({
      code: 'VEHICLE_DOMAIN_MISMATCH',
    });
    // the ambulance drives to the meeting point and works there
    w.engine.dispatch(w.career, inc.id, [ambulance.id]);
    w.until(() => w.vehicle(ambulance.id).status === 'ON_SCENE');
    expect(w.vehicle(ambulance.id).position).toEqual(inc.position);
    // a boat at a land incident is refused
    const base = w.buildBase();
    const boat = w.addVehicle('FIRE_BOAT', base.id);
    const land = w.incident(w.engine.qa.spawn('FIRE_TRASH_BIN', 2));
    expect(waterGate(boat, land)).toBe('VEHICLE_DOMAIN_MISMATCH');
    const onLand = w.engine.dispatchOptions(w.career, land.id).options.find((o) => o.vehicleId === boat.id)!;
    expect(onLand).toMatchObject({ dispatchable: false, blockedReason: 'VEHICLE_DOMAIN_MISMATCH' });
  });

  it('flies an aircraft only where the incident asks for air support and its own service is called out', () => {
    const w = world(10);
    const heli = w.addVehicle('FIRE_HELI');
    w.engine.qa.staffAll();
    // A fallen tree asks for TECHNICAL_RESCUE, which the helicopter carries: still no helicopter for a tree.
    const tree = w.incident(w.engine.qa.spawn('TECH_FALLEN_TREE', 2));
    expect(airGate(heli, tree)).toBe('AIR_SUPPORT_NOT_NEEDED');
    expect(dispatchGate(heli, tree)).toBe('AIR_SUPPORT_NOT_NEEDED');
    const grounded = w.engine
      .dispatchOptions(w.career, tree.id)
      .options.find((o) => o.vehicleId === heli.id)!;
    expect(grounded).toMatchObject({
      dispatchable: false,
      blockedReason: 'AIR_SUPPORT_NOT_NEEDED',
      recommended: false,
    });
    expect(code(() => w.engine.dispatch(w.career, tree.id, [heli.id]))).toMatchObject({
      code: 'AIR_SUPPORT_NOT_NEEDED',
    });
    // Severe weather at severity 8 lists AIR_SUPPORT as RECOMMENDED and calls out the fire service: it flies.
    const storm = w.incident(w.engine.qa.spawn('MULTI_SEVERE_WEATHER', 8));
    expect(airGate(heli, storm)).toBeNull();
    const flying = w.engine.dispatchOptions(w.career, storm.id).options.find((o) => o.vehicleId === heli.id)!;
    expect(flying).toMatchObject({ dispatchable: true, blockedReason: null });
    expect(code(() => w.engine.dispatch(w.career, storm.id, [heli.id]))).toMatchObject({ code: 'OK' });
    // Ground vehicles are never concerned by the air rule.
    const aps = w.career.vehicles.find((v) => v.typeCode === 'FIRE_APS')!;
    expect(airGate(aps, tree)).toBeNull();
  });
});

describe('Base nautica: the only home of the boats (D-23)', () => {
  it('lists nautical sites, builds the base only there, and keeps boats out of fire stations', () => {
    const w = world(7);
    const sites = listSites(w.engine, w.career, null, null, 'NAUTICAL');
    expect(sites).toHaveLength(NAUTICAL_SITES.length);
    for (const s of sites) {
      expect(SiteDto.safeParse(s).success).toBe(true);
      expect(s.nautical).toMatchObject({ waterBody: 'SEA', waterBodyId: 'sea:adriatic' });
      expect(s.options.map((o) => o.facilityTypeCode)).toEqual(['NAUTICAL_BASE']);
      expect(s.options[0]).toMatchObject({
        family: 'SHARED',
        price: '7000',
        requiredLevel: 6,
        available: true,
      });
    }
    expect(listSites(w.engine, w.career, null, null, 'STANDARD').some((s) => s.nautical)).toBe(false);
    // a Base nautica never on a standard site
    const standard = listSites(w.engine, w.career, null, 'FIRE', 'STANDARD').find((s) => !s.owned)!;
    expect(
      code(() =>
        acquireFacility(w.engine, w.career, { siteId: standard.id, facilityTypeCode: 'NAUTICAL_BASE' }),
      ),
    ).toMatchObject({ code: 'NAUTICAL_SITE_REQUIRED', details: { reason: 'NAUTICAL_SITE_REQUIRED' } });
    // a boat never in a fire station
    const station = w.career.facilities[0]!;
    expect(
      code(() => w.engine.buyVehicle(w.career, { vehicleTypeCode: 'EMS_JETSKI', facilityId: station.id })),
    ).toMatchObject({
      code: 'NEEDS_NAUTICAL_BASE',
      details: { reason: 'NEEDS_NAUTICAL_BASE', facilityTypeCode: station.typeCode },
    });
    // the base: WATER only, its berth on the water, PIER instead of a garage
    const detail = acquireFacility(w.engine, w.career, {
      siteId: w.nauticalSite().id,
      facilityTypeCode: 'NAUTICAL_BASE',
    });
    expect(detail.nautical).toMatchObject({ waterBody: 'SEA', berth: NAUTICAL_SITES[0]!.berth });
    expect(detail.capacities.find((c) => c.domain === 'WATER')).toMatchObject({ total: 2, used: 0 });
    expect(detail.capacities.find((c) => c.domain === 'GROUND')!.total).toBe(0);
    expect(
      code(() => w.engine.buyVehicle(w.career, { vehicleTypeCode: 'EMS_JETSKI', facilityId: detail.id })),
    ).toMatchObject({ code: 'CAPACITY_EXCEEDED', details: { reason: 'FACILITY_NOT_OPERATIONAL' } });
    w.until(() => w.career.facilities.find((f) => f.id === detail.id)!.status === 'OPERATIONAL');
    const jetski = w.engine.buyVehicle(w.career, { vehicleTypeCode: 'EMS_JETSKI', facilityId: detail.id });
    expect(VehicleDto.safeParse(jetski).success).toBe(true);
    expect(jetski.position).toEqual(detail.nautical!.berth);
    w.engine.buyVehicle(w.career, { vehicleTypeCode: 'EMS_JETSKI', facilityId: detail.id });
    expect(
      code(() => w.engine.buyVehicle(w.career, { vehicleTypeCode: 'EMS_JETSKI', facilityId: detail.id })),
    ).toMatchObject({
      code: 'CAPACITY_EXCEEDED',
      details: { reason: 'NO_ROOM', upgrade: 'PIER', domain: 'WATER', total: 2, used: 2, needed: 1 },
    });
    const upgrades = w.engine.facilityDetail(w.career, detail.id).availableUpgrades.map((u) => u.code);
    expect(upgrades).toContain('PIER');
    expect(upgrades).not.toContain('GARAGE');
    const stationUpgrades = w.engine
      .facilityDetail(w.career, station.id)
      .availableUpgrades.map((u) => u.code);
    expect(stationUpgrades).not.toContain('PIER');
  });

  it('offers a free move to the first Base nautica for boats still kept at a fire station', () => {
    const w = world();
    const legacy = w.water.grandfatherBoat('FIRE_BOAT');
    const credits = BigInt(w.career.summary.credits);
    const base = w.buildBase();
    const notification = w.career.notifications.find(
      (n) => n.title.key === 'notification.NAUTICAL_BASE_READY.title',
    )!;
    expect(notification).toMatchObject({
      action: { kind: 'OPEN_VEHICLE', targetId: legacy },
      body: { key: 'notification.NAUTICAL_BASE_READY.body', params: { count: 1, facility: base.name } },
    });
    const spent = credits - BigInt(w.career.summary.credits);
    const moved = transferVehicle(w.engine, w.career, legacy, base.id);
    expect(moved.vehicle).toMatchObject({ facilityId: base.id, status: 'IN_DELIVERY' });
    expect(credits - BigInt(w.career.summary.credits)).toBe(spent); // the move itself is free
    w.until(() => w.vehicle(legacy).status === 'AVAILABLE');
    expect(w.vehicle(legacy).position).toEqual(base.nautical!.berth);
    // never back to a station
    expect(code(() => transferVehicle(w.engine, w.career, legacy, w.career.facilities[0]!.id))).toMatchObject(
      {
        code: 'NEEDS_NAUTICAL_BASE',
      },
    );
  });
});

describe('boat legs: from the berth, by trailer, from the bank', () => {
  it('DIRECT: sails from the berth to the scene, lands the rescued, back to the berth — fuel on the water only', () => {
    const w = world();
    const base = w.buildBase();
    const boat = w.addVehicle('FIRE_BOAT', base.id);
    w.engine.qa.staffAll();
    const inc = w.incident(w.water.spawnWater('MED_SWIMMER_DISTRESS', { severity: 3 }));
    const option = w.engine.dispatchOptions(w.career, inc.id).options.find((o) => o.vehicleId === boat.id)!;
    expect(option).toMatchObject({
      dispatchable: true,
      destination: 'SCENE',
      boatRoute: { kind: 'DIRECT', roadMeters: 0 },
    });
    expect(option.boatRoute!.launchPoint).toBeNull();
    w.engine.dispatch(w.career, inc.id, [boat.id]);
    w.until(() => w.vehicle(boat.id).status === 'EN_ROUTE');
    const out = w.vehicle(boat.id).movement!;
    expect(out.segments!.map((s) => s.mode)).toEqual(['WATER']);
    expect(out.segments![0]!.path).toEqual([base.nautical!.berth, sceneOf(inc)]);
    expect(out.segments![0]!.departAt).toBe(out.departAt);
    expect(out.segments!.at(-1)!.arriveAt).toBe(out.arriveAt);
    w.until(() => w.vehicle(boat.id).status === 'ON_SCENE');
    expect(w.vehicle(boat.id).position).toEqual(sceneOf(inc));
    w.until(() => w.vehicle(boat.id).status === 'RETURNING');
    const home = w.vehicle(boat.id).movement!;
    expect(home.purpose).toBe('TO_BASE');
    expect(home.segments!.map((s) => s.mode)).toEqual(['WATER', 'WATER']);
    expect(home.segments![0]!.path[1]).toEqual(w.water.waterIncident(inc.id)!.landing);
    expect(home.segments![1]!.path[1]).toEqual(base.nautical!.berth);
    const leg = w.career.legs.find((l) => l.vehicleId === boat.id)!;
    expect(leg.fuelMeters).toBe(option.boatRoute!.waterMeters);
    w.until(() => w.vehicle(boat.id).status === 'AVAILABLE');
    expect(w.vehicle(boat.id).position).toEqual(base.nautical!.berth);
  });

  it('TRAILER / BANK: a boat on another water goes by road, is launched, then sails — and comes back the same way', () => {
    const w = world();
    const base = w.buildBase();
    const boat = w.addVehicle('FIRE_BOAT', base.id);
    w.engine.qa.staffAll();
    // the river is another water: no river launch point in Pescara → launched from the bank at the meeting point
    const inc = w.incident(w.water.spawnWater('MULTI_PERSON_IN_WATER', { body: 'RIVER' }));
    const option = w.engine.dispatchOptions(w.career, inc.id).options.find((o) => o.vehicleId === boat.id)!;
    expect(option.boatRoute).toMatchObject({
      kind: 'BANK',
      launchPoint: { name: null, position: inc.position },
    });
    expect(option.boatRoute!.roadMeters).toBeGreaterThan(0);
    w.engine.dispatch(w.career, inc.id, [boat.id]);
    w.until(() => w.vehicle(boat.id).status === 'EN_ROUTE');
    const out = w.vehicle(boat.id).movement!;
    expect(out.segments!.map((s) => s.mode)).toEqual(['ROAD', 'LAUNCH', 'WATER']);
    expect(out.segments![1]!.path).toHaveLength(1);
    expect(w.career.timelines[inc.id]!.some((e) => e.text.key === 'timeline.vehicle_boat_trailer')).toBe(
      true,
    );
    w.until(() => w.vehicle(boat.id).status === 'RETURNING');
    // It lands the rescued at the bank of the meeting point — which is where it was launched: out of the water, home by road.
    expect(w.vehicle(boat.id).movement!.segments!.map((s) => s.mode)).toEqual(['WATER', 'RECOVERY', 'ROAD']);
    w.until(() => w.vehicle(boat.id).status === 'AVAILABLE');
    expect(w.vehicle(boat.id).position).toEqual(base.nautical!.berth);
  });

  it('TRAILER from a fire station to the nearest slipway of the sea', () => {
    const w = world();
    const legacy = w.water.grandfatherBoat('FIRE_BOAT');
    // the sea point nearest to the port: its slipways are within 2.5 km
    const near = WATER_POINTS.find((p) => p.key === 'COAST:w28532820:269')!;
    const inc = w.engine.spawnIncident(w.career, 'MED_SWIMMER_DISTRESS', false, { position: near.position });
    const option = w.engine.dispatchOptions(w.career, inc.id).options.find((o) => o.vehicleId === legacy)!;
    expect(option.boatRoute!.kind).toBe('TRAILER');
    expect(option.boatRoute!.launchPoint!.name).not.toBeUndefined();
    expect(option.etaSeconds).toBeGreaterThan(WATER_KNOBS.launchSeconds);
  });

  it('boats only at a Base nautica or grandfathered — the vehicle types agree', () => {
    for (const t of VEHICLE_TYPES.filter((v) => v.domain === 'WATER')) {
      expect(t.compatibleFacilityTypes, t.code).toEqual(['NAUTICAL_BASE']);
      expect(t.waterSpeedKmh, t.code).toBeGreaterThan(0);
    }
  });
});
