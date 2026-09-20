/**
 * Generates every brand asset and the game icon set from code (single source of truth):
 *   public/brand/*.svg, favicon, PWA icons, OG image, public/icons/** (pictograms + top-down glyphs).
 * The wordmark is converted to outlines from Exo 2 Black Italic (OFL) so the SVGs carry no font dependency.
 * Run: pnpm gen:assets
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import {
  CATALOG_ICONS,
  FAMILY_COLORS,
  PICTOGRAM_NAMES,
  VEHICLE_CLASSES,
  pictogramSvg,
  topdownSvg,
  vehicleClassOf,
} from '../src/design/icons/index';
import type { ServiceFamily } from '../src/contracts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p: string) => {
  const full = resolve(root, 'public', p);
  mkdirSync(dirname(full), { recursive: true });
  return full;
};
const write = (p: string, content: string | Buffer) => writeFileSync(out(p), content);

const NAVY = '#0A1220',
  NAVY_2 = '#0F1A2C',
  RED = '#E5202A',
  RED_DARK = '#B3121B',
  SILVER = '#E8EDF5',
  SILVER_2 = '#A9B6C8',
  SKY = '#5AA2E6',
  SKY_DARK = '#1E4F86';

const fontBuf = readFileSync(
  resolve(root, 'node_modules/@fontsource/exo-2/files/exo-2-latin-900-italic.woff'),
);
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength) as ArrayBuffer,
);
const textPath = (text: string, x: number, y: number, size: number, letterSpacing = 0) => {
  const path = font.getPath(text, x, y, size, { letterSpacing: letterSpacing / size } as never);
  return {
    d: path.toPathData(2),
    width: font.getAdvanceWidth(text, size) + letterSpacing * (text.length - 1),
  };
};

const defs = `
  <defs>
    <linearGradient id="silver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="${SILVER}"/><stop offset="1" stop-color="${SILVER_2}"/></linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF4A52"/><stop offset="0.5" stop-color="${RED}"/><stop offset="1" stop-color="${RED_DARK}"/></linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8CC4F5"/><stop offset="1" stop-color="${SKY_DARK}"/></linearGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${SKY}"/><stop offset="0.5" stop-color="#FFFFFF"/><stop offset="1" stop-color="${SKY}"/></linearGradient>
    <radialGradient id="bg" cx="0.5" cy="0.35" r="0.9"><stop offset="0" stop-color="#14233B"/><stop offset="1" stop-color="${NAVY}"/></radialGradient>
  </defs>`;

/**
 * The emblem, drawn in a 200×120 box: a dome arc open at the top, a generic skyline, a lattice radio tower with
 * waves in the gap. Re-drawn from scratch in the spirit of logo.png (no real landmark is reproduced).
 */
