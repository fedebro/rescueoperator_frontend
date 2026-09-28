import type { Map as MlMap } from 'maplibre-gl';
import {
  FAMILY_COLORS,
  type AnyFamily,
  categoryIconName,
  facilityTypeIconName,
  vehicleClassOf,
  topdownSvg,
} from '@/design/icons';
import { PICTOGRAMS } from '@/design/icons/pictograms';
import * as mark from '@/design/icons/marks';

/**
 * Runtime-added map images. Names encode everything needed to draw them, so any image the style asks for can be
 * generated on demand from `styleimagemissing`:
 *   veh:<FAMILY>:<class|catalog icon key>      top-down vehicle glyph (`veh:FIRE:vehicle-fire-aps`)
 *   fac:<FAMILY>[:<type code|icon key>]        facility marker (rounded square, family colour + the pictogram of the
 *                                              facility TYPE: `fac:FIRE:FIRE_COMMAND` = `fac:FIRE:facility-fire-command`;
 *                                              plain `fac:FIRE` keeps working and draws the family station)
 *   inc:<CATEGORY>[|<icon key>]:<severity>[:<flags>] incident pin (severity ring + number + template/category pictogram;
 *                                              flags: `W` = a water incident: anchor badge on the top-left corner, D-68;
 *                                              `M` = the main scene of a major incident: a thick major-coloured halo and a
 *                                              siren badge on the top-left; `L` = a linked incident of a major: a thin
 *                                              major-coloured halo, D-24)
 *   clu:<key index>:<severity>:<count>         incident cluster (03 §2.7): what is inside — the pictogram of its most
 *                                              severe incident (`clusterPictogramKey`), ringed in that severity's colour,
 *                                              and how many, drawn in the image (no map glyphs needed)
 *   meet                                       meeting point of a water incident on the shore road (people tile)
 *   launch                                     launch point where a boat on its trailer is put into the water
 *   site:<0|1>[:N]                             candidate site pin (N = a nautical site: Base nautica, water blue)
 *   hosp[:helipad]                             hospital marker ("H" tile — never a cross; the variant shows the helipad)
 *   cand:<FAMILY>[:<0|1>]                      candidate building site (dashed family outline; 1 = selected)
 *   closure                                    road closure marker
 *   site:<0|1>                                 onboarding starter-site marker (idle / selected)
 */
const HOSPITAL = '#14A89A';
const CLOSURE = '#F5B63C';
/** Water: badges, meeting points, launch points and nautical sites (the skyline / info blue of the palette). */
const WATER = '#5AA2E6';
const NAVY = '#0A1220';
/** Major incidents (D-24): `--rc-major`. */
const MAJOR = '#FF4F86';
/** Siren glyph (24×24 grid, stroke based) of the major badge. */
const SIREN =
  '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14"/><path d="M12 3v2"/><path d="M4.5 6.5 6 8"/><path d="M19.5 6.5 18 8"/>';
/** Anchor glyph (24×24 grid, stroke based) of the water badge. */
const ANCHOR =
  '<path d="M12 21V8.5"/><path d="M6 12.5H3.5a8.5 8.5 0 0 0 17 0H18"/><circle cx="12" cy="5.5" r="2.5"/>';
const glyph = (inner: string, x: number, y: number, size: number, color: string, strokeWidth = 2.4) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" color="${color}">${inner}</svg>`;
const SEVERITY = [
  '#4CC38A',
  '#7ACB6A',
  '#A9D152',
  '#D8D044',
  '#F5B63C',
  '#F79A35',
  '#F57A35',
  '#F0503A',
  '#E5202A',
  '#D0166E',
];
const picto = (
  name: keyof typeof PICTOGRAMS,
  x: number,
  y: number,
  size: number,
  color = '#FFFFFF',
  strokeWidth = 2,
) =>
  `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" color="${color}">${PICTOGRAMS[name]}</svg>`;

/**
 * Pictogram keys of incident pins (`<CATEGORY>[|<icon key>]`) by a small integer. A cluster can only aggregate numbers
 * (MapLibre `clusterProperties`), so each incident carries `severity × 1000 + index` and the cluster keeps the maximum:
 * the most severe incident inside, whose pictogram the cluster badge shows. Append-only for the page's lifetime.
 */
