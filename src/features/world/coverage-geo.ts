import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { z } from 'zod';
import type { CoverageDto as CoverageSchema } from '@/contracts';
import type { LngLat } from '@/lib/geo';

export type CoverageDto = z.infer<typeof CoverageSchema>;
export type CoverageCell = CoverageDto['cells'][number];

/** Used when the server does not send `isochroneSeconds` (older backend). */
export const DEFAULT_RINGS = [300, 600, 900, 1200, 1800];
export const UNREACHABLE_BIN = -1;
/**
 * One colour per ring + one for "beyond the last ring": green → yellow → magenta, with increasing darkness so the order
 * survives colour-vision deficiencies. Colour is never the only cue: cells carry the minutes as a label and the legend
 * is numeric; unreachable cells are hatched.
 */
export const COVERAGE_COLORS = ['#4CC38A', '#A6D854', '#F2D43D', '#F59E42', '#E8603C', '#B0305C'];
export const UNREACHABLE_COLOR = '#8492A6';

export const colorOfBin = (bin: number): string =>
  bin === UNREACHABLE_BIN ? UNREACHABLE_COLOR : COVERAGE_COLORS[Math.min(bin, COVERAGE_COLORS.length - 1)]!;

/** Response seconds of a cell for the selected family (null family = best of all). */
export function cellSeconds(cell: CoverageCell, family: string | null): number | null {
  if (family === null) return cell.bestSeconds;
  return cell.secondsByFamily?.[family] ?? null;
}

/** Index of the first ring that contains `seconds`; `rings.length` = beyond the last ring. */
export function binOf(seconds: number | null, rings: readonly number[]): number {
  if (seconds === null) return UNREACHABLE_BIN;
  const index = rings.findIndex((ring) => seconds <= ring);
  return index === -1 ? rings.length : index;
}

export interface LegendBin {
  bin: number;
  color: string;
  /** Minutes; `to` is null for the open-ended last bin, both are null for "unreachable". */
  from: number | null;
  to: number | null;
}
export function legendBins(rings: readonly number[]): LegendBin[] {
  const minutes = rings.map((s) => Math.round(s / 60));
  return [
    ...minutes.map((to, i) => ({ bin: i, color: colorOfBin(i), from: i === 0 ? 0 : minutes[i - 1]!, to })),
    { bin: rings.length, color: colorOfBin(rings.length), from: minutes.at(-1) ?? 0, to: null },
    { bin: UNREACHABLE_BIN, color: UNREACHABLE_COLOR, from: null, to: null },
  ];
}

export interface CoverageCellProps {
  h3: string;
  bin: number;
  color: string;
  /** Minutes shown inside the cell ("8′"), empty when unreachable. */
  label: string;
  population: number;
}

/** H3 cells → GeoJSON polygons. `boundary` is `h3-js` `cellToBoundary(h3, true)` (injected: the library is loaded lazily). */
export function coverageFeatures(
  coverage: Pick<CoverageDto, 'cells' | 'isochroneSeconds'>,
  family: string | null,
  boundary: (h3: string) => LngLat[],
): FeatureCollection<Polygon, CoverageCellProps> {
  const rings = coverage.isochroneSeconds?.length ? coverage.isochroneSeconds : DEFAULT_RINGS;
  const features: Feature<Polygon, CoverageCellProps>[] = [];
  for (const cell of coverage.cells) {
    if (cell.inArea === false) continue;
    let ring: LngLat[];
    try {
      ring = boundary(cell.h3);
    } catch {
      continue; // an invalid cell id must not take the whole layer down
    }
    const seconds = cellSeconds(cell, family);
    const bin = binOf(seconds, rings);
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        h3: cell.h3,
        bin,
        color: colorOfBin(bin),
        label: seconds === null ? '' : `${Math.max(1, Math.round(seconds / 60))}′`,
        population: cell.population,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Diagonal hatch as raw RGBA pixels (works without a canvas): the texture of closures and unreachable cells. */
export function hatchImage(
  [r, g, b, a]: [number, number, number, number],
  size = 16,
  stroke = 3,
): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if ((x + y) % (size / 2) >= stroke) continue;
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  return { width: size, height: size, data };
}
