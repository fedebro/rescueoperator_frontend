import * as React from 'react';
import type { FacilityFamily, ServiceFamily } from '@/contracts';

/** Vehicles/incidents belong to a ServiceFamily; facilities may also be SHARED (coordination centre). */
export type AnyFamily = ServiceFamily | FacilityFamily;
import { cn } from '@/lib/utils';
import { PICTOGRAMS } from './pictograms';
import { TOPDOWN } from './topdown';
import { PICTOGRAM_NAMES, VEHICLE_CLASSES, type PictogramName, type VehicleClass } from './names';

import {
  CATALOG_ICONS,
  MAJOR_ICONS,
  catalogIconName,
  facilityIconKey,
  hasCatalogIcon,
  incidentIconName,
  majorIconName,
  vehicleClassOf,
  vehiclePictogramOf,
} from './catalog-map';

export { PICTOGRAM_NAMES, VEHICLE_CLASSES, type PictogramName, type VehicleClass };
export { vehicleClassOf, vehiclePictogramOf, incidentIconName, catalogIconName, facilityIconKey };
export { CATALOG_ICONS, hasCatalogIcon, MAJOR_ICONS, majorIconName };

export const FAMILY_COLORS: Record<AnyFamily, { primary: string; dark: string }> = {
  SHARED: { primary: '#6B7FA3', dark: '#3A4763' },
  FIRE: { primary: '#E5342B', dark: '#8E1A14' },
  EMS: { primary: '#2F7DF0', dark: '#174A9C' },
  POLICE: { primary: '#2B4FB8', dark: '#162C6E' },
  WILDFIRE: { primary: '#F08A1C', dark: '#9A5408' },
  ALPINE: { primary: '#1F9D63', dark: '#0F5C39' },
  UNG: { primary: '#8492A6', dark: '#4A5668' },
};
export const familyCssVar = (family: AnyFamily): string => `var(--rc-family-${family.toLowerCase()})`;

export const isPictogram = (name: string): name is PictogramName =>
  (PICTOGRAM_NAMES as readonly string[]).includes(name);
export const isVehicleClass = (name: string): name is VehicleClass =>
  (VEHICLE_CLASSES as readonly string[]).includes(name);

/** Catalog `icon` strings → registry names, with safe fallbacks for codes the client does not know yet. */
export const vehicleIconName = (icon: string | undefined): PictogramName => vehiclePictogramOf(icon);
/** `category` is the catalog category (FIRE, MEDICAL…) or a legacy lower-case name; `icon` = the template icon key. */
export const categoryIconName = (category: string, icon?: string | null): PictogramName => {
  const mapped = incidentIconName(category, icon);
  if (mapped) return mapped;
  const n = `cat_${category.toLowerCase()}`;
  return isPictogram(n) ? n : 'cat_generic';
};
export const capabilityIconName = (code: string): PictogramName => {
  const n = `cap_${code.toLowerCase()}`;
  return isPictogram(n) ? n : 'cap_logistics';
};
export const familyIconName = (family: AnyFamily): PictogramName =>
  family === 'SHARED' ? 'facility_coordination' : (`family_${family.toLowerCase()}` as PictogramName);
export const facilityIconName = (family: AnyFamily): PictogramName =>
  family === 'UNG' || family === 'SHARED'
    ? 'facility_coordination'
    : (`facility_${family.toLowerCase()}` as PictogramName);
/** Facility pictogram of a TYPE (catalog type code `FIRE_COMMAND` or icon key `facility-fire-command`); unknown types fall back to the family glyph. */
export const facilityTypeIconName = (family: AnyFamily, typeCodeOrKey?: string | null): PictogramName => {
  const key = typeCodeOrKey ? facilityIconKey(typeCodeOrKey) : null;
  return key && hasCatalogIcon(key) ? catalogIconName(key) : facilityIconName(family);
};

export function pictogramSvg(
  name: PictogramName,
  opts: { color?: string; size?: number; strokeWidth?: number } = {},
): string {
  const { color = 'currentColor', size = 24, strokeWidth = 1.75 } = opts;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" color="${color}">${PICTOGRAMS[name]}</svg>`;
}

export function topdownSvg(vehicleClass: VehicleClass, family: ServiceFamily, size = 32): string {
  const c = FAMILY_COLORS[family];
  const body = TOPDOWN[vehicleClass]
    .replaceAll('{primary}', c.primary)
    .replaceAll('{dark}', c.dark)
    .replaceAll('{light}', '#DCEBFF')
    .replaceAll('{outline}', '#F4F7FB');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${body}</svg>`;
}

export interface GameIconProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'name'> {
  name: PictogramName;
  size?: number;
  title?: string;
}

export function GameIcon({ name, size = 20, title, className, ...props }: GameIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0', className)}
      {...props}
      dangerouslySetInnerHTML={{ __html: PICTOGRAMS[name] }}
    />
  );
}

/** Family tile: coloured rounded square + pictogram + (optionally) the family short label — colour is never the only cue. */
export function FamilyBadge({
  family,
  size = 28,
  title,
  className,
}: {
  family: AnyFamily;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      className={cn('inline-grid shrink-0 place-items-center rounded-md text-white', className)}
      style={{ width: size, height: size, background: familyCssVar(family) }}
    >
      <GameIcon name={familyIconName(family)} size={Math.round(size * 0.64)} />
    </span>
  );
}

export function TopdownGlyph({
  vehicleClass,
  family,
  size = 32,
  title,
  className,
}: {
  vehicleClass: VehicleClass;
  family: ServiceFamily;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
      className={cn('inline-block shrink-0', className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: topdownSvg(vehicleClass, family, size) }}
    />
  );
}
