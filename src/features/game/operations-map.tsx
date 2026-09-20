'use client';
import * as React from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { useTranslations } from 'next-intl';
import { BaseMap } from '@/features/map/base-map';
import {
  SRC,
  addGameLayers,
  bindInteractions,
  facilityFeatures,
  incidentFeatures,
  setData,
  setPulsePhase,
  setSelectionRing,
  vehicleFeatures,
} from '@/features/map/game-layers';
import { serverNow } from '@/lib/clock';
import type { LngLat } from '@/lib/geo';
import { useLatest } from '@/hooks/use-latest';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { MapLayersControl, WorldMapOverlay } from '@/features/world/map-overlay';
import { HospitalsMapOverlay } from '@/features/medical/map-overlay';
import { SitesMapOverlay } from '@/features/facilities/map-overlay';
import { useSnapshot, useVehicleTypeLookup } from './hooks';

/**
 * The operations map. React never touches markers: the snapshot is mirrored into GeoJSON sources and a single
 * animation loop interpolates moving vehicles along `movement.path` using the server clock (capped at 98%
 * until `vehicle.arrived` swaps the movement for the resting position).
 */
export function OperationsMap({ bottomPadding = 0 }: { bottomPadding?: number }) {
  const t = useTranslations('game.map');
  const snapshot = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const mapRef = React.useRef<MlMap | null>(null);
  const [ready, setReady] = React.useState(false);
  // The map instance as state too: overlays are rendered from it (refs must not be read during render).
  const [mapInstance, setMapInstance] = React.useState<MlMap | null>(null);

  // Latest values for the animation loop, without restarting it.
  const live = useLatest({ snapshot, typeOf, bottomPadding });
  const [camera] = React.useState(() => useUiStore.getState().camera);

  const onReady = React.useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      addGameLayers(map);
      const unbind = bindInteractions(map, {
        onSelect: (selection) => {
          const ui = useUiStore.getState();
          if (selection) ui.select(selection);
          else ui.clearSelection();
        },
      });
      const onMoveEnd = () => {
        const c = map.getCenter();
        useUiStore.getState().setCamera({ center: [c.lng, c.lat], zoom: map.getZoom() });
      };
      map.on('moveend', onMoveEnd);

      let raf = 0;
      let last = 0;
      let lastSignature = '';
      const frame = (ts: number) => {
        raf = requestAnimationFrame(frame);
        const reduced =
          useSettingsStore.getState().reducedMotion ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const { snapshot: s, typeOf: lookup } = live.current;
        const moving = s.vehicles.some((v) => v.movement !== null);
        const interval = reduced ? 1000 : moving ? 66 : 250;
        if (ts - last < interval) return;
        last = ts;
        const { points, routes, positions } = vehicleFeatures(
          s.vehicles,
          (code) => lookup(code)?.icon ?? 'truck',
          serverNow(),
        );
        // Static frames (nothing moving) only push data when something actually changed.
        const signature = moving
          ? ''
          : JSON.stringify(points.features.map((f) => [f.properties?.id, f.geometry.coordinates]));
        if (moving || signature !== lastSignature) {
          setData(map, SRC.vehicles, points);
          setData(map, SRC.routes, routes);
          lastSignature = signature;
        }
        const selection = useUiStore.getState().selection;
        let position: LngLat | null = null;
        if (selection?.kind === 'vehicle') position = positions.get(selection.id) ?? null;
        else if (selection?.kind === 'incident')
          position = s.incidents.find((i) => i.id === selection.id)?.position ?? null;
        else if (selection?.kind === 'facility')
          position = s.facilities.find((f) => f.id === selection.id)?.position ?? null;
        else if (selection) position = useUiStore.getState().focusRequest?.center ?? null;
        setSelectionRing(map, selection, position);
        if (!reduced) setPulsePhase(map, (ts % 1600) / 1600);
      };
      raf = requestAnimationFrame(frame);
      setReady(true);
      setMapInstance(map);
      return () => {
        cancelAnimationFrame(raf);
        unbind();
        map.off('moveend', onMoveEnd);
        mapRef.current = null;
        setMapInstance(null);
      };
    },
    [live],
  );

  // Mirror slow-changing entities into their sources.
  React.useEffect(() => {
    if (ready && mapRef.current)
      setData(mapRef.current, SRC.facilities, facilityFeatures(snapshot.facilities, snapshot.vehicles));
  }, [ready, snapshot.facilities, snapshot.vehicles]);
  React.useEffect(() => {
    if (ready && mapRef.current) setData(mapRef.current, SRC.incidents, incidentFeatures(snapshot.incidents));
  }, [ready, snapshot.incidents]);

  // Camera requests (queue click, "centre on map", toast action).
  const focusRequest = useUiStore((s) => s.focusRequest);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focusRequest) return;
    map.easeTo({
      center: focusRequest.center,
      zoom: Math.max(map.getZoom(), focusRequest.zoom ?? 14),
      padding: { top: 0, left: 0, right: 0, bottom: live.current.bottomPadding },
      duration: 600,
    });
  }, [ready, focusRequest, live]);

  return (
    <>
      <BaseMap
        label={t('label')}
        center={camera?.center ?? snapshot.career.center}
        zoom={camera?.zoom ?? 13}
        bounds={camera ? undefined : snapshot.career.bounds}
        onReady={onReady}
      />
      {/* Optional layers live in their own feature folders; they render no DOM and clean up after themselves. */}
      {mapInstance ? (
        <>
          <WorldMapOverlay map={mapInstance} />
          <HospitalsMapOverlay map={mapInstance} />
          <SitesMapOverlay map={mapInstance} />
        </>
      ) : null}
      <MapLayersControl />
    </>
  );
}
