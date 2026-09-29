import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Re-reads what the server says just changed (a realtime event). A plain `invalidateQueries` is not enough for a query whose
 * FIRST read is still in flight — no data yet: just mounted, or a new key such as the patients list of an incident whose scene
 * changed: TanStack folds the invalidation into that read, which may have started before the change, and the screen would show
 * the old state until the next event (a patient stabilised a moment after the list was requested stayed "being treated", with
 * no transport panel). Such a query is read once more when that read lands. (A query with data needs nothing: TanStack cancels
 * its read in flight and starts a new one.) Only observed queries: a prefetch nobody shows yet is read again on display.
 */
export function invalidateFresh(qc: QueryClient, queryKey: QueryKey): Promise<void> {
  const firstReads = qc.getQueryCache().findAll({
    queryKey,
    type: 'active',
    fetchStatus: 'fetching',
    predicate: (query) => query.state.data === undefined,
  });
  const invalidated = qc.invalidateQueries({ queryKey });
  if (firstReads.length === 0) return invalidated;
  return invalidated.then(() =>
    qc.refetchQueries({ type: 'active', predicate: (query) => firstReads.includes(query) }),
  );
}
