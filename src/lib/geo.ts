import type { MovementDto } from '@/contracts';

export type LngLat = [number, number];

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function pathLengthMeters(path: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

export interface PathPoint {
  position: LngLat;
  bearing: number;
  /** index of the segment the point lies on */
  segment: number;
}

/** Point at fraction t∈[0,1] of the path length (linear interpolation per segment — fine at city scale). */
export function pointAlong(path: readonly LngLat[], t: number): PathPoint {
  const first = path[0];
  if (!first) throw new Error('empty path');
  if (path.length === 1) return { position: first, bearing: 0, segment: 0 };
  const clamped = Math.min(1, Math.max(0, t));
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const l = haversineMeters(path[i - 1]!, path[i]!);
    lengths.push(l);
    total += l;
  }
  if (total === 0) return { position: first, bearing: 0, segment: 0 };
  let target = clamped * total;
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    const a = path[i]!;
    const b = path[i + 1]!;
    if (target <= l || i === lengths.length - 1) {
      const f = l === 0 ? 0 : Math.min(1, target / l);
      return {
        position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
        bearing: bearingDeg(a, b),
        segment: i,
      };
    }
    target -= l;
  }
  const last = path[path.length - 1]!;
  return { position: last, bearing: 0, segment: path.length - 2 };
}

/** Remaining part of the path from fraction t to the end (for drawing the route ahead of a vehicle). */
export function remainingPath(path: readonly LngLat[], t: number): LngLat[] {
  const p = pointAlong(path, t);
  return [p.position, ...path.slice(p.segment + 1)];
}

/** The client never shows a vehicle as arrived before the server says so: progress is capped at 98%. */
export const MAX_CLIENT_PROGRESS = 0.98;

export function movementProgress(
  movement: Pick<MovementDto, 'departAt' | 'arriveAt'>,
  nowMs: number,
): number {
  const depart = Date.parse(movement.departAt);
  const arrive = Date.parse(movement.arriveAt);
  if (!(arrive > depart)) return MAX_CLIENT_PROGRESS;
  const raw = (nowMs - depart) / (arrive - depart);
  return Math.min(MAX_CLIENT_PROGRESS, Math.max(0, raw));
}

export function boundsOf(points: readonly LngLat[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [lng, lat] of points) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}
