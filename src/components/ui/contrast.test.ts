import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** WCAG 2.x contrast of the semantic colour tokens of globals.css — the pairs the design system actually uses. */
const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
const tokens = new Map<string, string>();
for (const m of css.matchAll(/--rc-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens.set(m[1]!, m[2]!);

type Rgb = [number, number, number];
const hex = (name: string): Rgb => {
  const value = tokens.get(name);
  if (!value) throw new Error(`token --rc-${name} is not a #rrggbb colour`);
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
};
const luminance = (c: Rgb): number => {
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** `bg-<tone>/NN` over a surface. */
const tint = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;

const WHITE: Rgb = [255, 255, 255];
const AA_TEXT = 4.5;
const AA_UI = 3;
const SURFACES = ['bg', 'surface-1', 'surface-2', 'surface-3'];

describe('colour tokens reach WCAG AA on the dark surfaces', () => {
  it('sanity: the formula matches the reference values', () => {
    expect(contrast(WHITE, [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([119, 119, 119], WHITE)).toBeCloseTo(4.48, 2);
  });

  it.each(['text', 'text-muted', 'text-subtle'])(
    '%s ≥ 4.5:1 on every surface (incl. hover surface-4)',
    (token) => {
      for (const surface of [...SURFACES, 'surface-4'])
        expect(contrast(hex(token), hex(surface)), `${token} on ${surface}`).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(['success', 'warning', 'danger', 'info', 'credits', 'xp', 'skyline', 'brand-hover', 'major'])(
    '%s as text ≥ 4.5:1 on bg … surface-2',
    (token) => {
      for (const surface of ['bg', 'surface-1', 'surface-2'])
        expect(contrast(hex(token), hex(surface)), `${token} on ${surface}`).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(['success', 'warning', 'danger', 'info', 'credits', 'xp'])(
    'badge %s: tone text on its own 15%% tint ≥ 4.5:1 over surface-1 … surface-3',
    (token) => {
      for (const surface of ['surface-1', 'surface-2', 'surface-3'])
        expect(
          contrast(hex(token), tint(hex(token), hex(surface), 0.15)),
          `${token} badge on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it('brand badge: light brand red on the brand-soft tint', () => {
    for (const surface of ['surface-1', 'surface-2', 'surface-3'])
      expect(contrast(hex('brand-hover'), tint(hex('brand'), hex(surface), 0.14))).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
  });

  it('neutral badge and muted text on surface-3', () => {
    expect(contrast(hex('text-muted'), hex('surface-3'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('white labels on every state of the primary button and on the unread badge', () => {
    for (const token of ['brand', 'brand-strong', 'brand-active'])
      expect(contrast(WHITE, hex(token)), token).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('danger button (text on its 15% / 20% tint) and the offline banner', () => {
    for (const alpha of [0.15, 0.2])
      expect(contrast(hex('danger'), tint(hex('danger'), hex('surface-1'), alpha))).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    expect(contrast(hex('danger'), tint(hex('danger'), hex('bg'), 0.2))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(hex('warning'), tint(hex('warning'), hex('bg'), 0.15))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('non-text UI: focus ring and strong borders ≥ 3:1 where they carry meaning', () => {
    for (const surface of [...SURFACES, 'surface-4'])
      expect(contrast(hex('focus'), hex(surface)), `focus on ${surface}`).toBeGreaterThanOrEqual(AA_UI);
  });
});
