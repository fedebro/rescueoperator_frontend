/*
 * Role marks: tiny glyphs (nominal box ±3.8 around their centre) that are composed INTO a base pictogram — the box of a
 * truck, the side of a van, the corner next to a helicopter, a medal, a hospital tile, a station house.
 * They are written as all-relative SVG paths so they can be placed and scaled numerically WITHOUT a `transform`
 * (a transform would also scale the stroke, and the set must keep one stroke weight at every size).
 */

const num = (v: number): string => String(Math.round(v * 100) / 100);

/** Scales an all-relative path (`m… l… a…`) by `s`; arc rotation/flags are left untouched. */
export function scaleRelativePath(d: string, s: number): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
  let out = '';
  let command = '';
  let index = 0;
  for (const token of tokens) {
    if (/[a-zA-Z]/.test(token)) {
      if (token !== token.toLowerCase()) throw new Error(`mark paths must be relative: ${d}`);
      command = token;
      index = 0;
      out += token;
      continue;
    }
    const position = index % 7;
    const unscaled = command === 'a' && position >= 2 && position <= 4;
    out += `${index > 0 ? ' ' : ''}${num(Number(token) * (unscaled ? 1 : s))}`;
    index += 1;
  }
  return out;
}

/** A mark drawn around (cx, cy) at scale `s` (1 = the nominal ±3.8 box). Returns SVG markup. */
export type Mark = (cx: number, cy: number, s?: number) => string;

const line =
  (d: string): Mark =>
  (cx, cy, s = 1) =>
    `<path d="M${num(cx)} ${num(cy)}${scaleRelativePath(d, s)}"/>`;
const solid =
  (d: string): Mark =>
  (cx, cy, s = 1) =>
    `<path d="M${num(cx)} ${num(cy)}${scaleRelativePath(d, s)}" fill="currentColor" stroke-width="0.5"/>`;
const ring =
  (dx: number, dy: number, r: number): Mark =>
  (cx, cy, s = 1) =>
    `<circle cx="${num(cx + dx * s)}" cy="${num(cy + dy * s)}" r="${num(r * s)}"/>`;
const oval =
  (dx: number, dy: number, rx: number, ry: number): Mark =>
  (cx, cy, s = 1) =>
    `<ellipse cx="${num(cx + dx * s)}" cy="${num(cy + dy * s)}" rx="${num(rx * s)}" ry="${num(ry * s)}"/>`;
const dot =
  (dx: number, dy: number, r: number): Mark =>
  (cx, cy, s = 1) =>
    `<circle cx="${num(cx + dx * s)}" cy="${num(cy + dy * s)}" r="${num(r * s)}" fill="currentColor" stroke="none"/>`;
const all =
  (...marks: Mark[]): Mark =>
  (cx, cy, s = 1) =>
    marks.map((m) => m(cx, cy, s)).join('');
/** The same mark shifted by (dx, dy) and rescaled by `k` inside a composite mark. */
const shifted =
  (mark: Mark, dx: number, dy: number, k = 1): Mark =>
  (cx, cy, s = 1) =>
    mark(cx + dx * s, cy + dy * s, s * k);

