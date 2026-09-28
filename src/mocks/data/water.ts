import type { LngLat } from '@/lib/geo';
import type { WaterBodyType } from './catalog';

/**
 * Water geodata of the mock (D-23 / D-68), taken from the real release `it-abruzzo-20260927` of the geodata pipeline
 * (analisi/note-agenti/water-geodata.md) and trimmed to Pescara:
 *  - sea points pushed 150–800 m offshore along the coastline normal, each with the road point where land units stop (the
 *    meeting point) and the water's edge next to it (where the boat lands the rescued);
 *  - points on the river Pescara (the axis of the river), whose meeting point is the nearest road;
 *  - the three nautical sites of the area (harbour + seafront), each with the berth on the water its boats start from;
 *  - launch points (harbour, slipways) where a boat on its trailer is put into another water.
 * Keys, coordinates and street names are the real ones; the river name reads "Fiume Pescara" instead of the bare OSM name.
 */
export interface MockWaterBody {
  id: string;
  type: WaterBodyType;
  name: string | null;
}
export const WATER_BODIES: Record<string, MockWaterBody> = {
  'sea:adriatic': { id: 'sea:adriatic', type: 'SEA', name: 'Mare Adriatico' },
  'river:pescara': { id: 'river:pescara', type: 'RIVER', name: 'Fiume Pescara' },
};

export interface MockWaterPoint {
  key: string;
  bodyId: keyof typeof WATER_BODIES;
  /** The scene, on the water. */
  position: LngLat;
  /** The meeting point: road nearest to the shore (≤ 400 m), where land units stop. */
  snapped: LngLat;
  /** The water's edge next to the meeting point (sea points); null = land at the meeting point itself. */
  shore: LngLat | null;
  street: string;
  municipality: string;
}

const sea = (
  key: string,
  position: LngLat,
  snapped: LngLat,
  shore: LngLat,
  street: string,
  municipality = 'Pescara',
): MockWaterPoint => ({
  key: `COAST:${key}`,
  bodyId: 'sea:adriatic',
  position,
  snapped,
  shore,
  street,
  municipality,
});
const river = (key: string, position: LngLat, snapped: LngLat, street: string): MockWaterPoint => ({
  key: `WATER:${key}`,
  bodyId: 'river:pescara',
  position,
  snapped,
  shore: null,
  street,
  municipality: 'Pescara',
});

export const WATER_POINTS: MockWaterPoint[] = [
  sea(
    'w28532820:289',
    [14.191404, 42.491998],
    [14.188905, 42.490116],
    [14.190135, 42.490853],
    'Viale della Riviera',
  ),
  sea(
    'w28532820:288',
    [14.193958, 42.492275],
    [14.19, 42.489126],
    [14.191481, 42.490041],
    'Viale della Riviera',
  ),
  sea(
    'w28532820:287',
    [14.196232, 42.492301],
    [14.191037, 42.488181],
    [14.192828, 42.48923],
    'Viale della Riviera',
  ),
  sea(
    'w28532820:279',
    [14.208301, 42.481851],
    [14.203543, 42.47874],
    [14.204891, 42.479813],
    'Viale della Riviera',
  ),
  sea(
    'w28532820:278',
    [14.209031, 42.480222],
    [14.204872, 42.477826],
    [14.205992, 42.478711],
    'Viale della Riviera',
  ),
  sea(
    'w28532820:275',
    [14.213823, 42.480905],
    [14.207813, 42.475797],
    [14.208968, 42.476695],
    'Viale della Riviera',
  ),
  sea(
    'w28532820:269',
    [14.222761, 42.475707],
    [14.216624, 42.47033],
    [14.217665, 42.4713],
    'Lungomare Giacomo Matteotti',
  ),
  sea(
    'w28532820:68',
    [14.243407, 42.458129],
    [14.238645, 42.455347],
    [14.240015, 42.456384],
    'Via Camillo De Nardis',
  ),
  sea(
    'w28532820:63',
    [14.244077, 42.461233],
    [14.240223, 42.454201],
    [14.241374, 42.455063],
    'Viale Primo Vere',
  ),
  sea(
    'w28532820:51',
    [14.246726, 42.457411],
    [14.241374, 42.453362],
    [14.242323, 42.454079],
    'Viale Primo Vere',
  ),
  sea(
    'w28532820:5',
    [14.254851, 42.447149],
    [14.252139, 42.445307],
    [14.252882, 42.44585],
    'Viale Primo Vere',
    'Francavilla al Mare',
  ),
  sea(
    'w28532850:184',
    [14.25775, 42.4446],
    [14.255522, 42.442828],
    [14.256324, 42.443442],
    'Viale Alcione',
    'Francavilla al Mare',
  ),
  river('w41265245:624', [14.169436, 42.435354], [14.16763, 42.435234], 'Via Mare Adriatico'),
  river('w41265245:652', [14.181221, 42.44435], [14.179998, 42.445557], 'Viale Europa'),
  river(
    'w41265245:663',
    [14.18636, 42.448964],
    [14.185108, 42.44783],
    'Strada Statale 714 Tangenziale di Pescara',
  ),
  river('w41265245:680', [14.194697, 42.456735], [14.19383, 42.456992], 'Via Nuoro'),
  river('w41265245:684', [14.196231, 42.457987], [14.197442, 42.458313], 'Ponte della Libertà'),
  river('w41265245:695', [14.20351, 42.46168], [14.203282, 42.462309], 'Via Valle Roveto'),
  river('w41265245:707', [14.215825, 42.463716], [14.21566, 42.463995], 'Lungofiume dei Poeti'),
  river('r13095454', [14.223246, 42.466148], [14.22205, 42.466569], 'Via Raffaele Paolucci'),
];

