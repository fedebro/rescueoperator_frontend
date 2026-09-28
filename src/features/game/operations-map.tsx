'use client';
import * as React from 'react';
import type { Map as MlMap, PaddingOptions } from 'maplibre-gl';
import { useTranslations } from 'next-intl';
import { BaseMap } from '@/features/map/base-map';
import {
  SRC,
  addGameLayers,
  bindInteractions,
  facilityFeatures,
  incidentFeatures,
  runwayFeatures,
  setData,
  setPulsePhase,
  setVehicleUrgentPulsePhase,
  setSelectionRing,
  vehicleFeatures,
  waterFeatures,
} from '@/features/map/game-layers';
import { serverNow } from '@/lib/clock';
import { movementPoint, type LngLat } from '@/lib/geo';
import { incidentScene } from '@/features/water/water';
import { majorMapFeatures } from '@/features/major/major';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useLatest } from '@/hooks/use-latest';
import { useOperationsLayout } from '@/hooks/use-media-query';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore, type Selection } from '@/stores/ui';
import { MapLayersControl, WorldMapOverlay } from '@/features/world/map-overlay';
import { useRunways } from '@/features/world/use-runways';
import { HospitalsMapOverlay } from '@/features/medical/map-overlay';
import { SitesMapOverlay } from '@/features/facilities/map-overlay';
import { useSnapshot, useVehicleTypeLookup } from './hooks';

/** Room kept clear above a centred marker: the layers button row at the top, a margin above the sheet's edge. */
const MARKER_TOP_ROOM = 64;
const MARKER_BOTTOM_ROOM = 24;
/** If the sheet that was supposed to settle never reports back, centre anyway after this long. */
const SETTLE_FALLBACK_MS = 700;

const reducedMotion = (): boolean =>
  useSettingsStore.getState().reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Camera padding that keeps a centred point in the part of the map the bottom sheet leaves visible. */
function paddingAbove(map: MlMap, cover: number): PaddingOptions {
  const height = map.getContainer().clientHeight;
  const bottom = Math.max(0, Math.min(cover + MARKER_BOTTOM_ROOM, height - MARKER_TOP_ROOM - 48));
  return { top: MARKER_TOP_ROOM, bottom, left: 16, right: 16 };
}

/**
 * The operations map. React never touches markers: the snapshot is mirrored into GeoJSON sources and a single
 * animation loop interpolates moving vehicles along `movement.path` using the server clock (capped at 98%
 * until `vehicle.arrived` swaps the movement for the resting position).
 *
 * Phones (02 §4): whatever gets selected — incident, vehicle, facility, hospital, site, from the map or from a list —
 * is centred in the part of the map ABOVE the bottom sheet, using the sheet's real measured height once it has
 * settled, and re-centred whenever the sheet settles at another height. A tap on the empty map only lowers the sheet.
 */
