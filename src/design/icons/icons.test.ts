import { describe, expect, it } from 'vitest';
import catalog from '@/mocks/data/generated/catalog.json';
import {
  CATALOG_ICONS,
  PICTOGRAM_NAMES,
  VEHICLE_CLASSES,
  capabilityIconName,
  catalogIconName,
  categoryIconName,
  facilityTypeIconName,
  familyIconName,
  hasCatalogIcon,
  isPictogram,
  pictogramSvg,
  topdownSvg,
  vehicleClassOf,
  vehicleIconName,
} from './index';
import type { AnyFamily } from './index';
import { PICTOGRAMS } from './pictograms';
import { TOPDOWN } from './topdown';
import { scaleRelativePath } from './marks';
import { iconGallery } from './gallery';

interface WithIcon {
  code: string;
  icon: string;
}
const groups: Record<string, readonly WithIcon[]> = {
  families: catalog.families,
  capabilities: catalog.capabilities,
  vehicleTypes: catalog.vehicleTypes,
  facilityTypes: catalog.facilityTypes,
  upgrades: catalog.upgrades,
  ungUnitTypes: catalog.ungUnitTypes,
  itemTypes: catalog.itemTypes,
  roles: catalog.roles,
  qualifications: catalog.qualifications,
  hospitalCapabilities: catalog.hospitalCapabilities,
  incidentTemplates: catalog.incidentTemplates,
};
const allKeys = Object.values(groups).flatMap((list) => list.map((e) => e.icon));

// ───────────────────────────── a tiny SVG reader for the restricted markup of the set ─────────────────────────────
const ELEMENTS = new Set(['path', 'circle', 'ellipse', 'rect', 'polyline', 'g']);
const ATTRIBUTES = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'width',
  'height',
  'points',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
]);
interface Tag {
  name: string;
  attrs: Record<string, string>;
}

/** Parses the markup, asserting balanced tags and nothing but elements (no text, comments, entities). */
function parse(markup: string): Tag[] {
  const tags: Tag[] = [];
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"<>]*")*)\s*(\/?)>/g;
  let last = 0;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    expect(markup.slice(last, m.index)).toBe('');
    last = m.index + m[0].length;
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (closing) {
      expect(stack.pop()).toBe(name);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    tags.push({ name: name!, attrs });
    if (!selfClosing) stack.push(name!);
  }
  expect(markup.slice(last)).toBe('');
  expect(stack).toEqual([]);
  return tags;
}

const NUMBERS = /-?\d*\.?\d+/g;
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** End points of every path segment (curve control points are ignored: the check is deliberately loose). */
function pathPoints(d: string): [number, number][] {
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const seg of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const cmd = seg[1]!;
    const lower = cmd.toLowerCase();
    const relative = cmd === lower;
    const arity = ARITY[lower];
    expect(arity, `unknown path command "${cmd}" in ${d}`).toBeDefined();
    const values = (seg[2]!.match(NUMBERS) ?? []).map(Number);
    if (arity === 0) {
      expect(values).toEqual([]);
      x = startX;
      y = startY;
      continue;
    }
    expect(values.length % arity!, `bad arity for "${cmd}" in ${d}`).toBe(0);
    expect(values.length).toBeGreaterThan(0);
    for (let i = 0; i < values.length; i += arity!) {
      const chunk = values.slice(i, i + arity!);
      if (lower === 'h') x = relative ? x + chunk[0]! : chunk[0]!;
      else if (lower === 'v') y = relative ? y + chunk[0]! : chunk[0]!;
      else {
        const nx = chunk[arity! - 2]!;
        const ny = chunk[arity! - 1]!;
        x = relative ? x + nx : nx;
        y = relative ? y + ny : ny;
      }
      if (lower === 'm' && i === 0) {
        startX = x;
        startY = y;
      }
      points.push([x, y]);
    }
  }
  return points;
}

