import type { DispatchOption } from '@/lib/api/types';

/**
 * Order of the dispatch list (owner, 2026-10-18 — the server applies the same rule, `orderDispatchOptions`): the recommended
 * units first (soonest arrival first); then every unit that can go right now — free, or busy but redirectable at once — nearest
 * first; then the busy ones that can only queue, by their estimated arrival here; then the rest, nearest first. Ties: soonest ETA.
 * Applied on the client too, so the family filter and the mock keep it.
 */
export function orderDispatchOptions(options: readonly DispatchOption[]): DispatchOption[] {
  const rank = (o: DispatchOption): number =>
    o.recommended ? 0 : o.dispatchable || o.chain?.redirectEligible ? 1 : o.chain ? 2 : 3;
  const arrival = (o: DispatchOption): number => {
    const at = o.chain?.estimate?.arriveAt;
    return at ? Date.parse(at) : Number.POSITIVE_INFINITY;
  };
  return [...options].sort((a, b) => {
    const tier = rank(a) - rank(b);
    if (tier !== 0) return tier;
    const r = rank(a);
    const primary =
      r === 0
        ? a.etaSeconds - b.etaSeconds
        : r === 2
          ? arrival(a) - arrival(b)
          : a.distanceMeters - b.distanceMeters;
    return (Number.isFinite(primary) ? primary : 0) || a.etaSeconds - b.etaSeconds;
  });
}
