import { describe, expect, it } from 'vitest';
import {
  InventoryLineDto,
  ItemTypeDto,
  MaintenanceOrderDto,
  MaintenanceStatusDto,
  OrderDto,
  VehicleHistoryEntry,
  type RealtimeEnvelope,
} from '@/contracts';
import { InventoryOverview, MaintenanceOverview } from '@/contracts';
import { ITEM_TYPES, VEHICLE_TYPES, xpThreshold } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { installQa } from '../qa';
import {
  URGENT,
  dueStateFor,
  failureProbability,
  failureRiskFor,
  healthBandFor,
  installLogistics,
  logisticsOf,
  logisticsState,
  quoteOrder,
  wearDelta,
} from './logistics';

function world(opts: { level?: number; credits?: number; random?: () => number } = {}) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  let seed = 42;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: opts.random ?? (() => (seed = (seed * 16807) % 2147483647) / 2147483647),
  });
  installLogistics(engine);
  installQa(engine);
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      engine.process();
    }
  };
  const ch = engine.requestOtp('log@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Logistics',
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
  const tutorial = career.incidents.find((i) => i.isTutorial)!;
  engine.close(career, tutorial, 'CANCELLED', now);
  career.pendingOutcomes = [];
  engine.advanceTutorial(career, 'DONE');
  engine.cancelActions(career, (a) => a.type === 'INCIDENT_SPAWN');
  career.summary = { ...career.summary, onDuty: false };
  if (opts.level) engine.awardXp(career, xpThreshold(opts.level));
  if (opts.credits !== undefined)
    engine.credit(career, opts.credits - Number(career.summary.credits), 'ADMIN_ADJUSTMENT');
  const domain = logisticsOf(engine);
  const vehicle = () => career.vehicles[0]!;
  return { engine, events, advance, career, domain, vehicle, now: () => now };
}

const APS = VEHICLE_TYPES.find((t) => t.code === 'FIRE_APS')!;

describe('maintenance rules', () => {
  it('maps health to the catalog bands', () => {
    expect(healthBandFor(100)).toBe('EXCELLENT');
    expect(healthBandFor(89.9)).toBe('GOOD');
    expect(healthBandFor(74)).toBe('WORN');
    expect(healthBandFor(49)).toBe('HIGH_RISK');
    expect(healthBandFor(24)).toBe('CRITICAL');
    expect(healthBandFor(0)).toBe('INOPERABLE');
  });
  it('derives the due state from km OR missions since the last service', () => {
    const base = { km: 0, missions: 0, kmAtService: 0, missionsAtService: 0 };
    expect(dueStateFor(APS, base)).toBe('NOT_DUE');
    expect(dueStateFor(APS, { ...base, missions: APS.maintenance.intervalMissions * 0.8 })).toBe('UPCOMING');
    expect(dueStateFor(APS, { ...base, km: APS.maintenance.intervalKm })).toBe('DUE');
    expect(dueStateFor(APS, { ...base, km: APS.maintenance.intervalKm * 1.3 })).toBe('OVERDUE');
    expect(dueStateFor(APS, { ...base, km: 5000, kmAtService: 4990 })).toBe('NOT_DUE');
  });
  it('keeps the failure risk LOW for a healthy vehicle and raises it with band × overdue', () => {
    const healthy = failureProbability(APS.baseFailureRate, 'EXCELLENT', 'NOT_DUE');
    expect(healthy).toBeLessThan(0.005);
    expect(failureRiskFor(healthy)).toBe('LOW');
    expect(failureRiskFor(failureProbability(APS.baseFailureRate, 'WORN', 'DUE'))).toBe('MEDIUM');
    expect(failureRiskFor(failureProbability(APS.baseFailureRate, 'HIGH_RISK', 'OVERDUE'))).toBe('HIGH');
    expect(failureRiskFor(failureProbability(APS.baseFailureRate, 'CRITICAL', 'NOT_DUE'))).toBe('HIGH');
  });
  it('wears a tired vehicle faster', () => {
    expect(wearDelta(APS, 10, 30)).toBeGreaterThan(wearDelta(APS, 10, 95));
  });
});

