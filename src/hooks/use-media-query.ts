'use client';
import * as React from 'react';

export function useMediaQuery(query: string, defaultValue = false): boolean {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => defaultValue,
  );
}

/** Desktop layout from 1024px: top bar + sidebar + queue + map + inspector. Below: fullscreen map + bottom nav + sheets. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)', true);