function emblem(mono?: string): string {
  const sky = mono ?? 'url(#sky)',
    arc = mono ?? 'url(#arc)',
    light = mono ?? '#DCEBFF';
  const buildings: [number, number, number][] = [
    // x, width, height (baseline y=104)
    [22, 10, 14],
    [33, 12, 26],
    [46, 9, 38],
    [56, 13, 30],
    [70, 10, 46],
    [81, 9, 24],
    [111, 9, 22],
    [121, 11, 40],
    [133, 12, 52],
    [146, 10, 32],
    [157, 12, 20],
    [170, 9, 12],
  ];
  const skyline = buildings
    .map(([x, w, h]) => `<rect x="${x}" y="${104 - h}" width="${w}" height="${h}" rx="0.8"/>`)
    .join('');
  const mountain = `<path d="M30 104 L58 60 L66 70 L74 58 L96 104 Z" opacity="0.45"/>`;
  const dome = `<path d="M133 52 a6 6 0 0 1 12 0 Z"/><rect x="138" y="42" width="2" height="6"/>`;
  const tower = `<path d="M100 40 L92 104 M100 40 L108 104 M94.2 86 L105.8 86 M95.6 74 L104.4 74 M97 62 L103 62 M92 104 L105.8 86 M108 104 L94.2 86 M94.2 86 L104.4 74 M105.8 86 L95.6 74 M95.6 74 L103 62 M104.4 74 L97 62" stroke="${light}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="36" r="3.2" fill="${light}"/>`;
  const waves = [9, 16, 23]
    .map(
      (r, i) =>
        `<path d="M${100 - r * 0.78} ${36 - r * 0.62} A${r} ${r} 0 0 0 ${100 - r * 0.78} ${36 + r * 0.62} M${100 + r * 0.78} ${36 - r * 0.62} A${r} ${r} 0 0 1 ${100 + r * 0.78} ${36 + r * 0.62}" stroke="${light}" stroke-width="2" fill="none" stroke-linecap="round" opacity="${1 - i * 0.22}"/>`,
    )
    .join('');
  const arcPath = `<path d="M8 106 A92 92 0 0 1 72 22" stroke="${arc}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M128 22 A92 92 0 0 1 192 106" stroke="${arc}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  return `<g>${arcPath}<g fill="${sky}">${mountain}${skyline}${dome}</g>${tower}${waves}</g>`;
}

/** Five slanted family tiles, as in the logo's bottom strip (generic pictograms, no official emblems). */
function familyStrip(x: number, y: number, w: number, h: number): string {
  const families: ServiceFamily[] = ['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE'];
  const tile = w / families.length,
    skew = h * 0.35;
  return families
    .map((f, i) => {
      const x0 = x + i * tile;
      const icon = pictogramSvg(`family_${f.toLowerCase()}` as never, {
        color: '#FFFFFF',
        size: h * 0.62,
        strokeWidth: 2,
      }).replace('<svg ', `<svg x="${x0 + tile / 2 - h * 0.31 + skew / 2}" y="${y + h * 0.19}" `);
      return `<path d="M${x0 + skew} ${y} H${x0 + tile + skew - 3} L${x0 + tile - 3} ${y + h} H${x0} Z" fill="${FAMILY_COLORS[f].primary}"/>${icon}`;
    })
    .join('');
}

function wordmark(
  x: number,
  yRescue: number,
  size: number,
  align: 'left' | 'center',
  mono?: string,
): { svg: string; width: number } {
  const rescue = textPath('RESCUE', 0, 0, size, size * 0.01);
  const control = textPath('CONTROL', 0, 0, size, size * 0.01);
  const width = Math.max(rescue.width, control.width);
  const ox = (w: number) => (align === 'center' ? x - w / 2 : x);
  const r = textPath('RESCUE', ox(rescue.width), yRescue, size, size * 0.01);
  const c = textPath('CONTROL', ox(control.width), yRescue + size * 0.86, size, size * 0.01);
  return {
    width,
    svg: `<path d="${r.d}" fill="${mono ?? 'url(#silver)'}"/><path d="${c.d}" fill="${mono ?? 'url(#red)'}"/>`,
  };
}

// ── logo variants ─────────────────────────────────────────────────────────────
const iconMark = (
  size: number,
  rounded = true,
) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" role="img" aria-label="Rescue Control">${defs}
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <g transform="translate(31 56) scale(2.25)">${emblem()}</g>
  <path d="M112 344 H424 L400 408 H88 Z" fill="url(#red)"/>
  <path d="M136 432 H376" stroke="${SILVER_2}" stroke-width="10" stroke-linecap="round" opacity="0.6"/>
</svg>`;

const horizontal = (mono?: string) => {
  const wm = wordmark(150, 52, 50, 'left', mono);
  const tag = textPath('EMERGENCY MANAGEMENT SIMULATOR', 152, 116, 9.5, 2.6);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(150 + wm.width + 12)} 128" role="img" aria-label="Rescue Control">${mono ? '' : defs}
  <g transform="translate(0 6) scale(0.7)">${emblem(mono)}</g>${wm.svg}<path d="${tag.d}" fill="${mono ?? SILVER_2}"/></svg>`;
};

const stacked = () => {
  const wm = wordmark(300, 250, 92, 'center');
  const tag = textPath('EMERGENCY MANAGEMENT SIMULATOR', 0, 0, 17, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 470" role="img" aria-label="Rescue Control">${defs}
  <g transform="translate(130 10) scale(1.7)">${emblem()}</g>${wm.svg}
  <path transform="translate(${300 - tag.width / 2} 372)" d="${tag.d}" fill="${SILVER_2}"/>${familyStrip(150, 400, 300, 44)}</svg>`;
};

