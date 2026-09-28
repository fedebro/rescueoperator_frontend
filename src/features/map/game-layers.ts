import type { FilterSpecification, GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { FacilityDto, IncidentDto, RunwayDto, VehicleDto } from '@/contracts';
import { haversineMeters, movementPoint, remainingPieces, type LngLat } from '@/lib/geo';
import { FAMILY_COLORS } from '@/design/icons';
import { incidentScene, isWaterIncident, meetingPointOf } from '@/features/water/water';
import { MAJOR_COLOR } from '@/features/major/major';
import type { Selection } from '@/stores/ui';
import { GAME_LABEL_FONT, MAP_PALETTE } from './style';
import { clusterPictogramIndex } from './images';

/** Everything the game draws on the map: GeoJSON sources on WebGL layers — never DOM markers. */
export const SRC = {
  facilities: 'rc-facilities',
  runways: 'rc-runways',
  incidents: 'rc-incidents',
  vehicles: 'rc-vehicles',
  routes: 'rc-routes',
  selection: 'rc-selection',
  /** Water incidents (D-68): the meeting point on the shore road and its dashed link to the scene on the water. */
  water: 'rc-water',
  /** Major incidents (D-24): the event area and the links to the linked incidents. */
  major: 'rc-major',
  /**
   * The label point at a major's centre, in a source of its own: a symbol tile that cannot get its glyphs fails as a whole,
   * and it must never take the event area down with it.
   */
  majorCentre: 'rc-major-centre',
  /**
   * The names under the facility and vehicle icons, in sources of their own for the same reason: when the glyphs cannot be
   * loaded (a slow or unreachable font server) the labels go, never the stations and the vehicles themselves.
   */
  facilityLabels: 'rc-facilities-labels',
  vehicleLabels: 'rc-vehicles-labels',
} as const;
export const LAYER = {
  routes: 'rc-routes-line',
  /** A boat on its trailer (D-68): the road part of its leg, solid. */
  routesRoad: 'rc-routes-road',
  /** A boat on the water: dashed over a light "wake" band. */
  routesWaterWake: 'rc-routes-water-wake',
  routesWater: 'rc-routes-water',
  routesSelected: 'rc-routes-selected',
  /** The selected boat's water leg: white too, but still dashed (it is on the water). */
  routesSelectedWater: 'rc-routes-selected-water',
  /** Where the trailer puts the boat into (or takes it out of) the water. */
  launchPoints: 'rc-routes-launch',
  waterLinks: 'rc-water-links',
  meetingPoints: 'rc-water-meeting',
  runways: 'rc-runways-line',
  facilities: 'rc-facilities-icon',
  facilityLabels: 'rc-facilities-label',
  incidentPulse: 'rc-incidents-pulse',
  incidentHalo: 'rc-incidents-halo',
  incidents: 'rc-incidents-icon',
  clusterHalo: 'rc-incidents-cluster-halo',
  clusters: 'rc-incidents-cluster',
  vehicleUrgentPulse: 'rc-vehicles-urgent-beacon',
  vehicleSceneRing: 'rc-vehicles-scene-ring',
  vehicleTroubleRing: 'rc-vehicles-trouble-ring',
  vehicles: 'rc-vehicles-icon',
  vehicleLabels: 'rc-vehicles-label',
  selection: 'rc-selection-ring',
  majorArea: 'rc-major-area',
  majorAreaRim: 'rc-major-area-rim',
  majorLinks: 'rc-major-links',
  majorLabel: 'rc-major-label',
} as const;

/**
 * Visual state of a vehicle marker (distinct from `VehicleStatus`, D-64/analisi/07: "lights and siren" while racing to an
 * incident or a hospital, dimmed while returning, a steady ring while working on scene, a warning ring while broken down).
 * A vehicle at its facility with nothing going on is not drawn as its own marker at all (see `vehicleFeatures`).
 */
type VehicleMapState = 'URGENT' | 'RETURNING' | 'ON_SCENE' | 'TROUBLE' | 'NEUTRAL';

function vehicleMapState(v: VehicleDto): VehicleMapState {
  if (v.movement) {
    if (
      v.movement.purpose === 'TO_INCIDENT' ||
      v.movement.purpose === 'TO_HOSPITAL' ||
      v.movement.purpose === 'TO_WATER_SOURCE'
    )
      return 'URGENT';
    if (v.movement.purpose === 'TO_BASE') return 'RETURNING';
    if (v.movement.purpose === 'PATROLLING') return 'NEUTRAL'; // police patrol: siren off, as if going out or coming back
    return 'NEUTRAL'; // DELIVERY, RECOVERY: moving, but nothing urgent for the player right now
  }
  if (v.status === 'ON_SCENE' || v.status === 'AT_HOSPITAL' || v.status === 'AT_WATER_SOURCE')
    return 'ON_SCENE';
  if (v.status === 'BROKEN_DOWN' || v.status === 'BEING_RECOVERED') return 'TROUBLE';
  return 'NEUTRAL';
}

/** Severity 1–10 → the same green → amber → red → magenta ramp as the markers, read from `property`. */
const severityRamp = (property: string) => [
  'interpolate',
  ['linear'],
  ['get', property],
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
const SEVERITY_EXPR = severityRamp('severity');
/** A cluster wears the colour of the most severe incident inside it (03 §2.7), on the same ramp as the markers. */
const CLUSTER_SEVERITY_EXPR = severityRamp('maxSeverity');
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
        // The type code selects the pictogram of the facility TYPE (tier/helipad/air base…): see map/images.ts.
        image: `fac:${f.family}:${f.typeCode}`,
        parked: vehicles.filter((v) => v.facilityId === f.id && v.movement === null && v.incidentId === null)
          .length,
      },
    })),
  };
}