const clusterKeys: string[] = [];
export function clusterPictogramIndex(key: string): number {
  let index = clusterKeys.indexOf(key);
  if (index < 0) index = clusterKeys.push(key) - 1;
  return index;
}
export const clusterPictogramKey = (index: number): string | undefined => clusterKeys[index];

export function imageSvg(name: string): { svg: string; width: number; height: number } | null {
  const [kind, a, b, c] = name.split(':');
  if (kind === 'clu' && a !== undefined && b && c) {
    const key = clusterPictogramKey(Number(a)) ?? 'OTHER';
    const sev = Math.min(10, Math.max(1, Number(b) || 1));
    const color = SEVERITY[sev - 1]!;
    const count = Math.max(2, Number(c) || 2);
    const label = count > 99 ? '99+' : String(count);
    const [category, icon] = key.split('|');
    return {
      width: 96,
      height: 96,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 48 48"><circle cx="22" cy="26" r="17" fill="#0A1220" stroke="${color}" stroke-width="3.5"/>${picto(categoryIconName(category!, icon), 12, 16, 20, '#FFFFFF', 2)}<rect x="${label.length > 2 ? 26 : 29}" y="1.5" width="${label.length > 2 ? 21 : label.length > 1 ? 18 : 15}" height="15" rx="7.5" fill="#FFFFFF" stroke="#0A1220" stroke-width="2"/><text x="${label.length > 2 ? 36.5 : label.length > 1 ? 38 : 36.5}" y="12.6" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" font-size="10.5" fill="#0A1220">${label}</text></svg>`,
    };
  }
  if (kind === 'veh' && a && b && a in FAMILY_COLORS && a !== 'SHARED') {
    return {
      svg: topdownSvg(vehicleClassOf(b), a as Exclude<AnyFamily, 'SHARED'>, 64),
      width: 64,
      height: 64,
    };
  }
  if (kind === 'hosp') {
    return {
      width: 72,
      height: 72,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 36 36"><rect x="3" y="3" width="30" height="30" rx="8" fill="#0A1220" stroke="${HOSPITAL}" stroke-width="2.5"/><rect x="6.5" y="6.5" width="23" height="23" rx="5" fill="${HOSPITAL}"/>${picto(a === 'helipad' ? 'helipad' : 'hospital', 9, 9, 18, '#0A1220')}</svg>`,
    };
  }
  if (kind === 'cand' && a && a in FAMILY_COLORS) {
    const c = FAMILY_COLORS[a as AnyFamily];
    const selected = b === '1';
    return {
      width: 72,
      height: 72,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 36 36"><rect x="4" y="4" width="28" height="28" rx="8" fill="${selected ? c.primary : '#0A1220'}" fill-opacity="${selected ? 1 : 0.85}" stroke="${selected ? '#FFFFFF' : c.primary}" stroke-width="2.5" stroke-dasharray="${selected ? 'none' : '4 3'}"/>${picto('site_candidate', 9, 9, 18, selected ? '#FFFFFF' : c.primary)}</svg>`,
    };
  }
  if (kind === 'closure') {
    return {
      width: 64,
      height: 64,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#0A1220" stroke="${CLOSURE}" stroke-width="2.5"/>${picto('closure', 8, 7.5, 16, CLOSURE)}</svg>`,
    };
  }
  if (kind === 'fac' && a && a in FAMILY_COLORS) {
    const c = FAMILY_COLORS[a as AnyFamily];
    return {
      width: 72,
      height: 72,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 36 36"><rect x="3" y="3" width="30" height="30" rx="8" fill="#0A1220" stroke="${c.primary}" stroke-width="2.5"/><rect x="6.5" y="6.5" width="23" height="23" rx="5" fill="${c.primary}"/>${picto(facilityTypeIconName(a as AnyFamily, b), 9, 9, 18)}</svg>`,
    };
  }
  if (kind === 'inc' && a && b) {
    const sev = Math.min(10, Math.max(1, Number(b) || 1));
    const color = SEVERITY[sev - 1]!;
    const flags = c ?? '';
    const main = flags.includes('M');
    const linked = flags.includes('L');
    // Water incident (D-68): an anchor badge on the top-left corner, mirroring the severity bubble on the right.
    const water = flags.includes('W')
      ? `<circle cx="9" cy="9" r="8" fill="${WATER}" stroke="${NAVY}" stroke-width="2"/>${glyph(ANCHOR, 3, 3, 12, NAVY, 2.6)}`
      : '';
    // A major's main scene (D-24): the siren badge takes the top-left corner (a main scene is always on land).
    const siren = main
      ? `<circle cx="9" cy="9" r="8" fill="${MAJOR}" stroke="${NAVY}" stroke-width="2"/>${glyph(SIREN, 3, 2.6, 12, NAVY, 2.6)}`
      : '';
    // Its halo: thick on the main scene, thin on a linked incident — the event reads as one thing on the map.
    const halo =
      main || linked
        ? `<path d="M22 50 L13 36 A17 17 0 1 1 31 36 Z" fill="none" stroke="${MAJOR}" stroke-width="${main ? 7 : 5}" stroke-linejoin="round" stroke-opacity="${main ? 0.95 : 0.75}"/>`
        : '';
    return {
      width: 88,
      height: 104,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="104" viewBox="0 0 44 52">${halo}<path d="M22 50 L13 36 A17 17 0 1 1 31 36 Z" fill="#0A1220" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>${picto(categoryIconName(a.split('|')[0]!, a.split('|')[1]), 12, 11, 20, '#FFFFFF', 2)}<circle cx="35" cy="9" r="8" fill="${color}" stroke="#0A1220" stroke-width="2"/><text x="35" y="12.6" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" font-size="${sev === 10 ? 9 : 10.5}" fill="#0A1220">${sev}</text>${water}${siren}</svg>`,
    };
  }
  if (kind === 'meet') {
    // Meeting point on the shore road (punto di raccolta): where land units stop and the boat lands the rescued.
    return {
      width: 56,
      height: 56,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 28 28"><rect x="2.5" y="2.5" width="23" height="23" rx="6" fill="${NAVY}" stroke="${WATER}" stroke-width="2.5"/>${glyph(mark.people(12, 12.6, 2.1), 4, 4, 20, '#FFFFFF', 2)}</svg>`,
    };
  }
  if (kind === 'launch') {
    // Launch point (slipway, harbour, bank): where the trailer puts the boat into the water.
    return {
      width: 48,
      height: 48,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${NAVY}" stroke="${WATER}" stroke-width="2"/>${glyph(ANCHOR, 5.5, 5.5, 13, WATER, 2.6)}</svg>`,
    };
  }
  if (kind === 'site') {
    const selected = a === '1';
    // A nautical site (where a Base nautica can be bought) is drawn in water blue with the Base nautica pictogram.
    const nautical = b === 'N';
    const idle = nautical ? '#0F2A44' : '#16233A';
    return {
      width: 80,
      height: 96,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="96" viewBox="0 0 40 48"><path d="M20 46 L11 32 A15 15 0 1 1 29 32 Z" fill="${selected ? '#E5202A' : idle}" stroke="${selected ? '#FFFFFF' : WATER}" stroke-width="${nautical && !selected ? 3 : 2.5}" stroke-linejoin="round"/>${picto(nautical ? 'facility_nautical_base' : 'facility_fire', 11, 10, 18)}</svg>`,
    };
  }
  return null;
}

function loadImage(svg: string, width: number, height: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(width, height);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Installs the on-demand image generator. A 1×1 transparent placeholder is registered synchronously, then replaced. */
export function installImageGenerator(map: MlMap): void {
  const pending = new Set<string>();
  map.on('styleimagemissing', (e: { id: string }) => {
    const name = e.id;
    if (pending.has(name) || map.hasImage(name)) return;
    const spec = imageSvg(name);
    if (!spec) return;
    pending.add(name);
    map.addImage(name, { width: 1, height: 1, data: new Uint8Array(4) });
    void loadImage(spec.svg, spec.width, spec.height)
      .then((img) => {
        if (map.hasImage(name)) map.removeImage(name);
        map.addImage(name, img, { pixelRatio: 2 });
      })
      .catch(() => undefined)
      .finally(() => pending.delete(name));
  });
}