describe('supplies quote', () => {
  it('urgent orders are faster and pricier', () => {
    const lines = [{ itemCode: 'FOAM', quantity: 100 }];
    const normal = quoteOrder(lines, false);
    const urgent = quoteOrder(lines, true);
    expect(urgent.total).toBe(Math.round(normal.total * URGENT.priceMultiplier));
    expect(urgent.deliverySeconds).toBeLessThan(normal.deliverySeconds);
    expect(normal.packs).toBe(2);
  });
});

describe('inventory', () => {
  it('has no stock before the INVENTORY feature and starter stock of the unlocked family afterwards', () => {
    const early = world();
    expect(InventoryOverview.parse(early.domain.inventoryOverview(early.career)).lines).toEqual([]);
    const w = world({ level: 3 });
    const overview = InventoryOverview.parse(w.domain.inventoryOverview(w.career));
    expect(overview.lines.map((l) => l.itemCode).sort()).toEqual(['ABSORBENT', 'EXTRICATION_KIT', 'FOAM']);
    for (const line of overview.lines) {
      InventoryLineDto.parse(line);
      expect(line.quantity).toBe(ITEM_TYPES.find((i) => i.code === line.itemCode)!.starterStock);
      expect(line.low).toBe(false);
    }
    for (const item of w.domain.itemTypes(w.career)) ItemTypeDto.parse(item);
  });

  it('reserves at dispatch, consumes at mission end and never lets stock go negative', () => {
    const w = world({ level: 3 });
    w.domain.ensureStock(w.career);
    const incident = w.engine.spawnIncident(w.career, 'FIRE_VEHICLE', false, { severity: 3 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    const foam = () => logisticsState(w.career).stock[w.vehicle().facilityId]!.FOAM!;
    expect(foam().reserved).toBe(20); // base 5 + 5 × severity 3
    expect(w.events.some((e) => e.type === 'inventory.updated')).toBe(true);
    w.advance(600_000, 1000);
    expect(w.career.incidents).toHaveLength(0);
    expect(foam().reserved).toBe(0);
    expect(foam().quantity).toBeLessThan(100);
    expect(foam().quantity).toBeGreaterThanOrEqual(80);
    const history = w.domain.history(w.career, w.vehicle().id);
    expect(history.map((h) => h.kind)).toEqual(expect.arrayContaining(['MISSION', 'RESTOCKED']));
    for (const h of history) VehicleHistoryEntry.parse(h);
  });

  it('releases the reservation of a cancelled incident without consuming', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_VEHICLE', false, { severity: 3 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    w.engine.close(w.career, w.career.incidents[0]!, 'CANCELLED', w.now());
    const foam = logisticsState(w.career).stock[w.vehicle().facilityId]!.FOAM!;
    expect(foam).toMatchObject({ quantity: 100, reserved: 0 });
  });

  it('missing stock warns on the dispatch option but never blocks the dispatch', () => {
    const w = world({ level: 3 });
    w.domain.drainStock(w.career, 'FOAM', 1000);
    const incident = w.engine.spawnIncident(w.career, 'FIRE_VEHICLE', false, { severity: 3 });
    const option = w.engine.dispatchOptions(w.career, incident.id).options[0]!;
    expect(option.dispatchable).toBe(true);
    expect(option.warnings).toContain('INVENTORY_LOW');
    expect(() => w.engine.dispatch(w.career, incident.id, [w.vehicle().id])).not.toThrow();
    const total = w.career.incidents[0]!.work.total;
    w.advance(120_000, 1000);
    // the shortage slowed the work a little, the mission still completes
    const live = w.career.incidents[0];
    if (live) expect(live.work.total).toBeGreaterThan(total);
    w.advance(900_000, 1000);
    expect(w.career.incidents).toHaveLength(0);
    expect(logisticsState(w.career).stock[w.vehicle().facilityId]!.FOAM!.quantity).toBe(0);
  });

  it('notifies low stock once per cooldown', () => {
    const w = world({ level: 3 });
    w.domain.drainStock(w.career, 'FOAM', 70);
    w.domain.drainStock(w.career, 'FOAM', 5);
    const low = w.career.notifications.filter((n) => n.title.key === 'notifications.lowStock');
    expect(low).toHaveLength(1);
    expect(low[0]!.category).toBe('FACILITIES');
    const line = InventoryOverview.parse(w.domain.inventoryOverview(w.career)).lines.find(
      (l) => l.itemCode === 'FOAM',
    )!;
    expect(line).toMatchObject({ quantity: 25, low: true });
  });

  it('orders: SUPPLIES ledger, inbound, delivery timer, urgent pricing', () => {
    const w = world({ level: 3, credits: 1000 });
    const facilityId = w.career.facilities[0]!.id;
    w.domain.drainStock(w.career, 'FOAM', 100);
    const order = OrderDto.parse(
      w.domain.placeOrder(w.career, {
        facilityId,
        lines: [{ itemCode: 'FOAM', quantity: 100 }],
        urgent: true,
      }),
    );
    expect(order).toMatchObject({ kind: 'SUPPLIES', status: 'IN_DELIVERY', total: '300' });
    expect(w.career.summary.credits).toBe('700');
    expect(w.career.ledger[0]).toMatchObject({ entryType: 'SUPPLIES', amount: '-300' });
    const foam = logisticsState(w.career).stock[facilityId]!.FOAM!;
    expect(foam).toMatchObject({ quantity: 0, inbound: 100 });
    expect(w.engine.findAction(w.career, ['SUPPLY_DELIVERED'], order.id)).toBeDefined();
    // a speed-up completes it through the normal executor
    w.engine.completeNow(w.career, w.engine.findAction(w.career, ['SUPPLY_DELIVERED'], order.id)!);
    expect(foam).toMatchObject({ quantity: 100, inbound: 0 });
    const overview = InventoryOverview.parse(w.domain.inventoryOverview(w.career));
    expect(overview.orders[0]!.status).toBe('DELIVERED');
  });

  it('rejects partial packs, locked items, full storage and unaffordable orders', () => {
    const w = world({ level: 3, credits: 50 });
    const facilityId = w.career.facilities[0]!.id;
    const order = (lines: { itemCode: string; quantity: number }[]) =>
      w.domain.placeOrder(w.career, { facilityId, lines, urgent: false });
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as MockError).code;
      }
      return 'OK';
    };
    expect(code(() => order([{ itemCode: 'FOAM', quantity: 30 }]))).toBe('VALIDATION_ERROR');
    expect(code(() => order([{ itemCode: 'MEDICAL_PACK', quantity: 10 }]))).toBe('NOT_UNLOCKED');
    expect(code(() => order([{ itemCode: 'FOAM', quantity: 5000 }]))).toBe('CAPACITY_EXCEEDED');
    expect(code(() => order([{ itemCode: 'FOAM', quantity: 50 }]))).toBe('INSUFFICIENT_CREDITS');
    expect(w.career.summary.credits).toBe('50');
    const early = world({ credits: 500 });
    expect(
      code(() =>
        early.domain.placeOrder(early.career, {
          facilityId: early.career.facilities[0]!.id,
          lines: [{ itemCode: 'FOAM', quantity: 50 }],
        }),
      ),
    ).toBe('LEVEL_TOO_LOW');
  });
});