/** Filled five-point star of outer radius `radius` (used for "special" units and the generic qualification). */
export const star: Mark = (cx, cy, s = 1) => {
  const points = Array.from({ length: 10 }, (_, i) => {
    const r = (i % 2 === 0 ? 3.7 : 1.55) * s;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${num(cx + r * Math.cos(a))} ${num(cy + r * Math.sin(a))}`;
  });
  return `<path d="M${points.join('L')}z" fill="currentColor" stroke-width="0.5"/>`;
};

export const flame = line(
  'm0 -3.8c.4 2 2.6 3 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.1.5-1.9 1.1-2.6.2.8.5 1.3 1 1.5-.2-1.4-.5-2.6.5-3.9z',
);
export const drop = line('m0 -3.6c1.4 1.8 2.7 3.1 2.7 4.6a2.7 2.7 0 0 1-5.4 0c0-1.5 1.3-2.8 2.7-4.6z');
export const diamond = all(line('m0 -3.7l3.7 3.7-3.7 3.7-3.7-3.7z'), dot(0, 0, 0.85));
export const pulse = line('m-4 0h1.8l1.1-2.4 2.2 4.8 1.1-2.4h1.8');
export const heart = line('m0 3.2l-3-3.1a1.9 1.9 0 0 1 3-2.3 1.9 1.9 0 0 1 3 2.3z');
export const shield = line('m0 -3.6l-3 1.1v2.2c0 2 1.3 3.3 3 3.9 1.7-.6 3-1.9 3-3.9v-2.2z');
export const paw = all(
  (cx, cy, s = 1) =>
    `<ellipse cx="${num(cx)}" cy="${num(cy + 1.4 * s)}" rx="${num(2 * s)}" ry="${num(1.7 * s)}" fill="currentColor" stroke="none"/>`,
  dot(-2.7, -0.5, 0.9),
  dot(-1, -2.4, 0.9),
  dot(1, -2.4, 0.9),
  dot(2.7, -0.5, 0.9),
);
export const bomb = all(ring(-0.6, 0.9, 2.5), line('m1.2 -.9l1.4-1.4'), dot(3, -2.8, 0.8));
export const magnifier = all(ring(-0.9, -0.9, 2.4), line('m.8 .8l2.8 2.8'));
export const tent = line('m-3.8 3l3.8-6 3.8 6zm3.8 0v-2.6');
export const people = all(
  dot(-2.7, -1.2, 1),
  dot(0, -1.9, 1),
  dot(2.7, -1.2, 1),
  line('m-4.05 2.8a1.35 1.35 0 0 1 2.7 0m0 -.7a1.35 1.35 0 0 1 2.7 0m0 .7a1.35 1.35 0 0 1 2.7 0'),
);
const cylinder = line('m-1.4 3.3v-4.4a1.4 1.4 0 0 1 2.8 0v4.4zm1.4 -5.8v-1m-1 0h2');
export const cylinders = all(shifted(cylinder, -1.9, 0), shifted(cylinder, 1.9, 0));
export const mask = all(
  line(
    'm-3 -2.4h6a1 1 0 0 1 1 1v1.2a1.6 1.6 0 0 1-1.6 1.6h-.9l-1.5-1.3-1.5 1.3h-.9a1.6 1.6 0 0 1-1.6-1.6v-1.2a1 1 0 0 1 1-1z',
  ),
  line('m4 -1.2h1.2v-2.6'),
);
export const rubble = line('m-3.8 3.4v-3.6l3.8-3 1.6 1.3-1 1.7 1.6.8-1 1.4 2.6 1.4h-7.6');
export const cone = all(solid('m-.6 -3.5h1.2l1.9 6.6h-5z'), line('m-3.6 3.5h7.2'));
export const bolt = line('m.8 -3.8l-3.2 4.4h2.6l-1 3.2 3.4-4.6h-2.6z');
export const snowflake = line('m0 -3.6v7.2m-3.1 -5.4l6.2 3.6m0 -3.6l-6.2 3.6');
export const pine = line('m0 -3.8l-2.8 4.6h5.6zm0 4.6v3');
export const peak = line('m-4 3.2l3-5.8 1.9 3.2 1-1.3 2.1 3.9z');
/** Speleo-alpine-fluvial teams: a peak over water. */
export const saf = all(
  shifted(peak, 0, -1.3, 0.8),
  line('m-3.8 2.8c1-.8 1.9-.8 2.9 0s1.9.8 2.8 0 1.4-.6 1.9-.3'),
);
export const teddy = all(
  ring(0, 0.6, 2.7),
  ring(-2.69, -2.09, 1.1),
  ring(2.69, -2.09, 1.1),
  dot(-0.95, 0.2, 0.5),
  dot(0.95, 0.2, 0.5),
  line('m-.7 1.7h1.4'),
);
export const bucket = all(line('m-2.3 -1.2h4.6l-.8 3.4h-3zm2.3 0v-2.6'), dot(-1, 3.6, 0.6), dot(1, 3.6, 0.6));
export const planeTop = solid(
  'm0 -3.8l.9 2.6 2.9 1.9v1l-2.9-.7-.2 1.9 1 .8v.7l-1.7-.5-1.7.5v-.7l1-.8-.2-1.9-2.9.7v-1l2.9-1.9z',
);
export const road = line('m-3.6 3.4l1.8-6.8m3.6 0l1.8 6.8m-3.6 -6.2v1.6m0 1.6v1.6');
export const salt = all(
  dot(0, -2.6, 0.75),
  dot(-1.6, 0, 0.75),
  dot(1.6, 0, 0.75),
  dot(-3, 2.6, 0.75),
  dot(0, 2.6, 0.75),
  dot(3, 2.6, 0.75),
);
export const townhall = line('m-3.8 -.4l3.8-3 3.8 3zm1.2 0v3.4m2.6 -3.4v3.4m2.6 -3.4v3.4m-6.4 .6h7.6');
export const shelter = all(
  line('m-3.8 -.8l3.8-2.8 3.8 2.8'),
  dot(-1.5, 0.7, 0.8),
  dot(1.5, 0.7, 0.8),
  line('m-2.9 3.5a1.4 1.4 0 0 1 2.8 0m.2 0a1.4 1.4 0 0 1 2.8 0'),
);
export const jaws = line('m-2.8 -3.8l2.8 4.2 2.8-4.2m-2.8 4.2v3.4');
export const ladder = line('m-1.6 -3.6v7.2m3.2 -7.2v7.2m-3.2 -5.4h3.2m-3.2 1.8h3.2m-3.2 1.8h3.2');
export const hook = line('m0 -3.8v2.4a2 2 0 1 1-2 2');
export const boat = all(
  line('m-3.8 -.4h7.6l-1.5 2.6h-4.6zm2.2 0v-2.2h2.6l1 2.2'),
  line('m-3.8 3.7c1-.7 1.9-.7 2.9 0s1.9.7 2.8 0 1.2-.5 1.9-.3'),
);
export const radio = all(
  dot(0, 0, 0.9),
  line(
    'm-1.9 -2a2.8 2.8 0 0 0 0 4m3.8 -4a2.8 2.8 0 0 1 0 4m-5.2 -5a4.6 4.6 0 0 0 0 6m6.6 -6a4.6 4.6 0 0 1 0 6',
  ),
);
export const siren = all(
  line('m-2.4 3v-2a2.4 2.4 0 0 1 4.8 0v2zm-1.2 0h7.2'),
  line('m0 -3.8v1m-3.4 .6l.8.8m6-.8l-.8.8'),
);
export const heli = all(
  line('m-3.8 -2.8h7.6m-3.8 0v1.3'),
  oval(0.5, 0.6, 2.6, 2.1),
  line('m-2.1 .3h-1.7v-1.5'),
  line('m-1 3.6h3.4'),
);
export const rotor = all(line('m0 0v-3.8m0 3.8l3.3 1.9m-3.3 -1.9l-3.3 1.9'), dot(0, 0, 1.2));
export const winch = line('m-3.6 -3.6h7.2m-3.6 0v3a1.7 1.7 0 1 1-1.7 1.7');
export const moto = all(
  ring(-2.5, 1.6, 1.4),
  ring(2.5, 1.6, 1.4),
  line('m-2.5 1.6l1.7-3.2h2.2l1.1 3.2m-2-3.2l-.5-1.4h-1.2'),
);
export const megaphone = line('m-3.6 -1v2h1.4l3.4 2.2v-6.4l-3.4 2.2zm6.2 -.2a1.8 1.8 0 0 1 0 2.4');
export const crosshair = all(ring(0, 0, 2.5), line('m0 -3.8v2m0 3.6v2m-3.8 -3.8h2m3.6 0h2'));
export const pineRadio = all(
  shifted(pine, -1.5, 0, 0.85),
  line('m2 -1.6a2.2 2.2 0 0 1 0 3.2m1.3 -4.6a4 4 0 0 1 0 6'),
);
export const avalanche = all(line('m-3.8 -2.6v6.2h7.6z'), ring(0.4, -1.8, 1.3), dot(2.7, 0.9, 0.7));
export const truckMini = all(
  line('m-3.8 1.8v-4.4h4.4v4.4m0 -2.8h1.8l1.4 1.5v1.3h-7.6'),
  dot(-1.9, 2.4, 0.9),
  dot(2, 2.4, 0.9),
);
export const brain = line(
  'm0 -3.2c-1.6-.6-3 .4-2.8 1.8-1.2.6-1.2 2.4 0 3 0 1.4 1.6 2.2 2.8 1.4m0 -6.2c1.6-.6 3 .4 2.8 1.8 1.2.6 1.2 2.4 0 3 0 1.4-1.6 2.2-2.8 1.4v-6.2',
);
export const bandage = all(line('m-3 1l4-4a1.42 1.42 0 0 1 2 2l-4 4a1.42 1.42 0 0 1-2-2z'), dot(0, 0, 0.6));
export const baby = all(
  ring(0, 0.7, 2.9),
  line('m0 -2.2c0-1.4 1.6-1.6 1.6-.4'),
  dot(-1, 0.4, 0.5),
  dot(1, 0.4, 0.5),
  line('m-.9 1.9a1.2 1.2 0 0 0 1.8 0'),
);
export const flask = line(
  'm-1.2 -4h2.4m-2 0v2.6l-2.4 4.2a.8.8 0 0 0 .7 1.2h5a.8.8 0 0 0 .7-1.2l-2.4-4.2v-2.6m-2.7 4.6h3.8',
);
export const stethoscope = all(
  line('m-3.4 -3.6v2.6a2.2 2.2 0 0 0 4.4 0v-2.6m-2.2 4.8v.8a1.9 1.9 0 0 0 3.8 0v-.6'),
  ring(2.6, 0.5, 0.9),
);
export const chevrons = line('m-3 -.6l3-2.4 3 2.4m-6 3.2l3-2.4 3 2.4');
export const wheel = all(ring(0, 0, 3.4), dot(0, 0, 0.9), line('m-3.4 0h2.5m1.8 0h2.5m-3.4 .9v2.5'));
export const bubbles = all(ring(-1.2, 0.8, 2.2), ring(2.3, -1.5, 1.3), ring(2.5, 2.3, 0.9));
/** "?" of the search glyphs (missing people). */
export const question = all(
  line('m-2.3 -1.4a2.35 2.35 0 1 1 3.4 2.1c-.75.45-1.1.95-1.1 1.7'),
  dot(0, 3.3, 0.85),
);
export const sun = all(
  ring(0, 0, 1.9),
  line('m0 -3.8v1m0 5.6v1m-3.8 -3.8h1m5.6 0h1m-6.5 -2.7l.7.7m4 4l.7.7m0 -5.4l-.7.7m-4 4l-.7.7'),
);
export const moon = line('m.6 -3.7a3.8 3.8 0 1 0 3.2 5.2 3.1 3.1 0 0 1-3.2-5.2z');
/** Irregular seven-spike burst: explosions and blasts. */
export const blast = line(
  'm0 -3.8l.89 2.35 1.43-.6-.64 1.81 1.73 1.02-1.98.14.05 2.58-1.48-1.8-1.62.83.29-1.47-2.13-.05 1.85-1.55-.89-1.46 1.64.53z',
);
export const lifebuoy = all(
  ring(0, 0, 3.4),
  ring(0, 0, 1.5),
  line('m-2.45 -2.45l1.4 1.4m2.1 2.1l1.4 1.4m0 -4.9l-1.4 1.4m-2.1 2.1l-1.4 1.4'),
);
export const padlock = line('m-2.7 -.4h5.4v4.1h-5.4zm1.1 0v-1.4a1.6 1.6 0 0 1 3.2 0v1.4');
export const stopwatch = all(ring(0, 0.6, 3.1), line('m0 -.9v1.5l1.1 1.1m-2.1 -4.9h2'));
/** Domino mask of the crime glyphs. */
export const bandit = line(
  'm-3.8 -1.4c1.2-.6 2.5-.6 3.8 0 1.3-.6 2.6-.6 3.8 0 0 2-1 3.2-2.2 3.2-.9 0-1.2-.8-1.6-.8s-.7.8-1.6.8c-1.2 0-2.2-1.2-2.2-3.2z',
);
/** Speech bubble with an angry zigzag: arguments, confrontations. */
export const shout = all(
  line('m-3.8 -1a3.8 2.9 0 1 1 1.6 2.4l-1.6 2.3.3-3a3.4 3.4 0 0 1-.3-1.7z'),
  line('m-1.9 -1.1l1.2-.9.9 1.4 1.1-1.2 1 1'),
);
export const gear = all(
  line(
    'm0 -2.9l.74-.83.71.22.16 1.1.44.36 1.11-.06.35.66-.67.88.06.57.83.74-.22.71-1.1.16-.36.44.06 1.11-.66.35-.88-.67-.57.06-.74.83-.71-.22-.16-1.1-.44-.36-1.11.06-.35-.66.67-.88-.06-.57-.83-.74.22-.71 1.1-.16.36-.44-.06-1.11.66-.35.88.67z',
  ),
  ring(0, 0, 1.2),
);
export const anchor = all(ring(0, -2.9, 0.9), line('m0 -2v5.8m-2 -4.2h4m-3.8 2a3.8 3.8 0 0 0 7.6 0'));
