import { beforeEach, describe, expect, it } from 'vitest';
import {
  amountRatio,
  compareAmount,
  formatAmount,
  formatClock,
  formatDistance,
  parseAmount,
  severityTier,
} from './format';
import {
  MAX_CLIENT_PROGRESS,
  bearingDeg,
  boundsOf,
  haversineMeters,
  movementProgress,
  pathLengthMeters,
  pointAlong,
  remainingPath,
  type LngLat,
} from './geo';
import { getClockOffset, observeServerTime, resetClockForTests, serverNow } from './clock';
import { humanizeKey } from '@/i18n/use-i18n-text';
import { negotiateLocale } from '@/i18n/config';
import { ulid } from '@/mocks/ulid';
import { publicId } from '@/contracts';

describe('format', () => {
  it('formats amounts through BigInt without precision loss', () => {
    expect(formatAmount('9007199254740993', 'it')).toBe('9.007.199.254.740.993');
    expect(formatAmount('-900', 'en', { sign: true })).toBe('−900');
    expect(formatAmount('240', 'en', { sign: true })).toBe('+240');
    expect(formatAmount('0', 'en', { sign: true })).toBe('0');
    expect(parseAmount('not a number')).toBe(0n);
  });
  it('compares and divides big amounts', () => {
    expect(compareAmount('10', '9')).toBe(1);
    expect(compareAmount('100000000000000000001', '100000000000000000002')).toBe(-1);
    expect(amountRatio('50', '200')).toBe(0.25);
    expect(amountRatio('5', '0')).toBe(0);
    expect(amountRatio('500', '200')).toBe(1);
  });
  it('formats clocks, distances and tiers', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(277)).toBe('4:37');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatDistance(438, 'it')).toBe('440 m');
    expect(formatDistance(1250, 'it')).toBe('1,3 km');
    expect([1, 5, 8, 10].map(severityTier)).toEqual(['low', 'medium', 'high', 'critical']);
  });
});

describe('geo', () => {
  const path: LngLat[] = [
    [14.2, 42.46],
    [14.21, 42.46],
    [14.21, 42.47],
  ];
  it('measures distances and bearings', () => {
    expect(haversineMeters([14.2, 42.46], [14.21, 42.46])).toBeGreaterThan(800);
    expect(haversineMeters([14.2, 42.46], [14.21, 42.46])).toBeLessThan(840);
    expect(Math.round(bearingDeg([14.2, 42.46], [14.21, 42.46]))).toBe(90);
    expect(Math.round(bearingDeg([14.21, 42.46], [14.21, 42.47]))).toBe(0);
  });
  it('interpolates along a path by length', () => {
    expect(pointAlong(path, 0).position).toEqual(path[0]);
    expect(pointAlong(path, 1).position).toEqual(path[2]);
    const total = pathLengthMeters(path);
    const first = haversineMeters(path[0]!, path[1]!);
    const corner = pointAlong(path, first / total);
    expect(corner.position[0]).toBeCloseTo(14.21, 5);
    expect(pointAlong(path, 0.99).segment).toBe(1);
    expect(remainingPath(path, 0.99)).toHaveLength(2);
    expect(boundsOf(path)).toEqual([14.2, 42.46, 14.21, 42.47]);
    expect(boundsOf([])).toBeNull();
  });
  it('never shows a vehicle as arrived before the server says so (98% cap)', () => {
    const m = { departAt: '2026-01-01T10:00:00.000Z', arriveAt: '2026-01-01T10:01:40.000Z' };
    expect(movementProgress(m, Date.parse('2026-01-01T09:59:00.000Z'))).toBe(0);
    expect(movementProgress(m, Date.parse('2026-01-01T10:00:50.000Z'))).toBeCloseTo(0.5);
    expect(movementProgress(m, Date.parse('2026-01-01T10:30:00.000Z'))).toBe(MAX_CLIENT_PROGRESS);
  });
});

describe('server clock', () => {
  beforeEach(() => resetClockForTests());
  it('adopts the first sample and smooths the following ones', () => {
    observeServerTime(new Date(1_000_000 + 4_000).toISOString(), 0, 1_000_000);
    expect(getClockOffset()).toBe(4000);
    observeServerTime(new Date(1_000_000 + 4_500).toISOString(), 0, 1_000_000);
    expect(getClockOffset()).toBeCloseTo(4100);
    expect(serverNow(2_000_000)).toBeCloseTo(2_004_100);
  });
  it('compensates half the round trip and jumps on large drifts', () => {
    observeServerTime(new Date(1_000_000).toISOString(), 200, 1_000_000);
    expect(getClockOffset()).toBe(100);
    observeServerTime(new Date(1_000_000 + 60_000).toISOString(), 0, 1_000_000);
    expect(getClockOffset()).toBe(60_000);
    observeServerTime('garbage');
    expect(getClockOffset()).toBe(60_000);
  });
});

describe('i18n helpers', () => {
  it('humanises unknown content keys', () => {
    expect(humanizeKey('catalog.vehicle.FIRE_APS.name')).toBe('Fire aps');
    expect(humanizeKey('outcome.note.FAST_RESPONSE')).toBe('Fast response');
  });
  it('negotiates the locale', () => {
    expect(negotiateLocale('de-CH,de;q=0.9,en;q=0.8')).toBe('de');
    expect(negotiateLocale('pt-BR,es;q=0.7')).toBe('es');
    expect(negotiateLocale('ja')).toBe('it');
    expect(negotiateLocale(null)).toBe('it');
  });
});

describe('mock ulid', () => {
  it('produces ids accepted by the contract', () => {
    expect(publicId('inc').safeParse(`inc_${ulid()}`).success).toBe(true);
    expect(ulid(1).length).toBe(26);
  });
});
