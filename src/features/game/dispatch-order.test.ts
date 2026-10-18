import { describe, expect, it } from 'vitest';
import type { DispatchOption } from '@/lib/api/types';
import { orderDispatchOptions } from './dispatch-order';

type Chain = NonNullable<DispatchOption['chain']>;
const chain = (redirectEligible: boolean, arriveAt?: string): Chain =>
  ({
    vehicleStatus: 'RETURNING',
    redirectEligible,
    blockedReason: redirectEligible ? null : 'VEHICLE_NOT_RETURNING',
    queueable: true,
    availableAt: null,
    crew: null,
    queuedIncidentId: null,
    ...(arriveAt
      ? {
          estimate: {
            freeAt: arriveAt,
            arriveAt,
            basis: 'WORK_END',
            approximate: true,
            incidentExpiresAt: null,
            afterExpiry: false,
          },
        }
      : {}),
  }) as Chain;
const opt = (vehicleId: string, over: Partial<DispatchOption> = {}): DispatchOption =>
  ({
    vehicleId,
    etaSeconds: 100,
    distanceMeters: 1000,
    dispatchable: false,
    blockedReason: 'VEHICLE_NOT_AVAILABLE',
    warnings: [],
    contributes: [],
    recommended: false,
    ...over,
  }) as DispatchOption;

describe('dispatch list order (owner, 2026-10-18)', () => {
  it('recommended, then free and redirectable by distance, then queue-only by arrival, then the rest', () => {
    const list = [
      opt('blocked-near', { distanceMeters: 100 }),
      opt('queue-late', { chain: chain(false, '2026-10-18T12:30:00Z') }),
      opt('free-far', { dispatchable: true, distanceMeters: 5000, etaSeconds: 300 }),
      opt('reco-slow', { recommended: true, dispatchable: true, etaSeconds: 400, distanceMeters: 900 }),
      opt('redirect-near', { distanceMeters: 1200, etaSeconds: 150, chain: chain(true) }),
      opt('queue-early', { chain: chain(false, '2026-10-18T12:10:00Z') }),
      opt('reco-fast', { recommended: true, dispatchable: true, etaSeconds: 200, distanceMeters: 3000 }),
      opt('free-near', { dispatchable: true, distanceMeters: 800, etaSeconds: 120 }),
      opt('queue-unknown', { chain: chain(false) }),
    ];
    expect(orderDispatchOptions(list).map((o) => o.vehicleId)).toEqual([
      'reco-fast',
      'reco-slow',
      'free-near',
      'redirect-near',
      'free-far',
      'queue-early',
      'queue-late',
      'queue-unknown',
      'blocked-near',
    ]);
  });
});
