import type { FacilityDto, I18nText, IncidentDto, VehicleDto } from '@/contracts';
import { pointAlong, type LngLat } from '@/lib/geo';
import {
  ECONOMY,
  FEATURES,
  ITEM_TYPES,
  MANAGERIAL_SCALE,
  VEHICLE_TYPES,
  type MockVehicleType,
} from '../data/catalog';
import { MockError, iso, text, type DispatchLeg, type MockCareer, type MockEngine } from '../engine';
import type { QaHelpers } from '../qa';
import { domainState } from './index';

/**
 * Simulation of the `logistics` area = the facility warehouses (analisi/07 §7) + maintenance / breakdowns / recovery
 * (Spec 11 reduced by D-31: nothing is ever lost for good, and a free slow repair always exists — analisi/05 §7.3).
 * Same design as the backend: no ticks, every future change is a scheduled action (`SUPPLY_DELIVERED`,
 * `MAINTENANCE_DONE`, `BREAKDOWN`, `RECOVERY_START`, `RECOVERY_ARRIVE`).
 * Since D-22 a vehicle carries its OWN stock (the `autonomy` domain): a mission consumes from the vehicle, and the
 * warehouse only feeds the resupply stops (shelf → vehicle, `loadOntoVehicle`). Nothing is reserved on the shelves.
 */

/* ───────────────────────────── types ───────────────────────────── */

export type HealthBand = VehicleDto['healthBand'];
export type DueState = 'NOT_DUE' | 'UPCOMING' | 'DUE' | 'OVERDUE';
export type FailureRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type WorkKind = 'SERVICE' | 'REPAIR' | 'FREE_EMERGENCY_REPAIR';

export interface StockLine {
  quantity: number;
  /** Legacy (shelf reservations, before D-22): always 0 now, kept for the wire shape and old saves. */
  reserved: number;
  inbound: number;
  /** Wall-clock ms of the last `inventory.low_stock` notification (cooldown). */
  lowNotifiedAt: number | null;
}
export interface SupplyOrder {
  id: string;
  facilityId: string;
  lines: { itemCode: string; quantity: number }[];
  urgent: boolean;
  total: number;
  placedAt: number;
  arrivesAt: number;
  status: 'IN_DELIVERY' | 'DELIVERED';
}
export interface HistoryEntry {
  at: string;
  kind: string;
  text: I18nText;
}
export interface VehicleCare {
  wear: number;
  km: number;
  missions: number;
  kmAtService: number;
  missionsAtService: number;
  history: HistoryEntry[];
}
export interface WorkOrder {
  id: string;
  vehicleId: string;
  facilityId: string;
  kind: WorkKind;
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  cost: number;
  /** Game seconds of workshop time (before mock speed). */
  seconds: number;
  createdAt: number;
  startedAt: number | null;
  endsAt: number | null;
}
export interface LogisticsState {
  stock: Record<string, Record<string, StockLine>>;
  orders: SupplyOrder[];
  care: Record<string, VehicleCare>;
  work: WorkOrder[];
}

export const logisticsState = (career: MockCareer): LogisticsState =>
  domainState<LogisticsState>(career, 'logistics', () => ({
    stock: {},
    orders: [],
    care: {},
    work: [],
  }));

/* ───────────────────────────── tuning ───────────────────────────── */

/** Urgent supplies: faster and pricier (both quotes are shown to the player). */
export const URGENT = { timeMultiplier: 0.35, priceMultiplier: 1.5 };
/** No workshop in the facility → the vehicle goes to an external garage: one implicit slot, slower. */
export const EXTERNAL_GARAGE_FACTOR = 1.5;
const LOW_STOCK_COOLDOWN_MS = 10 * 60_000;
const TOWING_SLOWDOWN = 1.6;
const MIN_TOWING_SECONDS = 60;
const HEALTH_AFTER_BREAKDOWN = 30;
const SAFE_MISSIONS = 3;
const HISTORY_LIMIT = 50;

type MaintenanceEconomy = typeof ECONOMY.maintenance & {
  wearFactor?: { healthFrom: number; factor: number }[];
  failureMultiplier?: Record<string, number>;
  overdueFailureMultiplier?: number;
};
const M = ECONOMY.maintenance as MaintenanceEconomy;
const managerial = (seconds: number) => Math.max(10, Math.round(seconds * MANAGERIAL_SCALE));
export const featureLevel = (feature: string): number =>
  FEATURES.find((f) => f.feature === feature)?.requiredLevel ?? 1;

/* ───────────────────────────── pure rules ───────────────────────────── */

export function healthBandFor(health: number): HealthBand {
  const bands = [...M.healthBands].sort((a, b) => b.from - a.from);
  return (bands.find((b) => health >= b.from)?.band ?? 'INOPERABLE') as HealthBand;
}

/** A worn vehicle wears faster (catalog `wearFactor`). */
export function wearFactorFor(health: number): number {
  const steps = [...(M.wearFactor ?? [])].sort((a, b) => b.healthFrom - a.healthFrom);
  return steps.find((s) => health >= s.healthFrom)?.factor ?? 1;
}

export function wearDelta(type: Pick<MockVehicleType, 'maintenance'>, km: number, health: number): number {
  return (km * type.maintenance.wearPerKm + type.maintenance.wearPerMission) * wearFactorFor(health);
}

/** Multi-trigger schedule (Spec 11 §23): whichever of km / missions since the last service comes first. */
export function dueStateFor(
  type: Pick<MockVehicleType, 'maintenance'>,
  care: Pick<VehicleCare, 'km' | 'missions' | 'kmAtService' | 'missionsAtService'>,
): DueState {
  const ratio = Math.max(
    (care.km - care.kmAtService) / Math.max(1, type.maintenance.intervalKm),
    (care.missions - care.missionsAtService) / Math.max(1, type.maintenance.intervalMissions),
  );
  return ratio >= 1.25 ? 'OVERDUE' : ratio >= 1 ? 'DUE' : ratio >= 0.8 ? 'UPCOMING' : 'NOT_DUE';
}