export function OperationsMap() {
  const t = useTranslations('game.map');
  const snapshot = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const layout = useOperationsLayout();
  const mapRef = React.useRef<MlMap | null>(null);
  const [ready, setReady] = React.useState(false);
  // The map instance as state too: overlays are rendered from it (refs must not be read during render).
  const [mapInstance, setMapInstance] = React.useState<MlMap | null>(null);

  // Latest values for the animation loop and the store subscription, without restarting them.
  const live = useLatest({ snapshot, typeOf, layout });
  const [camera] = React.useState(() => useUiStore.getState().camera);

  const onReady = React.useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      addGameLayers(map);
      const unbind = bindInteractions(map, {
        onSelect: (selection) => useUiStore.getState().select(selection),
        onEmptyTap: () => useUiStore.getState().lowerSheet(),
      });
      const onMoveEnd = () => {
        const c = map.getCenter();
        useUiStore.getState().setCamera({ center: [c.lng, c.lat], zoom: map.getZoom() });
      };
      map.on('moveend', onMoveEnd);

      /** Where the selection is right now (moving vehicles included); hospitals/sites: their overlay's focus. */
      const positionOf = (selection: NonNullable<Selection>): LngLat | null => {
        const s = live.current.snapshot;
        if (selection.kind === 'incident') {
          // A water incident is centred on its scene on the water (D-68), where its marker is.
          const incident = s.incidents.find((i) => i.id === selection.id);
          return incident ? incidentScene(incident) : null;
        }
        if (selection.kind === 'facility')
          return s.facilities.find((f) => f.id === selection.id)?.position ?? null;
        if (selection.kind === 'major')
          return s.incidents.find((i) => i.major?.id === selection.id)?.major?.center ?? null;
        if (selection.kind === 'vehicle') {
          const v = s.vehicles.find((x) => x.id === selection.id);
          if (!v) return null;
          return v.movement ? movementPoint(v.movement, serverNow()).position : v.position;
        }
        return useUiStore.getState().focusRequest?.center ?? null;
      };

      /* ── phone centring: wait for the sheet to settle at the height the change asked for, then centre above it ── */
      let pending: { center?: LngLat; zoom?: number; afterSeq: number } | null = null;
      let fallback = 0;
      const applyPending = () => {
        window.clearTimeout(fallback);
        const target = pending;
        pending = null;
        const ui = useUiStore.getState();
        if (!target || ui.sheetCover === null) return;
        if (ui.sheetSnap === 'full') return; // the sheet covers the map: nothing to show
        const center = target.center ?? (ui.selection ? positionOf(ui.selection) : null);
        if (!center) return;
        map.easeTo({
          center,
          zoom: target.zoom !== undefined ? Math.max(map.getZoom(), target.zoom) : map.getZoom(),
          padding: paddingAbove(map, ui.sheetCover),
          duration: reducedMotion() ? 0 : 450,
        });
      };
      const request = (target: { center?: LngLat; zoom?: number }, waitForSettle: boolean) => {
        const ui = useUiStore.getState();
        pending = { ...target, afterSeq: ui.sheetSettleSeq };
        window.clearTimeout(fallback);
        if (!waitForSettle && ui.sheetCover !== null) applyPending();
        else fallback = window.setTimeout(applyPending, SETTLE_FALLBACK_MS);
      };
      const unsubscribe = useUiStore.subscribe((s, prev) => {
        if (live.current.layout !== 'phone') return;
        const snapChanging = s.sheetSnap !== prev.sheetSnap;
        const selectionChanged =
          !!s.selection &&
          (s.selection.kind !== prev.selection?.kind || s.selection.id !== prev.selection?.id);
        if (s.focusRequest && s.focusRequest !== prev.focusRequest)
          request({ center: s.focusRequest.center, zoom: s.focusRequest.zoom ?? 14 }, snapChanging);
        else if (selectionChanged) request({}, snapChanging);
        if (s.sheetSettleSeq !== prev.sheetSettleSeq) {
          if (pending && s.sheetSettleSeq > pending.afterSeq) applyPending();
          else if (!pending && s.selection) {
            // The sheet came to rest at another height (dragged, tapped): keep the selection in view above it.
            pending = { afterSeq: -1 };
            applyPending();
          }
        }
      });

      let raf = 0;
      let last = 0;
      let lastSignature = '';
      const frame = (ts: number) => {
        raf = requestAnimationFrame(frame);
        // Parked off screen while another game page shows (persistent-map.tsx): nothing to animate.
        if (useUiStore.getState().mapParked) return;
        const reduced = reducedMotion();
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
          setData(map, SRC.vehicleLabels, points);
          setData(map, SRC.routes, routes);
          lastSignature = signature;
        }
        const selection = useUiStore.getState().selection;
        let position: LngLat | null = null;
        // A major is framed by its own event area: no selection ring on top of it.
        if (selection?.kind === 'major') position = null;
        else if (selection?.kind === 'vehicle') position = positions.get(selection.id) ?? null;
        else if (selection?.kind === 'incident') {
          const incident = s.incidents.find((i) => i.id === selection.id);
          position = incident ? incidentScene(incident) : null;
        } else if (selection?.kind === 'facility')
          position = s.facilities.find((f) => f.id === selection.id)?.position ?? null;
        else if (selection) position = useUiStore.getState().focusRequest?.center ?? null;
        setSelectionRing(map, selection, position);
        if (!reduced) {
          setPulsePhase(map, (ts % 1600) / 1600);
          setVehicleUrgentPulsePhase(map, (ts % 500) / 500);
        }
      };
      raf = requestAnimationFrame(frame);
      setReady(true);
      setMapInstance(map);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(fallback);
        unsubscribe();
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
    if (!ready || !mapRef.current) return;
    const features = facilityFeatures(snapshot.facilities, snapshot.vehicles);
    setData(mapRef.current, SRC.facilities, features);
    setData(mapRef.current, SRC.facilityLabels, features);
  }, [ready, snapshot.facilities, snapshot.vehicles]);
  const tx = useI18nText();
  const majorLabel = React.useMemo(() => tx({ key: 'major.common.title' }).toUpperCase(), [tx]);
  const lastMajor = React.useRef<{ map: MlMap | null; signature: string }>({ map: null, signature: '' });
  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setData(map, SRC.incidents, incidentFeatures(snapshot.incidents));
    // Water incidents (D-68): the meeting point on the shore road, linked to the scene on the water.
    setData(map, SRC.water, waterFeatures(snapshot.incidents));
    // Major incidents (D-24): the event area, the links to the linked incidents, the label at the centre. Re-tiled only
    // when it moved (a new linked incident, a wider area): the big translucent disc must not flicker on every event.
    const major = majorMapFeatures(snapshot.incidents, () => majorLabel);
    const signature = JSON.stringify([
      major.areas.features.map((f) => [f.properties, f.geometry]),
      majorLabel,
    ]);
    if (lastMajor.current.map === map && lastMajor.current.signature === signature) return;
    lastMajor.current = { map, signature };
    setData(map, SRC.major, major.areas);
    setData(map, SRC.majorCentre, major.centres);
  }, [ready, snapshot.incidents, majorLabel]);
  // Real runway/taxiway ground markings (airport-runway-map): static world geometry, always on, no gameplay state.
  const runways = useRunways();
  React.useEffect(() => {
    if (ready && mapRef.current) setData(mapRef.current, SRC.runways, runwayFeatures(runways.data ?? []));
  }, [ready, runways.data]);

  // Camera requests on desktop / tablet (queue click, "centre on map", toast action). Phones: see onReady.
  const focusRequest = useUiStore((s) => s.focusRequest);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focusRequest || layout === 'phone') return;
    // Asked from another page (a vehicle picked in the Fleet): the map is parked and nobody sees it move — jump, so no
    // animation is still running (and skewed) when it is resized into the map screen a moment later.
    const parked = useUiStore.getState().mapParked;
    map.easeTo({
      center: focusRequest.center,
      zoom: Math.max(map.getZoom(), focusRequest.zoom ?? 14),
      duration: reducedMotion() || parked ? 0 : 600,
    });
  }, [ready, focusRequest, layout]);

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
