import type { FilterSpecification, GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { FacilityDto, IncidentDto, VehicleDto } from '@/contracts';
import { movementProgress, pointAlong, remainingPath, type LngLat } from '@/lib/geo';
import { FAMILY_COLORS } from '@/design/icons';
import type { Selection } from '@/stores/ui';
import { GAME_LABEL_FONT } from './style';

/** Everything the game draws on the map: GeoJSON sources on WebGL layers — never DOM markers. */
export const SRC = {
  facilities: 'rc-facilities',
  incidents: 'rc-incidents',
  vehicles: 'rc-vehicles',
  routes: 'rc-routes',
  selection: 'rc-selection',
} as const;
export const LAYER = {
  routes: 'rc-routes-line',
  routesSelected: 'rc-routes-selected',
  facilities: 'rc-facilities-icon',
  facilityLabels: 'rc-facilities-label',
  incidentPulse: 'rc-incidents-pulse',
  incidentHalo: 'rc-incidents-halo',
  incidents: 'rc-incidents-icon',
  clusters: 'rc-incidents-cluster',
  clusterCount: 'rc-incidents-cluster-count',
  vehicles: 'rc-vehicles-icon',
  vehicleLabels: 'rc-vehicles-label',
  selection: 'rc-selection-ring',
} as const;

const SEVERITY_EXPR = [
  'interpolate',
  ['linear'],
  ['get', 'severity'],
  1,
  '#4CC38A',
  4,
  '#D8D044',
  6,
  '#F79A35',
  8,
  '#F0503A',
  9,
  '#E5202A',
  10,
  '#D0166E',
];
const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export interface VehicleIconLookup {
  (typeCode: string): string;
}

export function facilityFeatures(
  facilities: readonly FacilityDto[],
  vehicles: readonly VehicleDto[],
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: facilities.map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: { type: 'Point', coordinates: f.position },
      properties: {
        id: f.id,
        kind: 'facility',
        name: f.name,
        image: `fac:${f.family}`,
        parked: vehicles.filter((v) => v.facilityId === f.id && v.movement === null && v.incidentId === null)
          .length,
      },
    })),
  };
}

export function incidentFeatures(incidents: readonly IncidentDto[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: incidents.map((i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: i.position },
      properties: {
        id: i.id,
        kind: 'incident',
        severity: i.severity,
        image: `inc:${i.category}:${i.severity}`,
        unattended: i.status === 'PENDING_RESPONSE' ? 1 : 0,
        escalating: i.escalating ? 1 : 0,
      },
    })),
  };
}

/** Vehicles away from their base (moving or on scene). Parked vehicles are represented by the facility marker. */
export function vehicleFeatures(
  vehicles: readonly VehicleDto[],
  iconOf: VehicleIconLookup,
  nowMs: number,
): {
  points: FeatureCollection<Point>;
  routes: FeatureCollection<LineString>;
  positions: Map<string, LngLat>;
} {
  const points: Feature<Point>[] = [];
  const routes: Feature<LineString>[] = [];
  const positions = new Map<string, LngLat>();
  for (const v of vehicles) {
    let position: LngLat = v.position;
    let bearing = 0;
    if (v.movement) {
      const t = movementProgress(v.movement, nowMs);
      const p = pointAlong(v.movement.path, t);
      position = p.position;
      bearing = p.bearing;
      routes.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: remainingPath(v.movement.path, t) },
        properties: {
          id: v.id,
          color: FAMILY_COLORS[v.family].primary,
          returning: v.movement.purpose === 'TO_BASE' ? 1 : 0,
        },
      });
    } else if (v.incidentId === null) {
      positions.set(v.id, position);
      continue;
    }
    positions.set(v.id, position);
    points.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: position },
      properties: {
        id: v.id,
        kind: 'vehicle',
        image: `veh:${v.family}:${iconOf(v.typeCode)}`,
        bearing,
        callSign: v.callSign,
        moving: v.movement ? 1 : 0,
      },
    });
  }
  return {
    points: { type: 'FeatureCollection', features: points },
    routes: { type: 'FeatureCollection', features: routes },
    positions,
  };
}

