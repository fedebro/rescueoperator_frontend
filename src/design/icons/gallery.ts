import type { ServiceFamily } from '@/contracts';
import { CATALOG_ICONS, vehicleClassOf } from './catalog-map';
import { PICTOGRAM_NAMES, type PictogramName, type VehicleClass } from './names';

/** One tile of the living style guide: `id` is a code identifier (catalog icon key or registry name), never UI text. */
export interface GalleryEntry {
  id: string;
  name: PictogramName;
  topdown?: { vehicleClass: VehicleClass; family: ServiceFamily };
}
export interface GalleryGroup {
  /** Code-style heading: the key pattern of the group (`vehicle-fire-*`). */
  id: string;
  entries: GalleryEntry[];
}

const GROUPS: readonly (readonly [prefix: string, family?: ServiceFamily])[] = [
  ['family-'],
  ['vehicle-fire-', 'FIRE'],
  ['vehicle-ems-', 'EMS'],
  ['vehicle-pol-', 'POLICE'],
  ['vehicle-aib-', 'WILDFIRE'],
  ['vehicle-alp-', 'ALPINE'],
  ['ung-', 'UNG'],
  ['facility-fire-'],
  ['facility-ems-'],
  ['facility-police-'],
  ['facility-aib-'],
  ['facility-alpine-'],
  ['facility-coordination-'],
  ['incident-fire-'],
  ['incident-med-'],
  ['incident-road-'],
  ['incident-tech-'],
  ['incident-multi-'],
  ['incident-pol-'],
  ['incident-wf-'],
  ['incident-alp-'],
  ['capability-'],
  ['item-'],
  ['upgrade-'],
  ['role-'],
  ['qualification-'],
  ['hospital-'],
];

/**
 * Every icon of the set, grouped for the `/design` gallery: first the catalog keys (vehicles by family, facilities by
 * chain, incidents by service…), then the glyphs no catalog key points at (classes, categories, generic world glyphs).
 */
export function iconGallery(): GalleryGroup[] {
  const keys = Object.keys(CATALOG_ICONS);
  const groups: GalleryGroup[] = GROUPS.map(([prefix, family]) => ({
    id: `${prefix}*`,
    entries: keys
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({
        id: key,
        name: CATALOG_ICONS[key]!,
        ...(family ? { topdown: { vehicleClass: vehicleClassOf(key), family } } : {}),
      })),
  }));
  const used = new Set(Object.values(CATALOG_ICONS));
  const rest = PICTOGRAM_NAMES.filter((name) => !used.has(name));
  const registry = (id: string, test: (name: string) => boolean): GalleryGroup => ({
    id,
    entries: rest.filter(test).map((name) => ({ id: name, name })),
  });
  return [
    ...groups,
    registry('veh_*', (n) => n.startsWith('veh_')),
    registry('cat_*', (n) => n.startsWith('cat_')),
    registry('*', (n) => !n.startsWith('veh_') && !n.startsWith('cat_')),
  ].filter((group) => group.entries.length > 0);
}
