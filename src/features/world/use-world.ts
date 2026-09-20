'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { worldApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useSettingsStore } from '@/stores/settings';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useCareerId, useSnapshot } from '@/features/game/hooks';

/** World context of the snapshot: kept fresh by `world.updated` (payload `world`), never polled. */
export function useWorld() {
  return useSnapshot().world;
}

/** Coverage snapshot (H3 cells). Lives under the world root key, so `world.updated` / `facility.updated` refetch it. */
export function useCoverage(enabled = true) {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.coverage(careerId),
    queryFn: () => worldApi.coverage(careerId),
    enabled,
    staleTime: 60_000,
  });
}

export function useStipend() {
  const careerId = useCareerId();
  const { career } = useSnapshot();
  return useQuery({
    // Level, reputation and coverage all move the estimate: refetch when the summary says they changed.
    queryKey: [...qk.stipend(careerId), career.level, Math.round(career.reputation), career.coveragePct],
    queryFn: () => worldApi.stipend(careerId),
    staleTime: 30_000,
  });
}

export function useMilestones() {
  const careerId = useCareerId();
  return useQuery({
    queryKey: qk.milestones(careerId),
    queryFn: () => worldApi.milestones(careerId),
    staleTime: 30_000,
  });
}

/** True when animations must be skipped: the in-game setting or the OS preference. */
export function useReducedMotion(): boolean {
  const setting = useSettingsStore((s) => s.reducedMotion);
  const system = useMediaQuery('(prefers-reduced-motion: reduce)');
  return setting || system;
}

/** "4 h", "20 min", "1 h 30 min": parts for the `world.duration.*` messages. */
export function durationParts(seconds: number): { h: number; m: number } {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/** Re-runs `fn` when the instant passes (e.g. a payout is due → refetch the card). */
export function useAt(iso: string | null | undefined, fn: () => void, delayMs = 1500): void {
  const ref = React.useRef(fn);
  React.useEffect(() => {
    ref.current = fn;
  });
  React.useEffect(() => {
    if (!iso) return;
    const wait = Date.parse(iso) - Date.now() + delayMs;
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => ref.current(), wait);
    return () => clearTimeout(timer);
  }, [iso, delayMs]);
}