/** Probability that a departure ends in a breakdown: base rate × band multiplier × overdue multiplier. */
export function failureProbability(baseFailureRate: number, band: HealthBand, due: DueState): number {
  const multiplier = M.failureMultiplier?.[band] ?? 1;
  return baseFailureRate * multiplier * (due === 'OVERDUE' ? (M.overdueFailureMultiplier ?? 1.5) : 1);
}
export function failureRiskFor(probability: number): FailureRisk {
  return probability >= 0.03 ? 'HIGH' : probability >= 0.008 ? 'MEDIUM' : 'LOW';
}

/** Storage points = whole packs on the shelves or on their way. */
export function storageUsed(lines: Record<string, StockLine> | undefined): number {
  return Object.entries(lines ?? {}).reduce((sum, [code, line]) => {
    const pack = ITEM_TYPES.find((i) => i.code === code)?.packSize ?? 1;
    return sum + Math.ceil((line.quantity + line.inbound) / pack);
  }, 0);
}

export interface OrderQuote {
  total: number;
  deliverySeconds: number;
  packs: number;
}
/** Price and delivery time (game seconds) of a supplies order; urgent = ×1.5 price, ×0.35 time. */
export function quoteOrder(lines: { itemCode: string; quantity: number }[], urgent: boolean): OrderQuote {
  let total = 0;
  let seconds = 0;
  let packs = 0;
  for (const line of lines) {
    const item = ITEM_TYPES.find((i) => i.code === line.itemCode);
    if (!item) throw new MockError(404, 'NOT_FOUND', `Unknown item ${line.itemCode}`);
    total += item.unitPrice * line.quantity;
    seconds = Math.max(seconds, item.deliverySeconds);
    packs += Math.ceil(line.quantity / item.packSize);
  }
  return {
    total: Math.round(total * (urgent ? URGENT.priceMultiplier : 1)),
    deliverySeconds: Math.max(5, Math.round(seconds * (urgent ? URGENT.timeMultiplier : 1))),
    packs,
  };
}

/* ───────────────────────────── module ───────────────────────────── */

export interface LogisticsDomain {
  ensureStock(career: MockCareer): void;
  inventoryOverview(career: MockCareer): unknown;
  itemTypes(career: MockCareer): unknown[];
  placeOrder(
    career: MockCareer,
    body: { facilityId?: unknown; lines?: unknown; urgent?: unknown },
  ): Record<string, unknown>;
  maintenanceOverview(career: MockCareer): unknown;
  maintenanceStatus(career: MockCareer, vehicle: VehicleDto): Record<string, unknown>;
  startWork(
    career: MockCareer,
    vehicleId: string,
    kind: WorkKind,
    automatic?: boolean,
  ): Record<string, unknown>;
  history(career: MockCareer, vehicleId: string): HistoryEntry[];
  breakDown(career: MockCareer, vehicleId: string, at?: number): VehicleDto;
  setHealth(career: MockCareer, vehicleId: string, health: number): VehicleDto;
  drainStock(career: MockCareer, itemCode: string, quantity: number): void;
  /** Units on the shelves of a facility, per item (what a resupply stop can load). Creates the starter lines lazily. */
  shelf(career: MockCareer, facilityId: string): Record<string, number>;
  /**
   * A resupply stop moves units shelf → vehicle (never more than the shelf holds): returns what really moved, notifies
   * the warehouse change and the low-stock alert.
   */
  loadOntoVehicle(
    career: MockCareer,
    facilityId: string,
    loads: readonly { itemCode: string; units: number }[],
  ): { itemCode: string; units: number }[];
  /** The exact inverse of `loadOntoVehicle` (a reload before departure given back by the free undo of a dispatch). */
  unloadFromVehicle(
    career: MockCareer,
    facilityId: string,
    loads: readonly { itemCode: string; units: number }[],
  ): void;
  /** Adds a line to the vehicle history (mission, resupply, workshop…). */
  remember(career: MockCareer, vehicleId: string, kind: string, text: I18nText, at?: number): void;
}

const domains = new WeakMap<MockEngine, LogisticsDomain>();
/** The handlers reach the domain of THEIR engine through this accessor (several engines coexist in the unit tests). */
export function logisticsOf(engine: MockEngine): LogisticsDomain {
  const domain = domains.get(engine);
  if (!domain) throw new Error('logistics domain not installed');
  return domain;
}

