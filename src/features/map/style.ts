import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { env } from '@/lib/env';

/**
 * Custom dark basemap. The visual hierarchy follows Google Maps' night style — land / water / green are clearly
 * distinct, the road network reads by class (motorway > primary > secondary > minor), buildings are subtle,
 * labels are clean with a dark halo — recoloured on the Rescue Control navy.
 *
 * Two vector schemas are supported with the same palette:
 *  - `openmaptiles` (default, OpenFreeMap public tiles — development)
 *  - `protomaps`    (Protomaps basemap v4 schema)
 * A self-hosted PMTiles archive (NEXT_PUBLIC_PMTILES_URL, production) can use either schema: NEXT_PUBLIC_PMTILES_SCHEMA
 * (default `openmaptiles`, which is what the project's geodata pipeline builds).
 */
export const MAP_PALETTE = {
  land: '#111C2E',
  landAlt: '#14213A',
  water: '#0B2A4A',
  waterLine: '#0E3358',
  green: '#12322B',
  wood: '#0F2B25',
  sand: '#1D2738',
  building: '#1A2942',
  buildingLine: '#223352',
  aeroway: '#1A2740',
  rail: '#31425F',
  minor: '#26364F',
  minorCase: '#0D1626',
  secondary: '#33486B',
  primary: '#41597F',
  motorway: '#56709C',
  motorwayCase: '#1A2740',
  path: '#2A3B57',
  label: '#9FB0C9',
  labelStrong: '#DCE5F2',
  labelWater: '#5E8FC2',
  halo: '#0A1220',
  boundary: '#3A4C6B',
} as const;

export type BasemapSchema = 'openmaptiles' | 'protomaps';
export const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const P = MAP_PALETTE;
const FONT = [env.mapFontRegular];
const FONT_BOLD = [env.mapFontBold];
/** Font stack for the game's own label layers (must exist on the configured glyph server). */
export const GAME_LABEL_FONT = FONT_BOLD;
const width = (stops: [number, number][]): unknown => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  ...stops.flat(),
];

function line(
  id: string,
  sourceLayer: string,
  filter: unknown,
  color: string,
  stops: [number, number][],
  minzoom = 0,
  extra: Record<string, unknown> = {},
): LayerSpecification {
  return {
    id,
    type: 'line',
    source: 'basemap',
    'source-layer': sourceLayer,
    minzoom,
    filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width(stops), ...extra },
  } as LayerSpecification;
}

