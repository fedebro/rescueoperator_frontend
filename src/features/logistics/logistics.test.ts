import { describe, expect, it } from 'vitest';
import type { InventoryLine } from './api';
import { maxPacksForStorage, suggestedPacks } from './order-dialog';

const line = (patch: Partial<InventoryLine>): InventoryLine => ({
  facilityId: 'fac_1',
  itemCode: 'FOAM',
  quantity: 0,
  reserved: 0,
  inbound: 0,
  minimum: 40,
  low: true,
  ...patch,
});

describe('suggestedPacks', () => {
  it('is zero for a line that is not low', () => {
    expect(suggestedPacks(line({ low: false }), 50)).toBe(0);
  });
  it('rounds up to the pack that reaches 2.5× the minimum, minus what is already inbound', () => {
    expect(suggestedPacks(line({ quantity: 10, inbound: 0 }), 50)).toBe(2);
    expect(suggestedPacks(line({ quantity: 10, inbound: 50 }), 50)).toBe(1);
  });
});

describe('maxPacksForStorage — mirrors the server CAPACITY_EXCEEDED check for STORAGE', () => {
  it('caps at the UI ceiling when the item costs no storage points', () => {
    expect(maxPacksForStorage(0, 0, 3)).toBe(99);
  });
  it('never lets the "+" push past the free storage points', () => {
    // 2 points/pack, 5 points free (nothing of this line counted yet): 2 more packs fit, a 3rd would need 6.
    expect(maxPacksForStorage(0, 2, 5)).toBe(2);
  });
  it('adds back this line’s own current reservation before dividing', () => {
    // Already holding 3 packs (6 points) that are already subtracted out of freePoints; 4 points still free
    // overall means this line alone could grow to 5 packs (10 points) before the warehouse is full.
    expect(maxPacksForStorage(3, 2, 4)).toBe(5);
  });
  it('never returns a negative room even when already over capacity', () => {
    expect(maxPacksForStorage(0, 5, -3)).toBe(0);
  });
});