describe('maintenance', () => {
  it('wears the vehicle on return using the leg distance and keeps the snapshot in sync', () => {
    const w = world({ level: 3 });
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    w.advance(600_000, 1000);
    expect(w.vehicle().status).toBe('AVAILABLE');
    expect(w.vehicle().health).toBeLessThan(100);
    const status = MaintenanceStatusDto.parse(w.domain.maintenanceStatus(w.career, w.vehicle()));
    expect(status.missions).toBe(1);
    expect(status.km).toBeGreaterThan(0);
    expect(status.health).toBe(w.vehicle().health);
    expect(status.healthBand).toBe(healthBandFor(w.vehicle().health));
  });

  it('SERVICE: charges, occupies the workshop, restores health and resets the schedule', () => {
    const w = world({ level: 3, credits: 500 });
    w.domain.setHealth(w.career, w.vehicle().id, 60);
    const before = MaintenanceStatusDto.parse(w.domain.maintenanceStatus(w.career, w.vehicle()));
    expect(before).toMatchObject({ healthBand: 'WORN', due: 'DUE' });
    expect(before.quotes.map((q) => q.kind)).toEqual(['SERVICE', 'REPAIR']);
    const order = MaintenanceOrderDto.parse(w.domain.startWork(w.career, w.vehicle().id, 'SERVICE'));
    expect(order.status).toBe('IN_PROGRESS');
    expect(w.vehicle().status).toBe('MAINTENANCE');
    expect(w.career.ledger[0]).toMatchObject({
      entryType: 'MAINTENANCE',
      amount: String(-APS.maintenance.routineCost),
    });
    const overview = MaintenanceOverview.parse(w.domain.maintenanceOverview(w.career));
    expect(overview.workshops[0]).toMatchObject({ slots: 1, busy: 1 });
    expect(() => w.domain.startWork(w.career, w.vehicle().id, 'SERVICE')).toThrowError(MockError);
    expect(w.engine.findAction(w.career, ['MAINTENANCE_DONE'], order.id)).toBeDefined();
    w.advance(APS.maintenance.routineSeconds * 1000 + 2000, 1000);
    expect(w.vehicle()).toMatchObject({
      status: 'AVAILABLE',
      health: 85,
      healthBand: 'GOOD',
      busyUntil: null,
    });
    expect(MaintenanceStatusDto.parse(w.domain.maintenanceStatus(w.career, w.vehicle())).due).toBe('NOT_DUE');
    expect(w.events.some((e) => e.type === 'maintenance.updated')).toBe(true);
  });

  it('queues orders beyond the workshop slots and starts them in order', () => {
    const w = world({ level: 3, credits: 5000 });
    const second = w.engine.addVehicle(w.career, 'FIRE_APS', w.career.facilities[0]!.id, true);
    w.domain.setHealth(w.career, w.vehicle().id, 60);
    w.domain.setHealth(w.career, second.id, 60);
    const a = w.domain.startWork(w.career, w.vehicle().id, 'SERVICE');
    const b = w.domain.startWork(w.career, second.id, 'SERVICE');
    expect([a.status, b.status]).toEqual(['IN_PROGRESS', 'QUEUED']);
    expect(b.endsAt).toBeNull();
    w.advance(APS.maintenance.routineSeconds * 1000 + 2000, 1000);
    const queued = logisticsState(w.career).work.find((o) => o.id === b.id)!;
    expect(queued.status).toBe('IN_PROGRESS');
    w.advance(APS.maintenance.routineSeconds * 1000 + 2000, 1000);
    expect(w.career.vehicles.every((v) => v.status === 'AVAILABLE')).toBe(true);
  });

  it('gates player-started work by the MAINTENANCE feature level', () => {
    const w = world({ level: 2, credits: 500 });
    w.domain.setHealth(w.career, w.vehicle().id, 60);
    expect(() => w.domain.startWork(w.career, w.vehicle().id, 'SERVICE')).toThrowError(/not unlocked/);
  });

  it('offers the free emergency repair only when the balance is low', () => {
    const rich = world({ level: 3, credits: 500 });
    rich.domain.setHealth(rich.career, rich.vehicle().id, 20);
    const kinds = (w: typeof rich) =>
      MaintenanceStatusDto.parse(w.domain.maintenanceStatus(w.career, w.vehicle())).quotes.map((q) => q.kind);
    expect(kinds(rich)).not.toContain('FREE_EMERGENCY_REPAIR');
    const poor = world({ level: 3, credits: 10 });
    poor.domain.setHealth(poor.career, poor.vehicle().id, 20);
    expect(kinds(poor)).toContain('FREE_EMERGENCY_REPAIR');
    const quotes = MaintenanceStatusDto.parse(
      poor.domain.maintenanceStatus(poor.career, poor.vehicle()),
    ).quotes;
    const paid = quotes.find((q) => q.kind === 'REPAIR')!;
    const free = quotes.find((q) => q.kind === 'FREE_EMERGENCY_REPAIR')!;
    expect(free.cost).toBe('0');
    expect(free.durationSeconds).toBe(paid.durationSeconds * 4);
    poor.domain.startWork(poor.career, poor.vehicle().id, 'FREE_EMERGENCY_REPAIR');
    expect(poor.career.summary.credits).toBe('10');
  });
});

