'use client';
import { useQuery } from '@tanstack/react-query';
import { worldGeometryApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useCareerId, useSnapshot } from '@/features/game/hooks';

/** Same padding as `facilities/use-sites.ts`'s `sitesBbox`: a real airport near the edge of the career area should
 * not have its runway cut off by the exact bounding box. */
function runwaysBbox(bounds: readonly [number, number, number, number]): [number, number, number, number] {
  const [w, s, e, n] = bounds;
  const padLng = (e - w) * 0.1;
  const padLat = (n - s) * 0.1;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return [round(w - padLng), round(s - padLat), round(e + padLng), round(n + padLat)];
}

/**
 * Real runway/taxiway centerlines (airport-runway-map) of the career area. Static world geometry, not gated by
 * level or ownership: fetched once per (career area) and kept around, the same way `useSites` treats candidate
 * sites, but without any dependency on career level or the facility roster since a runway is never purchasable.
 */
export function useRunways() {
  const careerId = useCareerId();
  const { career } = useSnapshot();
  const bbox = runwaysBbox(career.bounds);
  return useQuery({
    queryKey: qk.runways(careerId, bbox.join(',')),
    queryFn: () => worldGeometryApi.runways(careerId, bbox),
    staleTime: 5 * 60_000, // real-world geometry never changes mid-session
    placeholderData: (prev) => prev,
  });
}
