'use client';
import * as React from 'react';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildMapStyle } from './style';
import { installImageGenerator } from './images';
import { cn } from '@/lib/utils';
import { useLatest } from '@/hooks/use-latest';

let pmtilesRegistered = false;

export interface BaseMapProps {
  center: [number, number];
  zoom?: number;
  bounds?: [number, number, number, number];
  /** Called once the style is ready: add sources/layers and listeners here. Return a cleanup. */
  onReady: (map: MlMap) => void | (() => void);
  label: string;
  className?: string;
  interactive?: boolean;
}

/** MapLibre GL canvas with the Rescue Control dark style. One WebGL context per mounted map. */
export function BaseMap({
  center,
  zoom = 12.5,
  bounds,
  onReady,
  label,
  className,
  interactive = true,
}: BaseMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const onReadyRef = useLatest(onReady);
  const initial = React.useRef({ center, zoom, bounds });
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!pmtilesRegistered) {
      maplibregl.addProtocol('pmtiles', new Protocol().tile);
      pmtilesRegistered = true;
    }
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container,
        style: buildMapStyle(),
        center: initial.current.center,
        zoom: initial.current.zoom,
        minZoom: 5,
        maxZoom: 18.5,
        attributionControl: false,
        interactive,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        fadeDuration: 150,
        ...(initial.current.bounds
          ? { bounds: initial.current.bounds, fitBoundsOptions: { padding: 24 } }
          : {}),
      });
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    } // WebGL unavailable (very old webviews)
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    // OpenStreetMap attribution is always visible, never collapsed behind an (i) button.
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    installImageGenerator(map);
    (window as unknown as { __rcMap?: MlMap }).__rcMap = map;

    let cleanup: void | (() => void);
    let ready = false;
    const init = () => {
      if (ready) return;
      ready = true;
      container.dataset.ready = 'true';
      cleanup = onReadyRef.current(map);
    };
    // `style.load` fires as soon as the style JSON is parsed — game layers do not wait for (or depend on) basemap tiles.
    map.once('style.load', init);
    map.on('error', () => undefined); // tile/glyph network errors must never break the game layers
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (typeof cleanup === 'function') cleanup();
      map.remove();
    };
  }, [interactive, onReadyRef]);

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-[#111C2E]', className)}>
      <div
        ref={containerRef}
        role="application"
        aria-label={label}
        data-testid="map"
        style={{ position: 'absolute', inset: 0 }}
      />
      {failed ? (
        <p className="text-muted absolute inset-0 grid place-items-center p-6 text-center text-sm">WebGL</p>
      ) : null}
    </div>
  );
}