function openMapTilesLayers(): LayerSpecification[] {
  const cls = (...c: string[]) => ['match', ['get', 'class'], c, true, false];
  const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
  const road = (c: string[]) => ['all', cls(...c), notTunnel];
  return [
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landcover',
      filter: cls('grass', 'farmland'),
      paint: { 'fill-color': P.green, 'fill-opacity': 0.45 },
    },
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landcover',
      filter: cls('wood'),
      paint: { 'fill-color': P.wood, 'fill-opacity': 0.8 },
    },
    {
      id: 'landcover-sand',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landcover',
      filter: cls('sand'),
      paint: { 'fill-color': P.sand },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: cls('residential', 'commercial', 'industrial', 'retail'),
      paint: { 'fill-color': P.landAlt, 'fill-opacity': 0.6 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'park',
      paint: { 'fill-color': P.green, 'fill-opacity': 0.75 },
    },
    {
      id: 'landuse-green',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: cls('cemetery', 'stadium', 'pitch', 'playground'),
      paint: { 'fill-color': P.green, 'fill-opacity': 0.6 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      paint: { 'fill-color': P.water },
    },
    line('waterway', 'waterway', ['all'], P.waterLine, [
      [8, 0.6],
      [14, 2.5],
      [18, 8],
    ]),
    {
      id: 'aeroway',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'aeroway',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': P.aeroway },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'building',
      minzoom: 13.5,
      paint: {
        'fill-color': P.building,
        'fill-outline-color': P.buildingLine,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, 0.9],
      },
    },
    line(
      'tunnel',
      'transportation',
      [
        'all',
        ['==', ['get', 'brunnel'], 'tunnel'],
        cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
      ],
      P.minor,
      [
        [10, 0.5],
        [14, 2],
        [18, 10],
      ],
      10,
      { 'line-opacity': 0.5, 'line-dasharray': [2, 1.5] },
    ),
    line(
      'road-path',
      'transportation',
      road(['path', 'track']),
      P.path,
      [
        [14, 0.5],
        [18, 2],
      ],
      14,
      { 'line-dasharray': [1.5, 1.5] },
    ),
    line(
      'road-minor-case',
      'transportation',
      road(['minor', 'service']),
      P.minorCase,
      [
        [12, 0.8],
        [14, 3],
        [18, 16],
      ],
      12,
    ),
    line(
      'road-minor',
      'transportation',
      road(['minor', 'service']),
      P.minor,
      [
        [12, 0.4],
        [14, 2],
        [18, 13],
      ],
      12,
    ),
    line(
      'road-secondary-case',
      'transportation',
      road(['secondary', 'tertiary']),
      P.minorCase,
      [
        [8, 0.8],
        [13, 4],
        [18, 22],
      ],
      8,
    ),
    line(
      'road-secondary',
      'transportation',
      road(['secondary', 'tertiary']),
      P.secondary,
      [
        [8, 0.4],
        [13, 2.6],
        [18, 18],
      ],
      8,
    ),
    line(
      'road-primary-case',
      'transportation',
      road(['primary', 'trunk']),
      P.motorwayCase,
      [
        [6, 1],
        [13, 5],
        [18, 26],
      ],
      6,
    ),
    line(
      'road-primary',
      'transportation',
      road(['primary', 'trunk']),
      P.primary,
      [
        [6, 0.5],
        [13, 3.4],
        [18, 22],
      ],
      6,
    ),
    line(
      'road-motorway-case',
      'transportation',
      road(['motorway']),
      P.motorwayCase,
      [
        [5, 1.2],
        [13, 6],
        [18, 30],
      ],
      5,
    ),
    line(
      'road-motorway',
      'transportation',
      road(['motorway']),
      P.motorway,
      [
        [5, 0.6],
        [13, 4],
        [18, 26],
      ],
      5,
    ),
    line(
      'rail',
      'transportation',
      cls('rail'),
      P.rail,
      [
        [10, 0.5],
        [16, 2],
      ],
      10,
      { 'line-dasharray': [3, 2] },
    ),
    line(
      'boundary',
      'boundary',
      ['<=', ['get', 'admin_level'], 6],
      P.boundary,
      [
        [4, 0.5],
        [12, 1.5],
      ],
      0,
      { 'line-dasharray': [3, 2], 'line-opacity': 0.6 },
    ),
    {
      id: 'road-label',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'transportation_name',
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
        'text-max-angle': 30,
        'symbol-spacing': 320,
      },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'water-label',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'water_name',
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': FONT,
        'text-size': 12,
        'text-letter-spacing': 0.1,
      },
      paint: { 'text-color': P.labelWater, 'text-halo-color': P.halo, 'text-halo-width': 1 },
    },
    {
      id: 'place-suburb',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      minzoom: 11.5,
      filter: cls('suburb', 'neighbourhood', 'quarter', 'hamlet'),
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': FONT,
        'text-size': 11,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
      },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-town',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      filter: cls('town', 'village'),
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15],
      },
      paint: { 'text-color': P.labelStrong, 'text-halo-color': P.halo, 'text-halo-width': 1.6 },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'place',
      filter: cls('city'),
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 12, 20],
      },
      paint: { 'text-color': P.labelStrong, 'text-halo-color': P.halo, 'text-halo-width': 1.8 },
    },
  ] as LayerSpecification[];
}

