'use client';
import type { PersonnelDto } from '@/contracts';
import { useServerNow } from '@/hooks/use-server-now';

export type FatigueAnchor = PersonnelDto['fatigue'];
export type FatigueBand = FatigueAnchor['band'];

/** Band thresholds of analisi/03 §5 (Riposato <40 · Stanco 40–64 · Affaticato 65–84 · Riposo obbligato ≥85). */
export const FATIGUE_THRESHOLDS = { tired: 40, fatigued: 65, restRequired: 85 } as const;
export const FATIGUE_BANDS: FatigueBand[] = ['RESTED', 'TIRED', 'FATIGUED', 'REST_REQUIRED'];

export const bandOf = (value: number): FatigueBand =>
  value >= FATIGUE_THRESHOLDS.restRequired
    ? 'REST_REQUIRED'
    : value >= FATIGUE_THRESHOLDS.fatigued
      ? 'FATIGUED'
      : value >= FATIGUE_THRESHOLDS.tired
        ? 'TIRED'
        : 'RESTED';

/** value(now) = clamp(value + ratePerSecond · (now − anchorAt), 0, 100) — the server never streams fatigue. */
export const fatigueAt = (anchor: FatigueAnchor, nowMs: number): number =>
  Math.min(
    100,
    Math.max(0, anchor.value + (anchor.ratePerSecond * (nowMs - Date.parse(anchor.anchorAt))) / 1000),
  );

/** Live fatigue value, re-evaluated against the SERVER clock (no polling). A flat anchor does not tick. */
export function useFatigue(anchor: FatigueAnchor, intervalMs = 1000): { value: number; band: FatigueBand } {
  const now = useServerNow(intervalMs, anchor.ratePerSecond !== 0);
  const value = fatigueAt(anchor, now);
  return { value, band: bandOf(value) };
}