/**
 * Real runway/taxiway centerlines (airport-runway-map). Ground markings, not a selectable entity: no `id`/`kind`
 * that would make `bindInteractions` treat a click on the line as a selection.
 */
export function runwayFeatures(runways: readonly RunwayDto[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: runways.map((r) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: r.path },
      properties: { runwayKind: r.kind },
    })),
  };
}

/**
 * Incident markers. A water incident's marker stands at its SCENE on the water (`scenePosition`, D-68) — not at the meeting
 * point on the road (`position`) where land units stop — and carries the anchor badge (`…:W`).
 */
export function incidentFeatures(incidents: readonly IncidentDto[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: incidents.map((i) => {
      // Flags of the pin image: W = on the water (D-68), M / L = main scene / linked incident of a major (D-24).
      const flags = `${isWaterIncident(i) ? 'W' : ''}${i.major ? (i.major.role === 'MAIN' ? 'M' : 'L') : ''}`;
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: incidentScene(i) },
        properties: {
          id: i.id,
          kind: 'incident',
          // The main scene of a major is drawn over every other pin.
          severity: i.major?.role === 'MAIN' ? 11 : i.severity,
          image: `inc:${i.category}${i.icon ? `|${i.icon}` : ''}:${i.severity}${flags ? `:${flags}` : ''}`,
          // A cluster keeps the maximum: the pictogram of its most severe incident (see `clusterPictogramIndex`).
          clusterRank:
            i.severity * 1000 + clusterPictogramIndex(`${i.category}${i.icon ? `|${i.icon}` : ''}`),
          unattended: i.status === 'PENDING_RESPONSE' ? 1 : 0,
          escalating: i.escalating ? 1 : 0,
          water: isWaterIncident(i) ? 1 : 0,
          major: i.major ? 1 : 0,
        },
      };
    }),
  };
}

/**
 * Water incidents' second point (D-68): the meeting point on the shore road (a small tile that selects the incident too)
 * and the dashed line that links it to the scene on the water. Land incidents contribute nothing.
 */
export function waterFeatures(incidents: readonly IncidentDto[]): FeatureCollection<Point | LineString> {
  const features: Feature<Point | LineString>[] = [];
  for (const i of incidents) {
    const meeting = meetingPointOf(i);
    if (!meeting) continue;
    const scene = incidentScene(i);
    // A water incident from before the water geodata has its scene on the meeting point: nothing to link.
    if (haversineMeters(scene, meeting) < 15) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [scene, meeting] },
      properties: { incidentId: i.id, link: 1 },
    });
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: meeting },
      // `kind`/`id` make a tap on the meeting point select its incident, like its marker.
      properties: { kind: 'incident', id: i.id, image: 'meet', meeting: 1 },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Stationary vehicles that are NOT at their facility even without an incident (broken down on the road, at the hospital). */
