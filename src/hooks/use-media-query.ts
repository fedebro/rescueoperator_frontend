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

/**
 * 768–1023px (portrait tablets, and phones held in landscape that are wide enough): the mobile shell (top bar + bottom
 * nav), but the operations screen docks its queue / inspector in a side panel instead of the bottom sheet (D-79).
 */
export const useIsTablet = (): boolean =>
  useMediaQuery('(min-width: 768px) and (max-width: 1023.98px)', false);

/** A very short viewport (phone in landscape): the bottom sheet only keeps two heights, peek and full. */
export const useIsShortViewport = (): boolean => useMediaQuery('(max-height: 520px)', false);

export type OperationsLayout = 'desktop' | 'tablet' | 'phone';

/** Which of the three operations-screen layouts applies (same stores and components, different chrome). */
export function useOperationsLayout(): OperationsLayout {
  const desktop = useIsDesktop();
  const tablet = useIsTablet();
  return desktop ? 'desktop' : tablet ? 'tablet' : 'phone';
}
