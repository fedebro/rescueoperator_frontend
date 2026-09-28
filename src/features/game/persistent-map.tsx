'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '@/stores/ui';

/**
 * Loaded on demand: MapLibre is only needed once the game shows, and every page importing the shell (PageBody) must not
 * pull it in with it.
 */
const OperationsMap = React.lazy(() =>
  import('./operations-map').then((m) => ({ default: m.OperationsMap })),
);

/** Registers the element the map should live in (null = no map screen on this page: park it). */
const MapSlotContext = React.createContext<((slot: HTMLElement | null) => void) | null>(null);

/**
 * One operations map for the whole game session (03 §2.2, §3 #6): MapLibre is created once and never rebuilt when the
 * player goes to the Fleet or the Shop and comes back — same camera, tiles, sources and images, no second WebGL context.
 *
 * The map is rendered through a portal into a DOM node owned by this host; the operations screen marks where it goes
 * (`MapSlot`) and the node is moved there (a canvas keeps its WebGL context when its element moves). On any other page
 * it is parked off screen, invisible and inert, and its animation loop stands still (`mapParked`). Camera requests made
 * meanwhile (a vehicle picked in the Fleet, a notification) still apply, so the map is already there on return.
 */
export function PersistentMapHost({ children }: { children: React.ReactNode }) {
  const [node] = React.useState(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.className = 'absolute inset-0';
    el.dataset.mapHost = '';
    return el;
  });
  const parkingRef = React.useRef<HTMLDivElement>(null);
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const target = slot ?? parkingRef.current;
    if (node && target && node.parentElement !== target) target.appendChild(node);
    useUiStore.getState().setMapParked(!slot);
  }, [slot, node]);
  React.useEffect(() => () => node?.remove(), [node]);

  return (
    <MapSlotContext.Provider value={setSlot}>
      {children}
      {/* A viewport-sized parking spot: the map keeps sensible dimensions (no 0×0 canvas) while nobody looks at it. */}
      <div
        ref={parkingRef}
        aria-hidden
        inert
        className="pointer-events-none invisible fixed top-0 -left-[200vw] h-dvh w-screen overflow-hidden"
        data-testid="map-parking"
      />
      {node
        ? createPortal(
            <React.Suspense fallback={null}>
              <OperationsMap />
            </React.Suspense>,
            node,
          )
        : null}
    </MapSlotContext.Provider>
  );
}

/** Where the operations map appears on the map screen. Without a host (unit tests), the map renders in place. */
export function MapSlot({ className }: { className?: string }) {
  const register = React.useContext(MapSlotContext);
  const ref = React.useCallback((el: HTMLDivElement | null) => register?.(el), [register]);
  if (!register)
    return (
      <div className={className}>
        <React.Suspense fallback={null}>
          <OperationsMap />
        </React.Suspense>
      </div>
    );
  return <div ref={ref} className={className} data-testid="map-slot" />;
}