export function addGameLayers(map: MlMap): void {
  map.addSource(SRC.routes, { type: 'geojson', data: empty() });
  map.addSource(SRC.facilities, { type: 'geojson', data: empty() });
  map.addSource(SRC.incidents, {
    type: 'geojson',
    data: empty(),
    cluster: true,
    clusterMaxZoom: 11,
    clusterRadius: 44,
    clusterProperties: { maxSeverity: ['max', ['get', 'severity']] },
  });
  map.addSource(SRC.vehicles, { type: 'geojson', data: empty() });
  map.addSource(SRC.selection, { type: 'geojson', data: empty() });

  map.addLayer({
    id: LAYER.routes,
    type: 'line',
    source: SRC.routes,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
      'line-opacity': ['case', ['==', ['get', 'returning'], 1], 0.35, 0.8],
      'line-dasharray': [1.2, 1.4],
    },
  });
  map.addLayer({
    id: LAYER.routesSelected,
    type: 'line',
    source: SRC.routes,
    filter: ['==', ['get', 'id'], ''],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#FFFFFF',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
      'line-opacity': 0.9,
    },
  });

  map.addLayer({
    id: LAYER.selection,
    type: 'circle',
    source: SRC.selection,
    paint: {
      'circle-radius': 26,
      'circle-color': 'rgba(124,192,255,0.12)',
      'circle-stroke-color': '#7CC0FF',
      'circle-stroke-width': 2.5,
    },
  });

  map.addLayer({
    id: LAYER.facilities,
    type: 'symbol',
    source: SRC.facilities,
    layout: {
      'icon-image': ['get', 'image'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: LAYER.facilityLabels,
    type: 'symbol',
    source: SRC.facilities,
    minzoom: 12.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': GAME_LABEL_FONT,
      'text-size': 11,
      'text-offset': [0, 1.9],
      'text-anchor': 'top',
      'text-max-width': 12,
      'text-optional': true,
    },
    paint: { 'text-color': '#E8EDF5', 'text-halo-color': '#0A1220', 'text-halo-width': 1.6 },
  });

  const single: FilterSpecification = ['!', ['has', 'point_count']];
  map.addLayer({
    id: LAYER.incidentPulse,
    type: 'circle',
    source: SRC.incidents,
    filter: ['all', single, ['==', ['get', 'unattended'], 1]],
    paint: {
      'circle-radius': 18,
      'circle-color': SEVERITY_EXPR as never,
      'circle-opacity': 0.35,
      'circle-translate': [0, -30],
    },
  });
  map.addLayer({
    id: LAYER.incidentHalo,
    type: 'circle',
    source: SRC.incidents,
    filter: single,
    paint: {
      'circle-radius': 5,
      'circle-color': SEVERITY_EXPR as never,
      'circle-stroke-color': '#0A1220',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: LAYER.incidents,
    type: 'symbol',
    source: SRC.incidents,
    filter: single,
    layout: {
      'icon-image': ['get', 'image'],
      'icon-anchor': 'bottom',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'severity'],
    },
  });
  map.addLayer({
    id: LAYER.clusters,
    type: 'circle',
    source: SRC.incidents,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 18, 5, 23, 15, 28],
      'circle-color': '#0A1220',
      'circle-stroke-width': 3.5,
      'circle-stroke-color': [
        'interpolate',
        ['linear'],
        ['get', 'maxSeverity'],
        1,
        '#4CC38A',
        5,
        '#F5B63C',
        9,
        '#E5202A',
      ] as never,
    },
  });
  map.addLayer({
    id: LAYER.clusterCount,
    type: 'symbol',
    source: SRC.incidents,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': GAME_LABEL_FONT,
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#FFFFFF' },
  });

  map.addLayer({
    id: LAYER.vehicles,
    type: 'symbol',
    source: SRC.vehicles,
    layout: {
      'icon-image': ['get', 'image'],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 14, 0.95, 17, 1.25],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: LAYER.vehicleLabels,
    type: 'symbol',
    source: SRC.vehicles,
    minzoom: 13.5,
    layout: {
      'text-field': ['get', 'callSign'],
      'text-font': GAME_LABEL_FONT,
      'text-size': 10,
      'text-offset': [0, 1.6],
      'text-anchor': 'top',
      'text-optional': true,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#E8EDF5', 'text-halo-color': '#0A1220', 'text-halo-width': 1.4 },
  });
}

export const setData = (map: MlMap, source: string, data: FeatureCollection): void => {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
};

export function setSelectionRing(map: MlMap, selection: Selection, position: LngLat | null): void {
  setData(
    map,
    SRC.selection,
    position && selection
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: position },
              properties: { kind: selection.kind },
            },
          ],
        }
      : empty(),
  );
  if (map.getLayer(LAYER.selection))
    map.setPaintProperty(
      LAYER.selection,
      'circle-translate',
      selection?.kind === 'incident' ? [0, -30] : [0, 0],
    );
  if (map.getLayer(LAYER.routesSelected))
    map.setFilter(LAYER.routesSelected, [
      '==',
      ['get', 'id'],
      selection?.kind === 'vehicle' ? selection.id : '',
    ]);
}

/** Pulse for unattended incidents, driven by wall time (≈12 fps is enough and keeps the GPU idle-friendly). */
export function setPulsePhase(map: MlMap, phase: number): void {
  if (!map.getLayer(LAYER.incidentPulse)) return;
  map.setPaintProperty(LAYER.incidentPulse, 'circle-radius', 16 + phase * 22);
  map.setPaintProperty(LAYER.incidentPulse, 'circle-opacity', 0.45 * (1 - phase));
}

export function bindInteractions(
  map: MlMap,
  handlers: { onSelect: (selection: Selection) => void },
): () => void {
  const clickable = [LAYER.incidents, LAYER.vehicles, LAYER.facilities, LAYER.clusters];
  const onClick = (e: MapMouseEvent) => {
    const features = map.queryRenderedFeatures(e.point, { layers: clickable.filter((l) => map.getLayer(l)) });
    const top = features[0];
    if (!top) {
      handlers.onSelect(null);
      return;
    }
    const props = top.properties as {
      id?: string;
      kind?: 'incident' | 'vehicle' | 'facility';
      cluster_id?: number;
    };
    if (props.cluster_id !== undefined) {
      const geometry = top.geometry as Point;
      void (map.getSource(SRC.incidents) as GeoJSONSource)
        .getClusterExpansionZoom(props.cluster_id)
        .then((zoom) => map.easeTo({ center: geometry.coordinates as [number, number], zoom: zoom + 0.5 }));
      return;
    }
    if (props.id && props.kind) handlers.onSelect({ kind: props.kind, id: props.id });
  };
  const enter = () => {
    map.getCanvas().style.cursor = 'pointer';
  };
  const leave = () => {
    map.getCanvas().style.cursor = '';
  };
  map.on('click', onClick);
  for (const l of clickable) {
    map.on('mouseenter', l, enter);
    map.on('mouseleave', l, leave);
  }
  return () => {
    map.off('click', onClick);
    for (const l of clickable) {
      map.off('mouseenter', l, enter);
      map.off('mouseleave', l, leave);
    }
  };
}
