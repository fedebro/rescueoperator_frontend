import type { Map as MlMap } from 'maplibre-gl';
import {
  FAMILY_COLORS,
  type AnyFamily,
  categoryIconName,
  facilityIconName,
  isVehicleClass,
  topdownSvg,
} from '@/design/icons';
import { PICTOGRAMS } from '@/design/icons/pictograms';

/**
 * Runtime-added map images. Names encode everything needed to draw them, so any image the style asks for can be
 * generated on demand from `styleimagemissing`:
 *   veh:<FAMILY>:<class>      top-down vehicle glyph
 *   fac:<FAMILY>              facility marker (rounded square, family colour + pictogram)
 *   inc:<category>:<severity> incident pin (severity ring + number + category pictogram)
 *   site:<0|1>                onboarding starter-site marker (idle / selected)
 */
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
      svg: topdownSvg(isVehicleClass(b) ? b : 'truck', a as Exclude<AnyFamily, 'SHARED'>, 64),
      width: 64,
      height: 64,
    };
  }
  if (kind === 'fac' && a && a in FAMILY_COLORS) {
    const c = FAMILY_COLORS[a as AnyFamily];
    return {
      width: 72,
      height: 72,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 36 36"><rect x="3" y="3" width="30" height="30" rx="8" fill="#0A1220" stroke="${c.primary}" stroke-width="2.5"/><rect x="6.5" y="6.5" width="23" height="23" rx="5" fill="${c.primary}"/>${picto(facilityIconName(a as AnyFamily), 9, 9, 18)}</svg>`,
    };
  }
  if (kind === 'inc' && a && b) {
    const sev = Math.min(10, Math.max(1, Number(b) || 1));
    const color = SEVERITY[sev - 1]!;
    return {
      width: 88,
      height: 104,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="104" viewBox="0 0 44 52"><path d="M22 50 L13 36 A17 17 0 1 1 31 36 Z" fill="#0A1220" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>${picto(categoryIconName(a), 12, 11, 20, '#FFFFFF', 2)}<circle cx="35" cy="9" r="8" fill="${color}" stroke="#0A1220" stroke-width="2"/><text x="35" y="12.6" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" font-size="${sev === 10 ? 9 : 10.5}" fill="#0A1220">${sev}</text></svg>`,
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
