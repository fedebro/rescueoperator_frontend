import type { ServiceFamily } from '@/contracts';
import { compareAmount } from '@/lib/format';

/**
 * "What should I do now" — the empty/idle states across Operations, Personnel, Shop etc. suggest ONE concrete next
 * action derived from what is genuinely true of the player's career, never generic copy. Pure and framework-free so
 * it is trivial to unit test; each screen calls it with whatever slice of state it already has loaded (nothing here
 * requires a query the screen would not otherwise make).
 *
 * Priority order mirrors urgency: something broken > something running out > something about to be lost >
 * something you can afford right now > a longer-term goal within reach.
 */
export type IdleSuggestion =
  | { kind: 'BROKEN_VEHICLE'; vehicleId: string; callSign: string }
  | { kind: 'LOW_STOCK'; itemCode: string; facilityId: string }
  | { kind: 'EXPIRING_CANDIDATE'; candidateId: string; roleCode: string }
  | { kind: 'AFFORDABLE_UPGRADE'; vehicleTypeCode: string }
  | { kind: 'UNCOVERED_FAMILY'; family: ServiceFamily; requiredLevel: number };

export interface IdleVehicle {
  id: string;
  callSign: string;
  status: string;
}
export interface IdleVehicleType {
  code: string;
  family: ServiceFamily;
  price: string;
  unlocked: boolean;
}
export interface IdleFamily {
  code: ServiceFamily;
  requiredLevel: number;
  unlocked: boolean;
}
export interface IdleStockLine {
  itemCode: string;
  facilityId: string;
  low: boolean;
}
export interface IdleCandidate {
  id: string;
  roleCode: string;
  expiresAt: string;
}

export interface IdleSuggestionInput {
  vehicles?: readonly IdleVehicle[];
  vehicleTypes?: readonly IdleVehicleType[];
  families?: readonly IdleFamily[];
  stockLines?: readonly IdleStockLine[];
  candidates?: readonly IdleCandidate[];
  credits: string;
  level: number;
  /** ISO instant to compare candidate expiry against; defaults to `Date.now()`. Only ever overridden by tests. */
  now?: string;
  /** How close (in levels) a locked family must be to count as "close to unlocking". */
  uncoveredFamilyWithinLevels?: number;
}

/** How many levels away from unlocking still counts as "close" for the {@link IdleSuggestion} `UNCOVERED_FAMILY`. */
const DEFAULT_UNCOVERED_WITHIN = 2;

export function pickIdleSuggestion(input: IdleSuggestionInput): IdleSuggestion | null {
  const broken = (input.vehicles ?? []).find((v) => v.status === 'BROKEN_DOWN');
  if (broken) return { kind: 'BROKEN_VEHICLE', vehicleId: broken.id, callSign: broken.callSign };

  const low = (input.stockLines ?? []).find((l) => l.low);
  if (low) return { kind: 'LOW_STOCK', itemCode: low.itemCode, facilityId: low.facilityId };

  const now = input.now ?? new Date().toISOString();
  const expiring = [...(input.candidates ?? [])]
    .filter((c) => c.expiresAt > now)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
  if (expiring) return { kind: 'EXPIRING_CANDIDATE', candidateId: expiring.id, roleCode: expiring.roleCode };

  const affordable = [...(input.vehicleTypes ?? [])]
    .filter((v) => v.unlocked && compareAmount(input.credits, v.price) >= 0)
    .sort((a, b) => compareAmount(b.price, a.price))[0];
  if (affordable) return { kind: 'AFFORDABLE_UPGRADE', vehicleTypeCode: affordable.code };

  const within = input.uncoveredFamilyWithinLevels ?? DEFAULT_UNCOVERED_WITHIN;
  const nextFamily = [...(input.families ?? [])]
    .filter((f) => !f.unlocked && f.requiredLevel - input.level <= within)
    .sort((a, b) => a.requiredLevel - b.requiredLevel)[0];
  if (nextFamily)
    return { kind: 'UNCOVERED_FAMILY', family: nextFamily.code, requiredLevel: nextFamily.requiredLevel };

  return null;
}