function extent(tags: Tag[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  const n = (v: string | undefined) => Number(v ?? 0);
  for (const { name, attrs } of tags) {
    if (name === 'path')
      for (const [x, y] of pathPoints(attrs.d ?? '')) {
        xs.push(x);
        ys.push(y);
      }
    if (name === 'circle' || name === 'ellipse') {
      const rx = n(attrs.rx ?? attrs.r);
      const ry = n(attrs.ry ?? attrs.r);
      xs.push(n(attrs.cx) - rx, n(attrs.cx) + rx);
      ys.push(n(attrs.cy) - ry, n(attrs.cy) + ry);
    }
    if (name === 'rect') {
      xs.push(n(attrs.x), n(attrs.x) + n(attrs.width));
      ys.push(n(attrs.y), n(attrs.y) + n(attrs.height));
    }
    if (name === 'polyline') {
      const values = (attrs.points ?? '').match(NUMBERS)!.map(Number);
      values.forEach((v, i) => (i % 2 === 0 ? xs : ys).push(v));
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function expectWellFormed(markup: string, box: number, allowedColors: RegExp): void {
  expect(markup).not.toMatch(/href|url\(|<image|<use|<script|<style|<text|<foreignObject|data:|https?:/i);
  // No white-filled shapes at all in the sources: a white tile + cross can never be drawn by accident.
  expect(markup).not.toMatch(/fill="(white|#fff|#ffffff)"/i);
  const tags = parse(markup);
  expect(tags.length).toBeGreaterThan(0);
  for (const { name, attrs } of tags) {
    expect(ELEMENTS.has(name), `element <${name}>`).toBe(true);
    for (const [attr, value] of Object.entries(attrs)) {
      expect(ATTRIBUTES.has(attr), `attribute ${attr} on <${name}>`).toBe(true);
      if (attr === 'fill' || attr === 'stroke') expect(value).toMatch(allowedColors);
      else if (attr !== 'd' && attr !== 'points' && attr !== 'stroke-linecap' && attr !== 'stroke-linejoin')
        expect(Number.isFinite(Number(value)), `${attr}="${value}"`).toBe(true);
    }
    if (name === 'g') expect(Object.keys(attrs)).toEqual(['stroke-width']);
  }
  const e = extent(tags);
  // Loose: stroke caps may graze the edge, nothing may be drawn outside the viewBox.
  expect(e.minX).toBeGreaterThanOrEqual(-0.5);
  expect(e.minY).toBeGreaterThanOrEqual(-0.5);
  expect(e.maxX).toBeLessThanOrEqual(box + 0.5);
  expect(e.maxY).toBeLessThanOrEqual(box + 0.5);
  // …and a glyph must use its canvas (catches marks scaled to nothing or collapsed coordinates).
  expect(Math.max(e.maxX - e.minX, e.maxY - e.minY)).toBeGreaterThan(box * 0.5);
  expect(Math.min(e.maxX - e.minX, e.maxY - e.minY)).toBeGreaterThan(box * 0.25);
}

describe('pictograms', () => {
  it('keeps the name registry and the markup record in sync', () => {
    expect(new Set(PICTOGRAM_NAMES).size).toBe(PICTOGRAM_NAMES.length);
    expect(Object.keys(PICTOGRAMS).sort()).toEqual([...PICTOGRAM_NAMES].sort());
    for (const cls of VEHICLE_CLASSES) expect(isPictogram(`veh_${cls}`)).toBe(true);
  });

  it.each(PICTOGRAM_NAMES.map((n) => [n] as const))('%s is well-formed 24×24 markup', (name) => {
    expectWellFormed(PICTOGRAMS[name], 24, /^(none|currentColor)$/);
  });

  it('draws every glyph differently', () => {
    const seen = new Map<string, string>();
    for (const name of PICTOGRAM_NAMES) {
      expect(seen.get(PICTOGRAMS[name]), `${name} duplicates another glyph`).toBeUndefined();
      seen.set(PICTOGRAMS[name], name);
    }
  });

  it('renders a standalone SVG document', () => {
    const svg = pictogramSvg('veh_fire_heli', { color: '#E8EDF5', size: 40 });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 24 24" width="40"/);
    expect(svg).toContain(PICTOGRAMS.veh_fire_heli);
  });
});

describe('top-down glyphs', () => {
  it('has one glyph per vehicle class', () => {
    expect(Object.keys(TOPDOWN).sort()).toEqual([...VEHICLE_CLASSES].sort());
  });

  it.each(VEHICLE_CLASSES.map((c) => [c] as const))('%s is well-formed 32×32 markup', (cls) => {
    expectWellFormed(TOPDOWN[cls], 32, /^(none|\{primary\}|\{dark\}|\{light\}|\{outline\})$/);
    expect(TOPDOWN[cls]).toContain('{primary}');
    const svg = topdownSvg(cls, 'FIRE');
    expect(svg).not.toMatch(/[{}]/);
  });
});

describe('marks', () => {
  it('scales relative paths but never the arc flags', () => {
    expect(scaleRelativePath('m1 2a1.5 1.5 0 0 1-3 0l.5-.5z', 2)).toBe('m2 4a3 3 0 0 1 -6 0l1 -1z');
    expect(() => scaleRelativePath('M1 2', 2)).toThrow();
  });
});

describe('catalog mapping', () => {
  it('reads every icon key group of the bundled catalog', () => {
    expect(catalog.vehicleTypes).toHaveLength(45);
    expect(catalog.facilityTypes).toHaveLength(21);
    expect(catalog.incidentTemplates).toHaveLength(143);
    for (const [group, list] of Object.entries(groups)) {
      expect(list.length, group).toBeGreaterThan(0);
      for (const entry of list)
        expect(entry.icon, `${group}.${entry.code}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
    }
  });

  it.each(allKeys.map((k) => [k] as const))('%s has its own explicit icon', (key) => {
    expect(hasCatalogIcon(key)).toBe(true);
    expect(isPictogram(catalogIconName(key))).toBe(true);
    expect(catalogIconName(key)).toBe(CATALOG_ICONS[key]);
  });

  it('never maps a key to a generic fallback glyph', () => {
    const generic = [
      'cat_generic',
      'item_generic',
      'upgrade_generic',
      'role_generic',
      'qualification',
      'course',
    ];
    for (const key of allKeys) expect(generic, key).not.toContain(catalogIconName(key));
  });

  it('points only at existing pictograms and has no stale keys', () => {
    for (const [key, name] of Object.entries(CATALOG_ICONS)) {
      expect(isPictogram(name), key).toBe(true);
      expect(allKeys, `stale mapping ${key}`).toContain(key);
    }
  });

  it.each([
    ['vehicleTypes', 45],
    ['facilityTypes', 21],
    ['incidentTemplates', 143],
    ['ungUnitTypes', 12],
    ['roles', 12],
    ['itemTypes', 7],
    ['capabilities', 23],
  ] as const)('gives every entry of %s a DIFFERENT glyph', (group, count) => {
    const names = new Set(groups[group]!.map((e) => catalogIconName(e.icon)));
    expect(names.size).toBe(count);
  });

  it('gives every vehicle type and UNG unit a top-down class', () => {
    for (const v of [...catalog.vehicleTypes, ...catalog.ungUnitTypes]) {
      const cls = vehicleClassOf(v.icon);
      expect(VEHICLE_CLASSES, v.icon).toContain(cls);
      expect(TOPDOWN[cls]).toBeTruthy();
      expect(vehicleIconName(v.icon)).toBe(catalogIconName(v.icon));
    }
    // A box truck is the FALLBACK class: only types that really are box trucks may use it.
    const trucks = catalog.vehicleTypes.filter((v) => vehicleClassOf(v.icon) === 'truck').map((v) => v.code);
    expect(trucks.sort()).toEqual(['FIRE_AIR', 'FIRE_USAR', 'POL_EOD']);
  });

  it('keeps the legacy inputs and the fallbacks for unknown future keys', () => {
    expect(vehicleClassOf('ladder')).toBe('ladder');
    expect(vehicleIconName('ladder')).toBe('veh_ladder');
    expect(vehicleIconName(undefined)).toBe('veh_truck');
    expect(vehicleClassOf('vehicle-fire-future')).toBe('truck');
    expect(catalogIconName('vehicle-fire-future')).toBe('veh_truck');
    expect(catalogIconName('ung-future')).toBe('veh_utility');
    expect(vehicleClassOf('ung-future')).toBe('utility');
    expect(catalogIconName('incident-future')).toBe('cat_generic');
    expect(catalogIconName('capability-future')).toBe('cap_logistics');
    expect(catalogIconName('facility-police-future')).toBe('facility_police');
    expect(catalogIconName('facility-aib-future')).toBe('facility_wildfire');
    expect(catalogIconName('facility-coordination-future')).toBe('facility_coordination');
    expect(catalogIconName('family-future')).toBe('family_ung');
    expect(catalogIconName('hospital-future')).toBe('hospital');
    expect(catalogIconName('item-future')).toBe('item_generic');
    expect(catalogIconName('upgrade-future')).toBe('upgrade_generic');
    expect(catalogIconName('role-future')).toBe('role_generic');
    expect(catalogIconName('qualification-future')).toBe('qualification');
    expect(catalogIconName('course-future')).toBe('course');
    expect(catalogIconName(null)).toBe('cat_generic');
  });

  it('resolves incidents by template key first, then by category', () => {
    for (const t of catalog.incidentTemplates)
      expect(categoryIconName(t.category, t.icon)).toBe(catalogIconName(t.icon));
    for (const category of new Set(catalog.incidentTemplates.map((t) => t.category)))
      expect(categoryIconName(category), category).not.toBe('cat_generic');
    expect(categoryIconName('fire_vehicle')).toBe('cat_fire_vehicle');
    expect(categoryIconName('whatever')).toBe('cat_generic');
  });

  it('resolves capabilities, families and facility types from codes', () => {
    for (const c of catalog.capabilities) expect(capabilityIconName(c.code)).toBe(catalogIconName(c.icon));
    expect(familyIconName('EMS')).toBe('family_ems');
    expect(familyIconName('SHARED')).toBe('facility_coordination');
    for (const f of catalog.facilityTypes) {
      const family = f.family as AnyFamily;
      expect(facilityTypeIconName(family, f.code)).toBe(catalogIconName(f.icon));
      expect(facilityTypeIconName(family, f.icon)).toBe(catalogIconName(f.icon));
    }
    expect(facilityTypeIconName('FIRE')).toBe('facility_fire');
    expect(facilityTypeIconName('FIRE', 'FIRE_FUTURE_TYPE')).toBe('facility_fire');
  });
});

describe('style guide gallery', () => {
  it('shows every pictogram and every catalog key, grouped', () => {
    const groups = iconGallery();
    const entries = groups.flatMap((g) => g.entries);
    expect(new Set(entries.map((e) => e.name))).toEqual(new Set(PICTOGRAM_NAMES));
    expect(entries.map((e) => e.id)).toEqual(expect.arrayContaining(allKeys));
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    const fire = groups.find((g) => g.id === 'vehicle-fire-*')!;
    expect(fire.entries).toHaveLength(15);
    expect(fire.entries.every((e) => e.topdown?.family === 'FIRE')).toBe(true);
  });
});