function protomapsLayers(): LayerSpecification[] {
  const kind = (...k: string[]) => ['match', ['get', 'kind'], k, true, false];
  return [
    {
      id: 'earth',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'earth',
      paint: { 'fill-color': P.land },
    },
    {
      id: 'landuse-urban',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: kind('residential', 'commercial', 'industrial', 'school', 'university', 'hospital'),
      paint: { 'fill-color': P.landAlt, 'fill-opacity': 0.6 },
    },
    {
      id: 'landuse-green',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: kind(
        'park',
        'grass',
        'garden',
        'cemetery',
        'golf_course',
        'pitch',
        'playground',
        'recreation_ground',
        'national_park',
        'nature_reserve',
        'meadow',
        'farmland',
      ),
      paint: { 'fill-color': P.green, 'fill-opacity': 0.75 },
    },
    {
      id: 'landuse-wood',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: kind('forest', 'wood', 'scrub'),
      paint: { 'fill-color': P.wood, 'fill-opacity': 0.8 },
    },
    {
      id: 'landuse-sand',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: kind('beach', 'sand'),
      paint: { 'fill-color': P.sand },
    },
    {
      id: 'landuse-aeroway',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      filter: kind('aerodrome', 'runway', 'taxiway'),
      paint: { 'fill-color': P.aeroway },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': P.water },
    },
    line('waterway', 'water', ['==', ['geometry-type'], 'LineString'], P.waterLine, [
      [8, 0.6],
      [14, 2.5],
      [18, 8],
    ]),
    {
      id: 'building',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'buildings',
      minzoom: 13.5,
      paint: {
        'fill-color': P.building,
        'fill-outline-color': P.buildingLine,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, 0.9],
      },
    },
    line(
      'road-path',
      'roads',
      kind('path'),
      P.path,
      [
        [14, 0.5],
        [18, 2],
      ],
      14,
      { 'line-dasharray': [1.5, 1.5] },
    ),
    line(
      'road-minor-case',
      'roads',
      kind('minor_road'),
      P.minorCase,
      [
        [12, 0.8],
        [14, 3],
        [18, 16],
      ],
      12,
    ),
    line(
      'road-minor',
      'roads',
      kind('minor_road'),
      P.minor,
      [
        [12, 0.4],
        [14, 2],
        [18, 13],
      ],
      12,
    ),
    line(
      'road-major-case',
      'roads',
      kind('major_road'),
      P.motorwayCase,
      [
        [7, 0.9],
        [13, 4.6],
        [18, 24],
      ],
      7,
    ),
    line(
      'road-major',
      'roads',
      kind('major_road'),
      P.primary,
      [
        [7, 0.45],
        [13, 3],
        [18, 20],
      ],
      7,
    ),
    line(
      'road-motorway-case',
      'roads',
      kind('highway'),
      P.motorwayCase,
      [
        [5, 1.2],
        [13, 6],
        [18, 30],
      ],
      5,
    ),
    line(
      'road-motorway',
      'roads',
      kind('highway'),
      P.motorway,
      [
        [5, 0.6],
        [13, 4],
        [18, 26],
      ],
      5,
    ),
    line(
      'rail',
      'roads',
      kind('rail'),
      P.rail,
      [
        [10, 0.5],
        [16, 2],
      ],
      10,
      { 'line-dasharray': [3, 2] },
    ),
    line(
      'boundary',
      'boundaries',
      ['all'],
      P.boundary,
      [
        [4, 0.5],
        [12, 1.5],
      ],
      0,
      { 'line-dasharray': [3, 2], 'line-opacity': 0.6 },
    ),
    {
      id: 'road-label',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'roads',
      minzoom: 13,
      filter: kind('highway', 'major_road', 'minor_road'),
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
        'symbol-spacing': 320,
      },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-suburb',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'places',
      minzoom: 11.5,
      filter: kind('neighbourhood', 'macrohood'),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT,
        'text-size': 11,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
      },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-locality',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'places',
      filter: kind('locality'),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 13, 18],
      },
      paint: { 'text-color': P.labelStrong, 'text-halo-color': P.halo, 'text-halo-width': 1.8 },
    },
  ] as LayerSpecification[];
}

export interface BasemapConfig {
  schema: BasemapSchema;
  sourceUrl: string;
}

export function resolveBasemap(
  e: Pick<typeof env, 'pmtilesUrl' | 'mapTileJsonUrl' | 'pmtilesSchema'> = env,
): BasemapConfig {
  return e.pmtilesUrl
    ? { schema: e.pmtilesSchema, sourceUrl: `pmtiles://${e.pmtilesUrl}` }
    : { schema: 'openmaptiles', sourceUrl: e.mapTileJsonUrl };
}

export function buildMapStyle(
  config: BasemapConfig = resolveBasemap(),
  glyphs: string = env.mapGlyphsUrl,
): StyleSpecification {
  return {
    version: 8,
    name: 'Rescue Control Dark',
    glyphs,
    sources: { basemap: { type: 'vector', url: config.sourceUrl, attribution: OSM_ATTRIBUTION } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': P.land } },
      ...(config.schema === 'protomaps' ? protomapsLayers() : openMapTilesLayers()),
    ],
  };
}