export function installLogistics(engine: MockEngine): void {
  const typeOf = (v: VehicleDto) => VEHICLE_TYPES.find((t) => t.code === v.typeCode);
  const facilityOf = (career: MockCareer, id: string) => career.facilities.find((f) => f.id === id);
  const missionsDone = (career: MockCareer) => career.stats.resolved + career.stats.failed;

  /* ───────────── facility mirrors (STORAGE / WORKSHOP `used`) ───────────── */
  const workshopSlots = (facility: FacilityDto | undefined): number =>
    facility?.capacities.find((c) => c.domain === 'WORKSHOP')?.total ?? 0;
  const syncFacility = (career: MockCareer, facilityId: string): FacilityDto | undefined => {
    const st = logisticsState(career);
    const storage = storageUsed(st.stock[facilityId]);
    const busy = st.work.filter((w) => w.facilityId === facilityId && w.status === 'IN_PROGRESS').length;
    career.facilities = career.facilities.map((f) =>
      f.id !== facilityId
        ? f
        : {
            ...f,
            capacities: f.capacities.map((c) =>
              c.domain === 'STORAGE'
                ? { ...c, used: Math.min(storage, Math.max(c.total, storage)) }
                : c.domain === 'WORKSHOP'
                  ? { ...c, used: Math.min(busy, c.total) }
                  : c,
            ),
          },
    );
    return facilityOf(career, facilityId);
  };

  /* ───────────── inventory ───────────── */
  const itemUnlocked = (career: MockCareer, item: (typeof ITEM_TYPES)[number]) =>
    career.summary.unlockedFamilies.includes(item.family) &&
    career.summary.level >= Math.max(item.requiredLevel, featureLevel('INVENTORY'));

  /**
   * One warehouse per facility. Lines appear lazily — with their starter stock — as soon as the item is unlocked for
   * the career and the facility belongs to the item's family (new facility, new level, old save: same code path).
   */
  const ensureStock = (career: MockCareer): void => {
    const st = logisticsState(career);
    for (const facility of career.facilities) {
      if (facility.status !== 'OPERATIONAL') continue;
      for (const item of ITEM_TYPES) {
        if (item.family !== facility.family || !itemUnlocked(career, item)) continue;
        const lines = (st.stock[facility.id] ??= {});
        lines[item.code] ??= { quantity: item.starterStock, reserved: 0, inbound: 0, lowNotifiedAt: null };
      }
    }
    // Saves from before D-22 reserved shelf units per incident: those units simply go back on the shelf (the backend's
    // migration 023 releases them the same way).
    const legacy = st as LogisticsState & { reservations?: unknown; penalised?: unknown; restock?: unknown };
    if (legacy.reservations !== undefined || legacy.restock !== undefined) {
      for (const lines of Object.values(st.stock)) for (const line of Object.values(lines)) line.reserved = 0;
      delete legacy.reservations;
      delete legacy.penalised;
      delete legacy.restock;
    }
  };

  const lineDto = (facilityId: string, itemCode: string, line: StockLine) => {
    const minimum = ITEM_TYPES.find((i) => i.code === itemCode)?.lowStockThreshold ?? 0;
    return {
      facilityId,
      itemCode,
      quantity: line.quantity,
      reserved: line.reserved,
      inbound: line.inbound,
      minimum,
      low: line.quantity <= minimum,
    };
  };
  const orderDto = (career: MockCareer, order: SupplyOrder) => ({
    id: order.id,
    kind: 'SUPPLIES' as const,
    status: order.status,
    total: String(order.total),
    placedAt: iso(order.placedAt),
    arrivesAt: iso(order.arrivesAt),
    summary: text('logistics.orderSummary', {
      lines: order.lines.length,
      facility: facilityOf(career, order.facilityId)?.name ?? '',
    }),
    // additive fields (see the report of the logistics agent)
    facilityId: order.facilityId,
    urgent: order.urgent,
    lines: order.lines,
  });

  const emitInventory = (career: MockCareer, facilityId?: string, withCareer = false): void => {
    const facility = facilityId ? syncFacility(career, facilityId) : undefined;
    engine.emit(career, 'inventory.updated', {
      ...(facility ? { facility } : {}),
      ...(withCareer ? { career: career.summary } : {}),
    });
  };

  const checkLowStock = (career: MockCareer, facilityId: string): void => {
    const st = logisticsState(career);
    const now = engine.now();
    const low = Object.entries(st.stock[facilityId] ?? {}).filter(
      ([code, line]) => lineDto(facilityId, code, line).low && line.inbound === 0,
    );
    const fresh = low.filter(
      ([, line]) => line.lowNotifiedAt === null || now - line.lowNotifiedAt > LOW_STOCK_COOLDOWN_MS,
    );
    if (fresh.length === 0) return;
    for (const [, line] of low) line.lowNotifiedAt = now;
    const facility = facilityOf(career, facilityId);
    // Domain event `inventory.low_stock` (analisi/03 §8) reaches the player as a notification.
    engine.notify(career, {
      category: 'FACILITIES',
      priority: 'IMPORTANT',
      title: text('notifications.lowStock', { facility: facility?.name ?? '' }),
      body: text('notifications.lowStockBody', { count: low.length }),
      action: { kind: 'OPEN_FACILITY', targetId: facilityId },
    });
  };

  /** Units on the shelves of a facility (what a resupply stop can load onto a vehicle). */
  const shelf = (career: MockCareer, facilityId: string): Record<string, number> => {
    ensureStock(career);
    const lines = logisticsState(career).stock[facilityId] ?? {};
    return Object.fromEntries(
      Object.entries(lines).map(([code, line]) => [code, Math.max(0, line.quantity)]),
    );
  };

  /** Shelf → vehicle, capped by what is really there (D-22: the shelf only feeds the resupply stops). */
  const loadOntoVehicle: LogisticsDomain['loadOntoVehicle'] = (career, facilityId, loads) => {
    ensureStock(career);
    const lines = logisticsState(career).stock[facilityId] ?? {};
    const moved: { itemCode: string; units: number }[] = [];
    for (const load of loads) {
      const line = lines[load.itemCode];
      const units = line ? Math.min(Math.max(0, Math.floor(load.units)), line.quantity) : 0;
      if (units <= 0) continue;
      line!.quantity -= units;
      moved.push({ itemCode: load.itemCode, units });
    }
    if (moved.length > 0) {
      emitInventory(career, facilityId);
      checkLowStock(career, facilityId);
    }
    return moved;
  };

  const unloadFromVehicle: LogisticsDomain['unloadFromVehicle'] = (career, facilityId, loads) => {
    ensureStock(career);
    const lines = logisticsState(career).stock[facilityId];
    if (!lines) return;
    let moved = false;
    for (const load of loads) {
      const line = lines[load.itemCode];
      if (!line || load.units <= 0) continue;
      line.quantity += Math.floor(load.units);
      moved = true;
    }
    if (moved) emitInventory(career, facilityId);
  };

  const placeOrder: LogisticsDomain['placeOrder'] = (career, body) => {
    if (career.summary.level < featureLevel('INVENTORY'))
      throw new MockError(422, 'LEVEL_TOO_LOW', 'Inventory not unlocked', {
        requiredLevel: featureLevel('INVENTORY'),
      });
    ensureStock(career);
    const facility = facilityOf(career, String(body.facilityId));
    if (!facility) throw new MockError(404, 'NOT_FOUND', 'Facility not found');
    const raw = Array.isArray(body.lines) ? (body.lines as { itemCode?: unknown; quantity?: unknown }[]) : [];
    const lines = raw.map((l) => ({ itemCode: String(l.itemCode), quantity: Number(l.quantity) }));
    const st = logisticsState(career);
    const stock = st.stock[facility.id] ?? {};
    const invalid =
      lines.length === 0 ||
      lines.length > 20 ||
      new Set(lines.map((l) => l.itemCode)).size !== lines.length ||
      lines.some((l) => {
        const item = ITEM_TYPES.find((i) => i.code === l.itemCode);
        return !item || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity % item.packSize !== 0;
      });
    if (invalid)
      throw new MockError(422, 'VALIDATION_ERROR', 'Order lines must be whole packs of known items', {
        fields: ['lines'],
      });
    const locked = lines.find((l) => !stock[l.itemCode]);
    if (locked)
      throw new MockError(422, 'NOT_UNLOCKED', 'Item not available in this facility', {
        itemCode: locked.itemCode,
      });
    const urgent = body.urgent === true;
    const quote = quoteOrder(lines, urgent);
    const capacity = facility.capacities.find((c) => c.domain === 'STORAGE')?.total ?? 0;
    const after = lines.reduce((sum, l) => {
      const item = ITEM_TYPES.find((i) => i.code === l.itemCode)!;
      const line = stock[l.itemCode]!;
      const before = Math.ceil((line.quantity + line.inbound) / item.packSize);
      return sum - before + Math.ceil((line.quantity + line.inbound + l.quantity) / item.packSize);
    }, storageUsed(stock));
    if (after > capacity)
      throw new MockError(422, 'CAPACITY_EXCEEDED', 'Not enough storage in this facility', {
        domain: 'STORAGE',
        capacity,
        required: after,
      });
    engine.credit(career, -quote.total, 'SUPPLIES', true);
    const now = engine.now();
    const order: SupplyOrder = {
      id: engine.id('ord'),
      facilityId: facility.id,
      lines,
      urgent,
      total: quote.total,
      placedAt: now,
      arrivesAt: now + engine.dur(quote.deliverySeconds),
      status: 'IN_DELIVERY',
    };
    for (const l of lines) stock[l.itemCode]!.inbound += l.quantity;
    st.orders.unshift(order);
    engine.schedule(career, 'SUPPLY_DELIVERED', quote.deliverySeconds, order.id);
    emitInventory(career, facility.id, true);
    engine.save();
    return orderDto(career, order);
  };

  engine.registerExecutor('SUPPLY_DELIVERED', (career, action) => {
    const st = logisticsState(career);
    const order = st.orders.find((o) => o.id === action.ref);
    if (!order || order.status !== 'IN_DELIVERY') return;
    order.status = 'DELIVERED';
    order.arrivesAt = Math.min(order.arrivesAt, action.dueAt);
    for (const l of order.lines) {
      const line = st.stock[order.facilityId]?.[l.itemCode];
      if (!line) continue;
      line.inbound = Math.max(0, line.inbound - l.quantity);
      line.quantity += l.quantity;
      line.lowNotifiedAt = null;
    }
    st.orders = [
      ...st.orders.filter((o) => o.status === 'IN_DELIVERY'),
      ...st.orders.filter((o) => o.status === 'DELIVERED').slice(0, 10),
    ];
    emitInventory(career, order.facilityId);
    engine.notify(career, {
      category: 'FACILITIES',
      title: text('notifications.suppliesDelivered', {
        facility: facilityOf(career, order.facilityId)?.name ?? '',
      }),
      action: { kind: 'OPEN_FACILITY', targetId: order.facilityId },
    });
  });

  /* ───────────── maintenance: status ───────────── */
  const careOf = (career: MockCareer, vehicleId: string): VehicleCare =>
    (logisticsState(career).care[vehicleId] ??= {
      wear: 0,
      km: 0,
      missions: 0,
      kmAtService: 0,
      missionsAtService: 0,
      history: [],
    });
  const remember = (career: MockCareer, vehicleId: string, kind: string, t: I18nText, at?: number): void => {
    const care = careOf(career, vehicleId);
    care.history.unshift({ at: iso(at ?? engine.now()), kind, text: t });
    care.history = care.history.slice(0, HISTORY_LIMIT);
  };
  const setHealthValue = (career: MockCareer, vehicleId: string, health: number): VehicleDto | null => {
    const value = Math.round(Math.max(0, Math.min(100, health)) * 10) / 10;
    return engine.patchVehicle(career, vehicleId, { health: value, healthBand: healthBandFor(value) });
  };
  const openOrder = (career: MockCareer, vehicleId: string): WorkOrder | undefined =>
    logisticsState(career).work.find(
      (w) => w.vehicleId === vehicleId && (w.status === 'QUEUED' || w.status === 'IN_PROGRESS'),
    );
  const workSeconds = (career: MockCareer, vehicle: VehicleDto, kind: WorkKind): number => {
    const type = typeOf(vehicle);
    const base = kind === 'SERVICE' ? (type?.maintenance.routineSeconds ?? 60) : managerial(M.repair.seconds);
    const slow = kind === 'FREE_EMERGENCY_REPAIR' ? M.emergencyFreeRepair.secondsMultiplier : 1;
    const external = workshopSlots(facilityOf(career, vehicle.facilityId)) === 0 ? EXTERNAL_GARAGE_FACTOR : 1;
    return Math.round(base * slow * external);
  };
  const workCost = (vehicle: VehicleDto, kind: WorkKind): number => {
    const type = typeOf(vehicle);
    return kind === 'SERVICE'
      ? (type?.maintenance.routineCost ?? 0)
      : kind === 'REPAIR'
        ? Math.round((type?.price ?? 0) * M.repair.costShareOfPrice)
        : 0;
  };
  const restoresTo = (vehicle: VehicleDto, kind: WorkKind): number =>
    kind === 'SERVICE'
      ? Math.min(100, vehicle.health + M.routineHealthRestore)
      : Math.max(vehicle.health, M.repair.healthAfter);

  const maintenanceStatus: LogisticsDomain['maintenanceStatus'] = (career, vehicle) => {
    const type = typeOf(vehicle);
    const care = careOf(career, vehicle.id);
    const due = type ? dueStateFor(type, care) : 'NOT_DUE';
    const probability = failureProbability(type?.baseFailureRate ?? 0, vehicle.healthBand, due);
    const broken = ['BROKEN_DOWN', 'BEING_RECOVERED'].includes(vehicle.status);
    const kinds: WorkKind[] = [];
    if (!openOrder(career, vehicle.id) && !broken) {
      if (vehicle.health < 100 || due !== 'NOT_DUE') kinds.push('SERVICE');
      if (vehicle.health < M.repair.healthAfter) {
        kinds.push('REPAIR');
        // Anti-stall exit (analisi/05 §7.3): whoever is short of credits can always repair for free, slowly.
        if (Number(career.summary.credits) < M.emergencyFreeRepair.balanceBelow)
          kinds.push('FREE_EMERGENCY_REPAIR');
      }
    }
    return {
      vehicleId: vehicle.id,
      health: vehicle.health,
      healthBand: vehicle.healthBand,
      wear: Math.round(care.wear * 10) / 10,
      km: Math.round(care.km * 10) / 10,
      missions: care.missions,
      due,
      failureRisk: failureRiskFor(probability),
      quotes: kinds.map((kind) => ({
        kind,
        cost: String(workCost(vehicle, kind)),
        durationSeconds: Math.round(workSeconds(career, vehicle, kind) / engine.speed),
        restoresTo: restoresTo(vehicle, kind),
      })),
    };
  };

  const workDto = (w: WorkOrder) => ({
    id: w.id,
    vehicleId: w.vehicleId,
    kind: w.kind,
    status: w.status,
    cost: String(w.cost),
    startedAt: w.startedAt === null ? null : iso(w.startedAt),
    endsAt: w.endsAt === null ? null : iso(w.endsAt),
  });

  const emitMaintenance = (career: MockCareer, vehicleId: string, withCareer = false): void => {
    const vehicle = career.vehicles.find((v) => v.id === vehicleId);
    const facility = vehicle ? syncFacility(career, vehicle.facilityId) : undefined;
    engine.emit(career, 'maintenance.updated', {
      ...(vehicle ? { vehicle } : {}),
      ...(facility ? { facility } : {}),
      ...(withCareer ? { career: career.summary } : {}),
    });
  };

  /* ───────────── maintenance: workshop queue ───────────── */
  /** Starts queued orders while the facility has a free slot (no workshop = one implicit external slot). */
  const pump = (career: MockCareer, facilityId: string, at: number): void => {
    const st = logisticsState(career);
    const slots = Math.max(1, workshopSlots(facilityOf(career, facilityId)));
    for (;;) {
      const busy = st.work.filter((w) => w.facilityId === facilityId && w.status === 'IN_PROGRESS').length;
      const next = st.work
        .filter((w) => w.facilityId === facilityId && w.status === 'QUEUED')
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (busy >= slots || !next) return;
      next.status = 'IN_PROGRESS';
      next.startedAt = at;
      next.endsAt = at + engine.dur(next.seconds);
      career.actions.push({
        id: engine.id('act'),
        type: 'MAINTENANCE_DONE',
        dueAt: next.endsAt,
        ref: next.id,
      });
      engine.patchVehicle(career, next.vehicleId, { busyUntil: iso(next.endsAt) });
      emitMaintenance(career, next.vehicleId);
    }
  };

  const startWork: LogisticsDomain['startWork'] = (career, vehicleId, kind, automatic = false) => {
    const vehicle = career.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
    if (!automatic) {
      if (career.summary.level < featureLevel('MAINTENANCE'))
        throw new MockError(422, 'LEVEL_TOO_LOW', 'Maintenance not unlocked', {
          requiredLevel: featureLevel('MAINTENANCE'),
        });
      if (vehicle.status !== 'AVAILABLE' || openOrder(career, vehicleId))
        throw new MockError(409, 'VEHICLE_NOT_AVAILABLE', 'The vehicle must be available at its facility');
      const offered = (maintenanceStatus(career, vehicle).quotes as { kind: WorkKind }[]).map((q) => q.kind);
      if (!offered.includes(kind))
        throw new MockError(422, 'INVALID_STATE_TRANSITION', 'This work is not offered for the vehicle now');
    }
    const cost = workCost(vehicle, kind);
    if (cost > 0)
      engine.credit(
        career,
        -cost,
        kind === 'SERVICE' ? 'MAINTENANCE' : 'REPAIR',
        true,
        text(kind === 'SERVICE' ? 'ledger.MAINTENANCE' : 'ledger.REPAIR'),
      );
    const now = engine.now();
    const order: WorkOrder = {
      id: engine.id('mnt'),
      vehicleId,
      facilityId: vehicle.facilityId,
      kind,
      status: 'QUEUED',
      cost,
      seconds: workSeconds(career, vehicle, kind),
      createdAt: now,
      startedAt: null,
      endsAt: null,
    };
    const st = logisticsState(career);
    st.work.unshift(order);
    engine.patchVehicle(career, vehicleId, { status: 'MAINTENANCE', busyUntil: null, movement: null });
    remember(career, vehicleId, `${kind}_STARTED`, text(`logistics.history.${kind}_STARTED`, { cost }), now);
    pump(career, vehicle.facilityId, now);
    emitMaintenance(career, vehicleId, true);
    engine.save();
    return workDto(order);
  };

  engine.registerExecutor('MAINTENANCE_DONE', (career, action) => {
    const st = logisticsState(career);
    const order = st.work.find((w) => w.id === action.ref);
    if (!order || order.status !== 'IN_PROGRESS') return;
    order.status = 'COMPLETED';
    order.endsAt = Math.min(order.endsAt ?? action.dueAt, action.dueAt);
    const vehicle = career.vehicles.find((v) => v.id === order.vehicleId);
    if (vehicle) {
      const care = careOf(career, vehicle.id);
      if (order.kind === 'SERVICE') {
        care.wear = 0;
        care.kmAtService = care.km;
        care.missionsAtService = care.missions;
      } else care.wear = Math.min(care.wear, 100 - M.repair.healthAfter);
      setHealthValue(career, vehicle.id, restoresTo(vehicle, order.kind));
      engine.patchVehicle(career, vehicle.id, { status: 'AVAILABLE', busyUntil: null });
      remember(
        career,
        vehicle.id,
        `${order.kind}_DONE`,
        text(`logistics.history.${order.kind}_DONE`),
        action.dueAt,
      );
      engine.notify(career, {
        category: 'FLEET',
        title: text('notifications.maintenanceDone', { callSign: vehicle.callSign }),
        action: { kind: 'OPEN_VEHICLE', targetId: vehicle.id },
      });
    }
    st.work = [
      ...st.work.filter((w) => w.status === 'QUEUED' || w.status === 'IN_PROGRESS'),
      ...st.work.filter((w) => w.status === 'COMPLETED' || w.status === 'CANCELLED').slice(0, 10),
    ];
    emitMaintenance(career, order.vehicleId);
    pump(career, order.facilityId, action.dueAt);
  });

  /* ───────────── breakdown + automatic recovery ───────────── */
  const currentPosition = (vehicle: VehicleDto, at: number): LngLat => {
    if (!vehicle.movement) return vehicle.position;
    const depart = Date.parse(vehicle.movement.departAt);
    const arrive = Date.parse(vehicle.movement.arriveAt);
    return pointAlong(
      vehicle.movement.path,
      Math.min(1, Math.max(0, (at - depart) / Math.max(1, arrive - depart))),
    ).position;
  };

  const breakDown: LogisticsDomain['breakDown'] = (career, vehicleId, at = engine.now()) => {
    const vehicle = career.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
    // A vehicle carrying a patient never breaks down in the mock: the medical flow owns it until the hand-off.
    const immune = [
      'IN_DELIVERY',
      'MAINTENANCE',
      'BROKEN_DOWN',
      'BEING_RECOVERED',
      'TRANSPORTING',
      'AT_HOSPITAL',
    ];
    if (
      immune.includes(vehicle.status) ||
      vehicle.status === 'RESTOCKING' ||
      vehicle.status === 'OUT_OF_SERVICE'
    )
      throw new MockError(409, 'INVALID_STATE_TRANSITION', 'The vehicle cannot break down in this state');
    const incidentId = vehicle.incidentId;
    engine.cancelActions(
      career,
      (a) =>
        a.ref === vehicle.id &&
        ['VEHICLE_DEPART', 'VEHICLE_ARRIVE', 'VEHICLE_RETURNED', 'BREAKDOWN'].includes(a.type),
    );
    // Fuel of the share of the leg really driven, before the vehicle stops where it is (D-22).
    for (const hook of engine.hooks.vehicleBrokeDown) hook(career, vehicle, at);
    // The tow truck (a system unit, never owned) needs a moment to reach the vehicle.
    const towAt = at + engine.dur(managerial(M.recovery.baseSeconds) / 2);
    setHealthValue(career, vehicle.id, Math.min(vehicle.health, HEALTH_AFTER_BREAKDOWN));
    const broken = engine.patchVehicle(career, vehicle.id, {
      status: 'BROKEN_DOWN',
      position: currentPosition(vehicle, at),
      movement: null,
      incidentId: null,
      busyUntil: iso(towAt),
    })!;
    career.actions.push({ id: engine.id('act'), type: 'RECOVERY_START', dueAt: towAt, ref: vehicle.id });
    remember(career, vehicle.id, 'BROKE_DOWN', text('logistics.history.BROKE_DOWN'), at);
    let incident: IncidentDto | null = null;
    if (incidentId) {
      engine.log(
        career,
        incidentId,
        'vehicle.broke_down',
        text('timeline.vehicle_broke_down', { callSign: vehicle.callSign }),
        at,
        vehicle.id,
      );
      incident = engine.recompute(career, incidentId, at);
      // Same rule as a recall: an incident left without vehicles can expire again.
      if (incident?.status === 'PENDING_RESPONSE' && !incident.isTutorial)
        engine.schedule(career, 'INCIDENT_EXPIRE', 600, incidentId);
    }
    engine.emit(career, 'vehicle.broke_down', { vehicle: broken, ...(incident ? { incident } : {}) });
    engine.notify(career, {
      category: 'FLEET',
      priority: 'IMPORTANT',
      title: text('notifications.vehicleBrokeDown', { callSign: vehicle.callSign }),
      body: text('notifications.vehicleBrokeDownBody'),
      action: { kind: 'OPEN_VEHICLE', targetId: vehicle.id },
    });
    engine.save();
    return broken;
  };

  engine.registerExecutor('BREAKDOWN', (career, action) => {
    const vehicle = career.vehicles.find((v) => v.id === action.ref);
    if (vehicle?.status === 'EN_ROUTE') breakDown(career, vehicle.id, action.dueAt);
  });

  engine.registerExecutor('RECOVERY_START', (career, action) => {
    const vehicle = career.vehicles.find((v) => v.id === action.ref);
    const facility = vehicle ? facilityOf(career, vehicle.facilityId) : undefined;
    if (!vehicle || vehicle.status !== 'BROKEN_DOWN' || !facility) return;
    const at = action.dueAt;
    // Recovery is charged only when the player can afford it: the balance never goes below zero (D-31).
    const cost = M.recovery.cost;
    const charged = Number(career.summary.credits) >= cost;
    if (charged) engine.credit(career, -cost, 'RECOVERY', false, text('ledger.RECOVERY'));
    const { path, distanceMeters } = engine.route(
      vehicle.position,
      facility.position,
      `${vehicle.id}tow${at}`,
    );
    // Hooking the vehicle up takes a while even when it failed in its own yard.
    const seconds = Math.max(
      MIN_TOWING_SECONDS,
      Math.round(engine.travelSeconds(distanceMeters, vehicle.typeCode, career, path) * TOWING_SLOWDOWN),
    );
    const arriveAt = at + engine.dur(seconds);
    const towed = engine.patchVehicle(career, vehicle.id, {
      status: 'BEING_RECOVERED',
      busyUntil: iso(arriveAt),
      movement: { path, departAt: iso(at), arriveAt: iso(arriveAt), distanceMeters, purpose: 'RECOVERY' },
    })!;
    career.actions.push({ id: engine.id('act'), type: 'RECOVERY_ARRIVE', dueAt: arriveAt, ref: vehicle.id });
    remember(
      career,
      vehicle.id,
      'RECOVERY_STARTED',
      text(charged ? 'logistics.history.RECOVERY_STARTED' : 'logistics.history.RECOVERY_STARTED_FREE', {
        cost,
      }),
      at,
    );
    engine.emit(career, 'vehicle.updated', { vehicle: towed });
  });

  /** Vehicles being towed home skip the wear of a normal return (they did not drive). */
  const towedHome = new WeakMap<MockCareer, Set<string>>();

  engine.registerExecutor('RECOVERY_ARRIVE', (career, action) => {
    const vehicle = career.vehicles.find((v) => v.id === action.ref);
    const facility = vehicle ? facilityOf(career, vehicle.facilityId) : undefined;
    if (!vehicle || vehicle.status !== 'BEING_RECOVERED' || !facility) return;
    engine.patchVehicle(career, vehicle.id, {
      status: 'MAINTENANCE',
      position: facility.position,
      movement: null,
      busyUntil: null,
    });
    remember(career, vehicle.id, 'RECOVERED', text('logistics.history.RECOVERED'), action.dueAt);
    // The crew is home too: the other domains release it exactly as after a normal return.
    const leg = [...career.legs].reverse().find((l) => l.vehicleId === vehicle.id) ?? null;
    const skip = towedHome.get(career) ?? new Set<string>();
    towedHome.set(career, skip.add(vehicle.id));
    for (const hook of engine.hooks.vehicleReturned)
      hook(
        career,
        career.vehicles.find((v) => v.id === vehicle.id)!,
        leg,
      );
    skip.delete(vehicle.id);
    // Never strand the player: the repair starts by itself, paid when affordable, free and slow otherwise.
    const current = career.vehicles.find((v) => v.id === vehicle.id)!;
    const affordable = Number(career.summary.credits) >= workCost(current, 'REPAIR');
    startWork(career, vehicle.id, affordable ? 'REPAIR' : 'FREE_EMERGENCY_REPAIR', true);
  });

  /* ───────────── engine hooks ───────────── */
  engine.hooks.careerCreated.push((career) => ensureStock(career));
  engine.hooks.levelReached.push((career) => {
    ensureStock(career);
    emitInventory(career);
  });

  // The stock a mission needs travels ON the vehicle (D-22, the `autonomy` domain): no shelf reservation at dispatch,
  // and the warnings of a dispatch option (`STOCK_MISSING:<item>` / `STOCK_LOW:<item>`) are about the stock on board.

  engine.hooks.vehicleDeparting.push((career, vehicle, at) => {
    const incident = career.incidents.find((i) => i.id === vehicle.incidentId);
    const type = typeOf(vehicle);
    // Breakdowns are rare by design, and impossible while the player is learning or cannot maintain vehicles yet.
    if (
      !incident ||
      !type ||
      incident.isTutorial ||
      missionsDone(career) < SAFE_MISSIONS ||
      career.summary.level < featureLevel('MAINTENANCE')
    )
      return 'OK';
    const probability = failureProbability(
      type.baseFailureRate,
      vehicle.healthBand,
      dueStateFor(type, careOf(career, vehicle.id)),
    );
    if (engine.random() >= probability) return 'OK';
    // It happens on the road: same deterministic route the core is about to compute for this leg.
    const { path, distanceMeters } = engine.route(
      vehicle.position,
      incident.position,
      vehicle.id + incident.id,
      vehicle.typeCode,
    );
    const travel = engine.dur(engine.travelSeconds(distanceMeters, vehicle.typeCode, career, path));
    career.actions.push({
      id: engine.id('act'),
      type: 'BREAKDOWN',
      dueAt: at + travel * (0.3 + 0.4 * engine.random()),
      ref: vehicle.id,
    });
    return 'OK';
  });

  const onReturned = (career: MockCareer, vehicle: VehicleDto, leg: DispatchLeg | null): void => {
    const type = typeOf(vehicle);
    const towed = towedHome.get(career)?.has(vehicle.id) ?? false;
    if (type && !towed) {
      const care = careOf(career, vehicle.id);
      // The leg stores the outbound distance: the way back is about as long.
      const km = ((leg?.distanceMeters ?? 0) / 1000) * 2;
      const delta = wearDelta(type, km, vehicle.health);
      care.km += km;
      care.missions += 1;
      care.wear = Math.min(100, care.wear + delta);
      setHealthValue(career, vehicle.id, vehicle.health - delta);
      remember(
        career,
        vehicle.id,
        'MISSION',
        text('logistics.history.MISSION', { km: Math.round(km * 10) / 10 }),
      );
    }
    // Whether the vehicle now stops to reload is the single resupply rule's call (the `autonomy` domain).
    engine.emit(career, 'maintenance.updated', {});
  };
  engine.hooks.vehicleReturned.push(onReturned);

  /* ───────────── read models ───────────── */
  const inventoryOverview: LogisticsDomain['inventoryOverview'] = (career) => {
    ensureStock(career);
    const st = logisticsState(career);
    return {
      lines: Object.entries(st.stock).flatMap(([facilityId, lines]) =>
        facilityOf(career, facilityId)
          ? Object.entries(lines).map(([code, line]) => lineDto(facilityId, code, line))
          : [],
      ),
      orders: st.orders.map((o) => orderDto(career, o)),
      // additive
      urgent: URGENT,
      storage: career.facilities.map((f) => ({
        facilityId: f.id,
        capacity: f.capacities.find((c) => c.domain === 'STORAGE')?.total ?? 0,
        used: storageUsed(st.stock[f.id]),
      })),
    };
  };
  const itemTypes: LogisticsDomain['itemTypes'] = (career) =>
    ITEM_TYPES.map((i) => ({
      code: i.code,
      name: text(`item.${i.code}.name`),
      unit: `item.${i.code}.unit`,
      price: String(i.unitPrice),
      deliverySeconds: Math.round(i.deliverySeconds / engine.speed),
      // additive
      packSize: i.packSize,
      family: i.family,
      requiredLevel: Math.max(i.requiredLevel, featureLevel('INVENTORY')),
      unlocked: itemUnlocked(career, i),
      icon: i.icon,
    }));
  const maintenanceOverview: LogisticsDomain['maintenanceOverview'] = (career) => {
    const st = logisticsState(career);
    return {
      vehicles: career.vehicles
        .filter((v) => v.status !== 'IN_DELIVERY')
        .map((v) => maintenanceStatus(career, v)),
      orders: st.work.map(workDto),
      workshops: career.facilities.map((f) => ({
        facilityId: f.id,
        slots: workshopSlots(f),
        busy: st.work.filter((w) => w.facilityId === f.id && w.status === 'IN_PROGRESS').length,
      })),
    };
  };

  const domain: LogisticsDomain = {
    ensureStock,
    inventoryOverview,
    itemTypes,
    placeOrder,
    maintenanceOverview,
    maintenanceStatus,
    startWork,
    history: (career, vehicleId) => {
      if (!career.vehicles.some((v) => v.id === vehicleId))
        throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
      return careOf(career, vehicleId).history;
    },
    breakDown,
    setHealth: (career, vehicleId, health) => {
      const vehicle = career.vehicles.find((v) => v.id === vehicleId);
      const type = vehicle ? typeOf(vehicle) : undefined;
      if (!vehicle || !type) throw new MockError(404, 'NOT_FOUND', 'Vehicle not found');
      const care = careOf(career, vehicleId);
      care.wear = 100 - health;
      // A neglected vehicle is also behind on its schedule: GOOD or better keeps it, below WORN it is overdue.
      const lag = health >= 75 ? 0 : health >= 50 ? 1.05 : 1.3;
      care.missions = Math.max(
        care.missions,
        care.missionsAtService + Math.ceil(type.maintenance.intervalMissions * lag),
      );
      const patched = setHealthValue(career, vehicleId, health)!;
      emitMaintenance(career, vehicleId);
      engine.save();
      return patched;
    },
    drainStock: (career, itemCode, quantity) => {
      ensureStock(career);
      const st = logisticsState(career);
      for (const [facilityId, lines] of Object.entries(st.stock)) {
        const line = lines[itemCode];
        if (!line) continue;
        line.quantity = Math.max(0, line.quantity - quantity);
        emitInventory(career, facilityId);
        checkLowStock(career, facilityId);
      }
      engine.save();
    },
    shelf,
    loadOntoVehicle,
    unloadFromVehicle,
    remember,
  };
  domains.set(engine, domain);

  /* ───────────── QA helpers ───────────── */
  const helpers = {
    /** Breaks a vehicle down right now (default: the first one on the road, else the first that can). */
    breakDown: (vehicleId?: string) => {
      const career = engine.qa.career();
      const pick =
        career.vehicles.find((v) => v.id === vehicleId) ??
        career.vehicles.find((v) => v.status === 'EN_ROUTE') ??
        career.vehicles.find((v) => ['PREPARING', 'ON_SCENE', 'RETURNING'].includes(v.status)) ??
        career.vehicles.find((v) => v.status === 'AVAILABLE');
      if (!pick) throw new MockError(404, 'NOT_FOUND', 'No vehicle can break down');
      return breakDown(career, pick.id).id;
    },
    /** Sets the health (and a matching service backlog) of a vehicle; without an id: the first vehicle. */
    wear: (vehicleId: string | null, health: number) => {
      const career = engine.qa.career();
      const id = vehicleId ?? career.vehicles[0]?.id;
      if (!id) throw new MockError(404, 'NOT_FOUND', 'No vehicle');
      return domain.setHealth(career, id, health).id;
    },
    /** Removes `quantity` units of an item from every warehouse that stocks it. */
    drainStock: (itemCode: string, quantity: number) =>
      domain.drainStock(engine.qa.career(), itemCode, quantity),
  };
  // `installQa` runs after the domains and replaces `engine.qa`: attach once it exists (works with either order).
  const attach = () => Object.assign(engine.qa, helpers as unknown as Partial<QaHelpers>);
  if (engine.qa) attach();
  else queueMicrotask(attach);
}
