import type { VehicleAutonomyDto, VehicleDto } from '@/contracts';
import type { LedgerEntryDto } from '@/lib/api/types';

/**
 * Vehicle autonomy on the client (D-22 [U] "Autonomia + carburante", D-67 [C]; analisi/studio-2026-09-27/01 §3.4–3.5).
 * The server applies the single resupply rule and sends the result on every vehicle (`VehicleDto.autonomy`) and on every
 * dispatch option (`DispatchOption.autonomy` + warning codes): these helpers only DECIDE WHAT TO SHOW. Pure, tested.
 */

export type AutonomyTone = 'ok' | 'warning' | 'danger';

/** Something is tracked AND unlocked for this vehicle: below level 2 (stock) / 3 (fuel) nothing autonomy-related shows. */
export function isAutonomyTracked(a: VehicleAutonomyDto | null | undefined): a is VehicleAutonomyDto {
  return !!a && (a.unlocked.stock || a.unlocked.fuel) && (a.fuel !== null || a.items.length > 0);
}

/** Share of the most depleted item on board (0..1), the one the rule looks at first; `null` without items. */
export function stockRatio(a: Pick<VehicleAutonomyDto, 'items'>): number | null {
  if (a.items.length === 0) return null;
  return Math.min(...a.items.map((i) => (i.capacity > 0 ? i.quantity / i.capacity : 1)));
}

export const lowItems = (a: Pick<VehicleAutonomyDto, 'items'>) => a.items.filter((i) => i.low);

/** Nothing to reload at all: a full tank (or no tank) and every item at its capacity. */
export function isFull(a: Pick<VehicleAutonomyDto, 'fuel' | 'items'>): boolean {
  return (a.fuel === null || a.fuel.ratio >= 0.999) && a.items.every((i) => i.quantity >= i.capacity);
}

/** Reserve light = danger; anything the next stop at base would reload (or one mission left) = warning. */
export function autonomyTone(a: VehicleAutonomyDto): AutonomyTone {
  if (a.fuel?.reserve) return 'danger';
  if (
    a.needsResupply ||
    a.fuel?.low ||
    a.items.some((i) => i.low) ||
    (a.missionsLeftEstimate !== null && a.missionsLeftEstimate <= 1)
  )
    return 'warning';
  return 'ok';
}

export const fuelTone = (fuel: NonNullable<VehicleAutonomyDto['fuel']>): AutonomyTone =>
  fuel.reserve ? 'danger' : fuel.low ? 'warning' : 'ok';

export const stockTone = (a: Pick<VehicleAutonomyDto, 'items'>): AutonomyTone =>
  a.items.some((i) => i.quantity <= 0) ? 'danger' : a.items.some((i) => i.low) ? 'warning' : 'ok';

/**
 * "Rientra a rifornire" (study §3.4): for a vehicle AVAILABLE with partial autonomy (a full one has nothing to reload) or
 * on its way home (it resupplies once back); never twice, never while it already is resupplying.
 */
export function canRequestResupply(vehicle: Pick<VehicleDto, 'status' | 'autonomy'>): boolean {
  const a = vehicle.autonomy;
  if (!isAutonomyTracked(a) || a.resupplyRequested) return false;
  if (vehicle.status === 'RETURNING') return true;
  return vehicle.status === 'AVAILABLE' && !isFull(a);
}

/** "Da rifornire" of the fleet page: the single rule, now. */
export const needsResupply = (v: Pick<VehicleDto, 'autonomy'>): boolean => v.autonomy?.needsResupply === true;

/* ───────────── dispatch screen ───────────── */

/** Warning codes of a dispatch option that belong to autonomy: rendered by the autonomy notes, not as generic badges. */
export const AUTONOMY_WARNINGS: ReadonlySet<string> = new Set([
  'RESUPPLY_BEFORE_DEPARTURE',
  'FUEL_RESERVE',
  'FUEL_RANGE_INSUFFICIENT',
  'LAST_MISSION_BEFORE_RESUPPLY',
]);

/** The flags a dispatch option can carry, most severe first (one discreet icon per option). */
export const AUTONOMY_FLAGS = [
  'FUEL_RANGE_INSUFFICIENT',
  'FUEL_RESERVE',
  'LAST_MISSION_BEFORE_RESUPPLY',
] as const;
export type AutonomyFlag = (typeof AUTONOMY_FLAGS)[number];

export function autonomyFlagOf(option: {
  warnings: readonly string[];
  autonomy?: { lastMissionBeforeResupply: boolean } | null;
}): AutonomyFlag | null {
  const flag = AUTONOMY_FLAGS.find((f) => option.warnings.includes(f));
  if (flag) return flag;
  return option.autonomy?.lastMissionBeforeResupply ? 'LAST_MISSION_BEFORE_RESUPPLY' : null;
}

export const flagTone = (flag: AutonomyFlag): AutonomyTone =>
  flag === 'LAST_MISSION_BEFORE_RESUPPLY' ? 'warning' : 'danger';

/**
 * Seconds of reload at base before leaving (already inside the option's ETA), or `null` when the vehicle leaves straight
 * away. A server that flags the reload without the seconds still gets its note (0 s).
 */
export function reloadBeforeDeparture(option: {
  warnings: readonly string[];
  autonomy?: { resupplyBeforeDepartureSeconds: number } | null;
}): number | null {
  const seconds = Math.max(0, option.autonomy?.resupplyBeforeDepartureSeconds ?? 0);
  return seconds > 0 || option.warnings.includes('RESUPPLY_BEFORE_DEPARTURE') ? seconds : null;
}

/* ───────────── ledger ───────────── */

/** A fuel-station premium (ledger `FUEL`): which vehicle and how many km, from the entry's params. */
export function fuelLedgerDetail(entry: Pick<LedgerEntryDto, 'entryType' | 'description'>): {
  callSign: string;
  km: number;
} | null {
  if (entry.entryType !== 'FUEL') return null;
  const params = entry.description.params ?? {};
  const km = Number(params.refilledKm);
  const callSign = typeof params.callSign === 'string' ? params.callSign : '';
  if (!callSign && !Number.isFinite(km)) return null;
  return { callSign, km: Number.isFinite(km) ? Math.round(km) : 0 };
}

/* ───────────── coaching ───────────── */

/** "Aveva ancora autonomia": a vehicle back home and AVAILABLE at once, with something tracked. */
export const returnedWithoutStop = (v: Pick<VehicleDto, 'status' | 'autonomy'>): boolean =>
  v.status === 'AVAILABLE' && isAutonomyTracked(v.autonomy);

/** The fuel of this vehicle just went under the reserve light (it was above it, or unknown, before). */
export function enteredReserve(
  before: Pick<VehicleDto, 'autonomy'> | undefined,
  after: Pick<VehicleDto, 'autonomy'>,
): boolean {
  return after.autonomy?.fuel?.reserve === true && before?.autonomy?.fuel?.reserve !== true;
}
