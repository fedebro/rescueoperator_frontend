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

/**
 * Runtime-added map images. Names encode everything needed to draw them, so any image the style asks for can be
 * generated on demand from `styleimagemissing`:
 *   veh:<FAMILY>:<class|catalog icon key>      top-down vehicle glyph (`veh:FIRE:vehicle-fire-aps`)
 *   fac:<FAMILY>[:<type code|icon key>]        facility marker (rounded square, family colour + the pictogram of the
 *                                              facility TYPE: `fac:FIRE:FIRE_COMMAND` = `fac:FIRE:facility-fire-command`;
 *                                              plain `fac:FIRE` keeps working and draws the family station)
 *   inc:<CATEGORY>[|<icon key>]:<severity>     incident pin (severity ring + number + template/category pictogram)
 *   hosp[:helipad]                             hospital marker ("H" tile — never a cross; the variant shows the helipad)
 *   cand:<FAMILY>[:<0|1>]                      candidate building site (dashed family outline; 1 = selected)
 *   closure                                    road closure marker
 *   site:<0|1>                                 onboarding starter-site marker (idle / selected)
 */
const HOSPITAL = '#14A89A';
const CLOSURE = '#F5B63C';
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

export function imageSvg(name: string): { svg: string; width: number; height: number } | null {
  const [kind, a, b] = name.split(':');
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
    return {
      width: 88,
      height: 104,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="104" viewBox="0 0 44 52"><path d="M22 50 L13 36 A17 17 0 1 1 31 36 Z" fill="#0A1220" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>${picto(categoryIconName(a.split('|')[0]!, a.split('|')[1]), 12, 11, 20, '#FFFFFF', 2)}<circle cx="35" cy="9" r="8" fill="${color}" stroke="#0A1220" stroke-width="2"/><text x="35" y="12.6" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" font-size="${sev === 10 ? 9 : 10.5}" fill="#0A1220">${sev}</text></svg>`,
    };
  }
  if (kind === 'site') {
    const selected = a === '1';
    return {
      width: 80,
      height: 96,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="96" viewBox="0 0 40 48"><path d="M20 46 L11 32 A15 15 0 1 1 29 32 Z" fill="${selected ? '#E5202A' : '#16233A'}" stroke="${selected ? '#FFFFFF' : '#5AA2E6'}" stroke-width="2.5" stroke-linejoin="round"/>${picto('facility_fire', 11, 10, 18)}</svg>`,
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
