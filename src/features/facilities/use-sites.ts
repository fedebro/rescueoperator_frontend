'use client';
import { useQuery } from '@tanstack/react-query';
import { facilitiesApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useCareerId, useSnapshot } from '@/features/game/hooks';

/** The career area, widened a little so sites sitting on its edge are not cut off. */
export function sitesBbox(
  bounds: readonly [number, number, number, number],
): [number, number, number, number] {
  const [w, s, e, n] = bounds;
  const padLng = (e - w) * 0.1;
  const padLat = (n - s) * 0.1;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return [round(w - padLng), round(s - padLat), round(e + padLng), round(n + padLat)];
}

/**
 * Candidate sites of the career area. The key lives under the `world` root (invalidated by `facility.updated`) and
 * also carries what changes the lock state of the options: level, unlocked families, number of facilities.
 */
export function useSites(enabled = true) {
  const careerId = useCareerId();
  const { career, facilities } = useSnapshot();
  const bbox = sitesBbox(career.bounds);
  return useQuery({
    queryKey: [
      ...qk.sites(careerId, bbox.join(',')),
      career.level,
      career.unlockedFamilies.join(','),
      facilities.length,
    ],
    queryFn: () => facilitiesApi.sites(careerId, bbox),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