export interface MockNauticalSite {
  key: string;
  name: string;
  origin: 'HARBOUR' | 'SEAFRONT' | 'LAKESHORE';
  /** Road-side point: the facility marker, where the trailer leaves from. */
  position: LngLat;
  /** On the water: where the boats of the Base nautica start from and moor. */
  berth: LngLat;
  bodyId: keyof typeof WATER_BODIES;
  address: string;
  capacityPoints: number;
}
export const NAUTICAL_SITES: MockNauticalSite[] = [
  {
    key: 'nautical-marina',
    name: 'Base nautica Marina di Pescara',
    origin: 'HARBOUR',
    position: [14.231798, 42.467164],
    berth: [14.23165, 42.466976],
    bodyId: 'sea:adriatic',
    address: 'Marina di Pescara, Pescara',
    capacityPoints: 6,
  },
  {
    key: 'nautical-riviera',
    name: 'Base nautica Viale della Riviera',
    origin: 'SEAFRONT',
    position: [14.189621, 42.48961],
    berth: [14.191222, 42.490662],
    bodyId: 'sea:adriatic',
    address: 'Viale della Riviera, Pescara',
    capacityPoints: 4,
  },
  {
    key: 'nautical-saline',
    name: 'Base nautica Via Saline',
    origin: 'SEAFRONT',
    position: [14.254769, 42.44398],
    berth: [14.255855, 42.444242],
    bodyId: 'sea:adriatic',
    address: 'Via Saline, Francavilla al Mare',
    capacityPoints: 4,
  },
];

export interface MockLaunchPoint {
  key: string;
  kind: 'SLIPWAY' | 'HARBOUR';
  /** Null like most slipways of OpenStreetMap: the UI says "punto di varo". */
  name: string | null;
  /** Road side, where the trailer stops. */
  position: LngLat;
  /** Water side, where the boat goes in. */
  water: LngLat;
  bodyId: keyof typeof WATER_BODIES;
}
export const LAUNCH_POINTS: MockLaunchPoint[] = [
  {
    key: 'launch:harbour:osm:r14034484',
    kind: 'HARBOUR',
    name: 'Porto canale di Pescara',
    position: [14.224665, 42.468068],
    water: [14.22365, 42.468765],
    bodyId: 'sea:adriatic',
  },
  {
    key: 'launch:harbour:osm:w342622652',
    kind: 'HARBOUR',
    name: 'Marina di Pescara',
    position: [14.231822, 42.467195],
    water: [14.23165, 42.466976],
    bodyId: 'sea:adriatic',
  },
  {
    key: 'launch:osm:n1620462820',
    kind: 'SLIPWAY',
    name: null,
    position: [14.234243, 42.465663],
    water: [14.234127, 42.465767],
    bodyId: 'sea:adriatic',
  },
  {
    key: 'launch:osm:n8491774283',
    kind: 'SLIPWAY',
    name: null,
    position: [14.228996, 42.466548],
    water: [14.229152, 42.466478],
    bodyId: 'sea:adriatic',
  },
  {
    key: 'launch:harbour:osm:r8507019',
    kind: 'HARBOUR',
    name: 'Porto di Francavilla',
    position: [14.282567, 42.426846],
    water: [14.28229, 42.427018],
    bodyId: 'sea:adriatic',
  },
];