const OFF_BASE_STATUSES = new Set([
  'BROKEN_DOWN',
  'BEING_RECOVERED',
  'AT_HOSPITAL',
  'TRANSPORTING',
  'TO_WATER_SOURCE',
  'AT_WATER_SOURCE',
]);

/**
 * Vehicles away from their base (moving or on scene). Parked vehicles are represented by the facility marker.
 * A boat's mixed leg (D-68) is drawn piece by piece: `mode` ROAD (on the trailer, solid), WATER (dashed) and the LAUNCH /
 * RECOVERY stop as a point (the launch point); every other route has no `mode` and keeps the usual dashed line.
 */
export function vehicleFeatures(
  vehicles: readonly VehicleDto[],
  iconOf: VehicleIconLookup,
  nowMs: number,
): {
  points: FeatureCollection<Point>;
  routes: FeatureCollection<LineString | Point>;
  positions: Map<string, LngLat>;
} {
  const points: Feature<Point>[] = [];
  const routes: Feature<LineString | Point>[] = [];
  const positions = new Map<string, LngLat>();
  for (const v of vehicles) {
    let position: LngLat = v.position;
    let bearing = 0;
    if (v.movement) {
      const p = movementPoint(v.movement, nowMs);
      position = p.position;
      bearing = p.bearing;
      // A patrol's route is deliberately not drawn: the car should read as ambling around on its own, not as
      // committed to a visible, predictable path the way a real dispatch leg is.
      if (v.movement.purpose !== 'PATROLLING') {
        const common = {
          id: v.id,
          color: FAMILY_COLORS[v.family].primary,
          returning: v.movement.purpose === 'TO_BASE' ? 1 : 0,
        };
        for (const piece of remainingPieces(v.movement, nowMs)) {
          if (piece.mode === 'LAUNCH' || piece.mode === 'RECOVERY')
            routes.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: piece.path[0]! },
              properties: { ...common, mode: piece.mode, image: 'launch' },
            });
          else
            routes.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: piece.path },
              properties: piece.mode ? { ...common, mode: piece.mode } : common,
            });
        }
      }
    } else if (v.incidentId === null && !OFF_BASE_STATUSES.has(v.status)) {
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
        state: vehicleMapState(v),
        stateColor: FAMILY_COLORS[v.family].primary,
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
  map.addSource(SRC.major, { type: 'geojson', data: empty() });
  map.addSource(SRC.majorCentre, { type: 'geojson', data: empty() });
  map.addSource(SRC.routes, { type: 'geojson', data: empty() });
  map.addSource(SRC.water, { type: 'geojson', data: empty() });
  map.addSource(SRC.runways, { type: 'geojson', data: empty() });
  map.addSource(SRC.facilities, { type: 'geojson', data: empty() });
  map.addSource(SRC.facilityLabels, { type: 'geojson', data: empty() });
  map.addSource(SRC.incidents, {
    type: 'geojson',
    data: empty(),
    cluster: true,
    clusterMaxZoom: 11,
    clusterRadius: 44,
    clusterProperties: {
      maxSeverity: ['max', ['get', 'severity']],
      topRank: ['max', ['get', 'clusterRank']],
    },
  });
  map.addSource(SRC.vehicles, { type: 'geojson', data: empty() });
  map.addSource(SRC.vehicleLabels, { type: 'geojson', data: empty() });
  map.addSource(SRC.selection, { type: 'geojson', data: empty() });

  // A major incident's event area (D-24): a translucent disc with a dashed rim, and a line from its centre to each linked
  // incident — under everything else, so it frames the scene without hiding a marker or a route.
  map.addLayer({
    id: LAYER.majorArea,
    type: 'fill',
    source: SRC.major,
    filter: ['==', ['get', 'area'], 1],
    paint: { 'fill-color': MAJOR_COLOR, 'fill-opacity': 0.1 },
  });
  map.addLayer({
    id: LAYER.majorAreaRim,
    type: 'line',
    source: SRC.major,
    filter: ['==', ['get', 'area'], 1],
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': MAJOR_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 3],
      'line-opacity': 0.8,
      'line-dasharray': [3, 2],
    },
  });
  map.addLayer({
    id: LAYER.majorLinks,
    type: 'line',
    source: SRC.major,
    filter: ['==', ['get', 'link'], 1],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAJOR_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 2.5],
      'line-opacity': 0.75,
      'line-dasharray': [1, 1.5],
    },
  });

  // The link between a water incident's scene and its meeting point (D-68): a thin dashed line in water blue, under
  // everything else so it never hides a route.
  map.addLayer({
    id: LAYER.waterLinks,
    type: 'line',
    source: SRC.water,
    // Only once the incidents are no longer clustered (clusterMaxZoom 11): a cluster has no single meeting point.
    minzoom: 11,
    filter: ['==', ['get', 'link'], 1],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#5AA2E6',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 2.5],
      'line-opacity': 0.85,
      'line-dasharray': [2, 2],
    },
  });
  map.addLayer({
    id: LAYER.routes,
    type: 'line',
    source: SRC.routes,
    // Ordinary legs (no `mode`): the usual dashed line in the family colour.
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['has', 'mode']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
      'line-opacity': ['case', ['==', ['get', 'returning'], 1], 0.35, 0.8],
      'line-dasharray': [1.2, 1.4],
    },
  });
  // A boat on its trailer: the road part of its leg, solid.
  map.addLayer({
    id: LAYER.routesRoad,
    type: 'line',
    source: SRC.routes,
    filter: ['==', ['get', 'mode'], 'ROAD'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
      'line-opacity': ['case', ['==', ['get', 'returning'], 1], 0.35, 0.85],
    },
  });
  // A boat on the water: dashed in its family colour over a translucent water-blue wake.
  map.addLayer({
    id: LAYER.routesWaterWake,
    type: 'line',
    source: SRC.routes,
    filter: ['==', ['get', 'mode'], 'WATER'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#5AA2E6',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 11],
      'line-opacity': ['case', ['==', ['get', 'returning'], 1], 0.12, 0.25],
    },
  });
  map.addLayer({
    id: LAYER.routesWater,
    type: 'line',
    source: SRC.routes,
    filter: ['==', ['get', 'mode'], 'WATER'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
      'line-opacity': ['case', ['==', ['get', 'returning'], 1], 0.4, 0.9],
      'line-dasharray': [2.2, 1.6],
    },
  });
  map.addLayer({
    id: LAYER.routesSelected,
    type: 'line',
    source: SRC.routes,
    filter: selectedRouteFilter('', false),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#FFFFFF',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: LAYER.routesSelectedWater,
    type: 'line',
    source: SRC.routes,
    filter: selectedRouteFilter('', true),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#FFFFFF',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
      'line-opacity': 0.9,
      'line-dasharray': [2.2, 1.6],
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

  // Ground markings (airport-runway-map): a real runway/taxiway centerline, drawn under every marker/icon layer so
  // it reads as pavement rather than competing with them. Same muted, desaturated blues the basemap already uses
  // for the road network (MAP_PALETTE.primary/minor) — the runway sits stylistically with roads, not with the
  // bright per-family gameplay colours. No `minzoom`: visible whenever the facility built on it would be.
  map.addLayer({
    id: LAYER.runways,
    type: 'line',
    source: SRC.runways,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'runwayKind'], 'RUNWAY', MAP_PALETTE.primary, MAP_PALETTE.minor],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['match', ['get', 'runwayKind'], 'RUNWAY', 1.4, 0.7],
        14,
        ['match', ['get', 'runwayKind'], 'RUNWAY', 5, 2],
        17,
        ['match', ['get', 'runwayKind'], 'RUNWAY', 11, 4],
      ] as never,
      'line-opacity': 0.85,
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
    source: SRC.facilityLabels,
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

  // Launch / recovery point of a boat's trailer leg (D-68), and the meeting points of water incidents.
  map.addLayer({
    id: LAYER.launchPoints,
    type: 'symbol',
    source: SRC.routes,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'icon-image': ['get', 'image'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 15, 0.9],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: LAYER.meetingPoints,
    type: 'symbol',
    source: SRC.water,
    minzoom: 11,
    filter: ['==', ['get', 'meeting'], 1],
    layout: {
      'icon-image': ['get', 'image'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
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
  // The name of a major at its centre ("MAXI-EMERGENZA"), under the main scene's pin; a tap opens the coordination view.
  map.addLayer({
    id: LAYER.majorLabel,
    type: 'symbol',
    source: SRC.majorCentre,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': GAME_LABEL_FONT,
      'text-size': 12,
      'text-offset': [0, 0.9],
      'text-anchor': 'top',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': MAJOR_COLOR, 'text-halo-color': '#0A1220', 'text-halo-width': 2 },
  });
  map.addLayer({
    id: LAYER.clusterHalo,
    type: 'circle',
    source: SRC.incidents,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 25, 5, 30, 15, 35],
      'circle-color': CLUSTER_SEVERITY_EXPR as never,
      'circle-opacity': 0.38,
      'circle-blur': 0.25,
    },
  });
  // A cluster says what is inside (03 §2.7): the pictogram of its most severe incident, ringed in that severity's
  // colour, and the count — all drawn into one generated image (`clu:…`, map/images.ts), no map glyphs needed.
  map.addLayer({
    id: LAYER.clusters,
    type: 'symbol',
    source: SRC.incidents,
    filter: ['has', 'point_count'],
    layout: {
      'icon-image': [
        'concat',
        'clu:',
        ['to-string', ['%', ['get', 'topRank'], 1000]],
        ':',
        ['to-string', ['floor', ['/', ['get', 'topRank'], 1000]]],
        ':',
        ['to-string', ['min', 100, ['get', 'point_count']]],
      ] as never,
      'icon-size': ['step', ['get', 'point_count'], 0.9, 5, 1, 15, 1.12],
      // The ring is drawn 2 px left of / below the image centre (room for the count): keep it on the point.
      'icon-offset': [2, -2],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  // Working on scene / at the hospital: a steady ring in the vehicle's own service colour — present, not racing.
  map.addLayer({
    id: LAYER.vehicleSceneRing,
    type: 'circle',
    source: SRC.vehicles,
    filter: ['==', ['get', 'state'], 'ON_SCENE'],
    paint: {
      'circle-radius': 9,
      'circle-color': 'transparent',
      'circle-stroke-color': ['get', 'stateColor'] as never,
      'circle-stroke-width': 2,
    },
  });
  // Broken down / awaiting recovery: a steady amber warning ring — needs the player's attention, but is not moving.
  map.addLayer({
    id: LAYER.vehicleTroubleRing,
    type: 'circle',
    source: SRC.vehicles,
    filter: ['==', ['get', 'state'], 'TROUBLE'],
    paint: {
      'circle-radius': 10,
      'circle-color': 'transparent',
      'circle-stroke-color': '#F5B63C',
      'circle-stroke-width': 2.5,
    },
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
    // Dimmed while returning to base (matches the trailing route line's own opacity drop below); full brightness
    // for every other state, including the urgent/on-scene/trouble rings drawn underneath.
    paint: {
      'icon-opacity': ['match', ['get', 'state'], 'RETURNING', 0.5, 1],
    },
  });
  // Real light: a hard on/off beacon in the vehicle's OWN colour, sitting on top of the icon (not underneath it,
  // so it is never hidden by it) for a vehicle racing to an incident or a hospital transport (URGENT).
  // Centred exactly on the vehicle (no screen-space offset): the icon rotates to face its heading via
  // `icon-rotate`/`icon-rotation-alignment: map`, but a circle layer's `circle-translate` is a fixed SCREEN
  // offset that does NOT turn with it — any non-zero offset here would drift off the vehicle as it turns.
  // Reads correctly for a top-down pictogram anyway: a rooftop light seen from directly above sits at the
  // vehicle's own centre. `setVehicleUrgentPulsePhase` snaps its opacity between fully lit and fully off — a
  // genuine blink, not a fade — on a fast, fixed cycle. Under prefers-reduced-motion it is simply never called,
  // so the beacon freezes lit (still unmistakably an emergency light, just not flashing).
  map.addLayer({
    id: LAYER.vehicleUrgentPulse,
    type: 'circle',
    source: SRC.vehicles,
    filter: ['==', ['get', 'state'], 'URGENT'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 14, 5, 17, 6.5],
      'circle-color': ['get', 'stateColor'] as never,
      'circle-stroke-color': '#0A1220',
      'circle-stroke-width': 1.25,
      'circle-opacity': 1,
      'circle-stroke-opacity': 1,
    },
  });
  map.addLayer({
    id: LAYER.vehicleLabels,
    type: 'symbol',
    source: SRC.vehicleLabels,
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

/** The route lines of one vehicle: its water pieces (dashed) apart from everything else (solid). */
function selectedRouteFilter(vehicleId: string, water: boolean): FilterSpecification {
  return [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    ['==', ['get', 'id'], vehicleId],
    water ? ['==', ['get', 'mode'], 'WATER'] : ['!=', ['get', 'mode'], 'WATER'],
  ];
}

/**
 * A GeoJSON source of the map, or undefined — also when the map is being torn down (MapLibre's `getSource` throws once
 * `remove()` ran). A data push racing a teardown must never escape: thrown inside a React effect it would reach the game's
 * error boundary and blank the whole screen for a map that is going away anyway.
 */
export function geoJsonSource(map: MlMap, source: string): GeoJSONSource | undefined {
  try {
    return map.getSource(source) as GeoJSONSource | undefined;
  } catch {
    return undefined;
  }
}

export const setData = (map: MlMap, source: string, data: FeatureCollection): void => {
  geoJsonSource(map, source)?.setData(data);
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
  const selectedVehicle = selection?.kind === 'vehicle' ? selection.id : '';
  if (map.getLayer(LAYER.routesSelected))
    map.setFilter(LAYER.routesSelected, selectedRouteFilter(selectedVehicle, false));
  if (map.getLayer(LAYER.routesSelectedWater))
    map.setFilter(LAYER.routesSelectedWater, selectedRouteFilter(selectedVehicle, true));
}

/** Pulse for unattended incidents, driven by wall time (≈12 fps is enough and keeps the GPU idle-friendly). */
export function setPulsePhase(map: MlMap, phase: number): void {
  if (!map.getLayer(LAYER.incidentPulse)) return;
  map.setPaintProperty(LAYER.incidentPulse, 'circle-radius', 16 + phase * 22);
  map.setPaintProperty(LAYER.incidentPulse, 'circle-opacity', 0.45 * (1 - phase));
}

/**
 * Real light for vehicles racing to an incident or a hospital (state URGENT): a beacon in the vehicle's OWN
 * colour that hard-blinks on/off — no fade — like an actual emergency light, driven by wall time (`phase` is one
 * blink cycle, 0↔1; on for the first third, off for the rest, which reads as a crisper flash than a 50/50 blink).
 * Caller skips this entirely under prefers-reduced-motion, leaving the beacon lit (still unmistakably a light,
 * just frozen instead of flashing).
 */
export function setVehicleUrgentPulsePhase(map: MlMap, phase: number): void {
  if (!map.getLayer(LAYER.vehicleUrgentPulse)) return;
  const lit = phase < 0.35;
  map.setPaintProperty(LAYER.vehicleUrgentPulse, 'circle-opacity', lit ? 1 : 0);
  map.setPaintProperty(LAYER.vehicleUrgentPulse, 'circle-stroke-opacity', lit ? 1 : 0);
}

/**
 * Layers added by map overlays (hospitals, candidate sites…) that take part in click-to-select: their features must
 * carry `properties.kind` (a `Selection` kind) and `properties.id`.
 */
const EXTRA_CLICKABLE = new Set<string>();
export function registerClickableLayer(layerId: string): () => void {
  EXTRA_CLICKABLE.add(layerId);
  return () => EXTRA_CLICKABLE.delete(layerId);
}

/**
 * Click / tap on the map: a marker selects it, a cluster zooms into it, empty map calls `onEmptyTap` — which must NOT
 * clear the selection: a stray tap next to a marker used to close the open inspector (02 §4 #6).
 */
export function bindInteractions(
  map: MlMap,
  handlers: { onSelect: (selection: NonNullable<Selection>) => void; onEmptyTap: () => void },
): () => void {
  const clickable = [
    LAYER.incidents,
    LAYER.meetingPoints,
    LAYER.vehicles,
    LAYER.facilities,
    LAYER.clusters,
    LAYER.majorLabel,
  ];
  const onClick = (e: MapMouseEvent) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: [...clickable, ...EXTRA_CLICKABLE].filter((l) => map.getLayer(l)),
    });
    const top = features[0];
    if (!top) {
      handlers.onEmptyTap();
      return;
    }
    const props = top.properties as {
      id?: string;
      kind?: NonNullable<Selection>['kind'];
      cluster_id?: number;
    };
    if (props.cluster_id !== undefined) {
      const geometry = top.geometry as Point;
      void geoJsonSource(map, SRC.incidents)
        ?.getClusterExpansionZoom(props.cluster_id)
        .then((zoom) => map.easeTo({ center: geometry.coordinates as [number, number], zoom: zoom + 0.5 }))
        .catch(() => undefined);
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