const og = () => {
  const inner = stacked()
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="${NAVY}"/>
  <rect width="1200" height="630" fill="url(#bg)"/><g transform="translate(240 40) scale(1.2)">${inner}</g>
  <rect x="0" y="622" width="1200" height="8" fill="${RED}"/></svg>`;
};

async function main() {
  write('brand/logo-icon.svg', iconMark(512));
  write('brand/logo-horizontal.svg', horizontal());
  write('brand/logo-horizontal-mono.svg', horizontal('#E8EDF5'));
  write('brand/logo-stacked.svg', stacked());
  write('favicon.svg', iconMark(64));
  const iconPng = (size: number, rounded = true) =>
    sharp(Buffer.from(iconMark(size, rounded)), { density: 300 })
      .resize(size, size)
      .png()
      .toBuffer();
  write('icons/app/icon-192.png', await iconPng(192));
  write('icons/app/icon-512.png', await iconPng(512));
  write('icons/app/icon-maskable-512.png', await iconPng(512, false));
  write('apple-touch-icon.png', await iconPng(180, false));
  write('favicon-32.png', await iconPng(32));
  write('og-image.png', await sharp(Buffer.from(og()), { density: 144 }).resize(1200, 630).png().toBuffer());

  for (const name of PICTOGRAM_NAMES)
    write(`icons/pictograms/${name}.svg`, pictogramSvg(name, { color: '#E8EDF5' }));
  for (const family of Object.keys(FAMILY_COLORS) as ServiceFamily[])
    for (const cls of VEHICLE_CLASSES)
      write(`icons/topdown/${family.toLowerCase()}_${cls}.svg`, topdownSvg(cls, family));
  write(
    'icons/manifest.json',
    JSON.stringify(
      {
        pictograms: PICTOGRAM_NAMES,
        topdown: { classes: VEHICLE_CLASSES, families: Object.keys(FAMILY_COLORS) },
        // catalog `icon` key → pictogram file (+ top-down class for vehicles and UNG units)
        catalog: Object.fromEntries(
          Object.entries(CATALOG_ICONS).map(([key, pictogram]) => [
            key,
            key.startsWith('vehicle-') || key.startsWith('ung-')
              ? { pictogram, topdown: vehicleClassOf(key) }
              : { pictogram },
          ]),
        ),
      },
      null,
      2,
    ),
  );

  // contact sheet for visual QA (not shipped)
  const cell = 72,
    cols = 12;
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${Math.ceil((PICTOGRAM_NAMES.length + VEHICLE_CLASSES.length) / cols) * cell}"><rect width="100%" height="100%" fill="${NAVY_2}"/>${[
    ...PICTOGRAM_NAMES.map((n) => pictogramSvg(n, { color: '#E8EDF5', size: 40 })),
    ...VEHICLE_CLASSES.map((c, i) =>
      topdownSvg(c, (Object.keys(FAMILY_COLORS) as ServiceFamily[])[i % 5]!, 48),
    ),
  ]
    .map((svg, i) =>
      svg.replace('<svg ', `<svg x="${(i % cols) * cell + 14}" y="${Math.floor(i / cols) * cell + 14}" `),
    )
    .join('')}</svg>`;
  mkdirSync(resolve(root, '.cache'), { recursive: true });
  await sharp(Buffer.from(sheet)).png().toFile(resolve(root, '.cache/icon-contact-sheet.png'));
  console.log('assets generated');
}
void main();