describe('breakdown and automatic recovery', () => {
  it('never breaks down on tutorial incidents or during the first three missions', () => {
    const w = world({ level: 3, random: () => 0 }); // the unluckiest dice
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    w.advance(60_000, 1000);
    expect(w.career.actions.some((a) => a.type === 'BREAKDOWN')).toBe(false);
    expect(w.vehicle().status).not.toBe('BROKEN_DOWN');
  });

  it('breaks down on the road after the safe period when the dice say so', () => {
    const w = world({ level: 3, random: () => 0 });
    w.career.stats.resolved = 5;
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    w.advance(40_000, 250);
    expect(['BROKEN_DOWN', 'BEING_RECOVERED']).toContain(w.vehicle().status);
  });

  it('BROKEN_DOWN → BEING_RECOVERED → MAINTENANCE (repair) → AVAILABLE, incident recomputed, nothing lost', () => {
    const w = world({ level: 3, credits: 1000 });
    const facility = w.career.facilities[0]!;
    const incident = w.engine.spawnIncident(w.career, 'FIRE_TRASH_BIN', false, { severity: 1 });
    w.engine.dispatch(w.career, incident.id, [w.vehicle().id]);
    w.advance(20_000, 250);
    expect(w.vehicle().status).toBe('EN_ROUTE');
    w.domain.breakDown(w.career, w.vehicle().id);
    expect(w.vehicle()).toMatchObject({ status: 'BROKEN_DOWN', movement: null, incidentId: null });
    expect(w.vehicle().position).not.toEqual(facility.position);
    expect(w.vehicle().health).toBeLessThanOrEqual(30);
    expect(w.career.actions.some((a) => a.type === 'VEHICLE_ARRIVE')).toBe(false);
    expect(w.career.incidents[0]).toMatchObject({ status: 'PENDING_RESPONSE', assignedVehicleIds: [] });
    const event = w.events.find((e) => e.type === 'vehicle.broke_down')!;
    expect(event.payload).toHaveProperty('vehicle');
    expect(event.payload).toHaveProperty('incident');

    w.advance(31_000, 250);
    expect(w.vehicle().status).toBe('BEING_RECOVERED');
    expect(w.vehicle().movement?.purpose).toBe('RECOVERY');
    expect(w.career.ledger.some((l) => l.entryType === 'RECOVERY')).toBe(true);

    w.advance(400_000, 1000);
    const afterTow = w.career.ledger.find((l) => l.entryType === 'REPAIR');
    expect(afterTow).toBeDefined();
    w.advance(400_000, 1000);
    expect(w.vehicle()).toMatchObject({ status: 'AVAILABLE', health: 70, position: facility.position });
    const kinds = w.domain.history(w.career, w.vehicle().id).map((h) => h.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'BROKE_DOWN',
        'RECOVERY_STARTED',
        'RECOVERED',
        'REPAIR_STARTED',
        'REPAIR_DONE',
      ]),
    );
    expect(w.career.vehicles).toHaveLength(1);
  });

  it('a broke player is recovered and repaired for free, the balance never goes below zero', () => {
    const w = world({ level: 3, credits: 5 });
    w.domain.breakDown(w.career, w.vehicle().id);
    w.advance(1_500_000, 1000);
    expect(w.vehicle().status).toBe('AVAILABLE');
    expect(w.career.summary.credits).toBe('5');
    expect(logisticsState(w.career).work[0]!.kind).toBe('FREE_EMERGENCY_REPAIR');
  });
});
