import { describe, expect, it } from 'vitest';
import { pickIdleSuggestion, type IdleSuggestionInput } from './idle-suggestion';

const base: IdleSuggestionInput = { credits: '1000', level: 3 };

describe('pickIdleSuggestion', () => {
  it('returns null when nothing is genuinely true of the career', () => {
    expect(pickIdleSuggestion(base)).toBeNull();
  });

  it('suggests a broken-down vehicle first, above everything else', () => {
    const result = pickIdleSuggestion({
      ...base,
      vehicles: [
        { id: 'veh_1', callSign: 'VF 1', status: 'AVAILABLE' },
        { id: 'veh_2', callSign: 'VF 2', status: 'BROKEN_DOWN' },
      ],
      stockLines: [{ itemCode: 'FIRE_FOAM', facilityId: 'fac_1', low: true }],
      candidates: [{ id: 'cand_1', roleCode: 'EMT', expiresAt: '2099-01-01T00:00:00.000Z' }],
    });
    expect(result).toEqual({ kind: 'BROKEN_VEHICLE', vehicleId: 'veh_2', callSign: 'VF 2' });
  });

  it('ignores a vehicle that is merely busy, not broken down', () => {
    const result = pickIdleSuggestion({
      ...base,
      vehicles: [{ id: 'veh_1', callSign: 'VF 1', status: 'EN_ROUTE' }],
    });
    expect(result).toBeNull();
  });

  it('suggests low stock when nothing is broken', () => {
    const result = pickIdleSuggestion({
      ...base,
      vehicles: [{ id: 'veh_1', callSign: 'VF 1', status: 'AVAILABLE' }],
      stockLines: [
        { itemCode: 'FIRE_FOAM', facilityId: 'fac_1', low: false },
        { itemCode: 'MED_KIT', facilityId: 'fac_2', low: true },
      ],
      candidates: [{ id: 'cand_1', roleCode: 'EMT', expiresAt: '2099-01-01T00:00:00.000Z' }],
    });
    expect(result).toEqual({ kind: 'LOW_STOCK', itemCode: 'MED_KIT', facilityId: 'fac_2' });
  });

  it('suggests the soonest-expiring candidate when nothing is broken or low', () => {
    const result = pickIdleSuggestion({
      ...base,
      now: '2026-01-01T00:00:00.000Z',
      candidates: [
        { id: 'cand_late', roleCode: 'EMT', expiresAt: '2026-01-03T00:00:00.000Z' },
        { id: 'cand_soon', roleCode: 'FIREFIGHTER', expiresAt: '2026-01-02T00:00:00.000Z' },
      ],
    });
    expect(result).toEqual({ kind: 'EXPIRING_CANDIDATE', candidateId: 'cand_soon', roleCode: 'FIREFIGHTER' });
  });

  it('ignores a candidate that has already expired', () => {
    const result = pickIdleSuggestion({
      ...base,
      now: '2026-01-05T00:00:00.000Z',
      candidates: [{ id: 'cand_1', roleCode: 'EMT', expiresAt: '2026-01-01T00:00:00.000Z' }],
    });
    expect(result).toBeNull();
  });

  it('suggests the most expensive affordable, unlocked vehicle type when idle otherwise', () => {
    const result = pickIdleSuggestion({
      ...base,
      credits: '50000',
      vehicleTypes: [
        { code: 'FIRE_APS', family: 'FIRE', price: '30000', unlocked: true },
        { code: 'FIRE_ABP', family: 'FIRE', price: '80000', unlocked: true }, // too expensive
        { code: 'FIRE_AS', family: 'FIRE', price: '45000', unlocked: true },
        { code: 'EMS_MSA', family: 'EMS', price: '20000', unlocked: false }, // locked
      ],
    });
    expect(result).toEqual({ kind: 'AFFORDABLE_UPGRADE', vehicleTypeCode: 'FIRE_AS' });
  });

  it('suggests a family close to unlocking when nothing else applies', () => {
    const result = pickIdleSuggestion({
      ...base,
      level: 5,
      families: [
        { code: 'EMS', requiredLevel: 6, unlocked: false },
        { code: 'POLICE', requiredLevel: 20, unlocked: false },
        { code: 'FIRE', requiredLevel: 1, unlocked: true },
      ],
    });
    expect(result).toEqual({ kind: 'UNCOVERED_FAMILY', family: 'EMS', requiredLevel: 6 });
  });

  it('does not suggest a family that is many levels away', () => {
    const result = pickIdleSuggestion({
      ...base,
      level: 1,
      families: [{ code: 'POLICE', requiredLevel: 20, unlocked: false }],
    });
    expect(result).toBeNull();
  });

  it('respects the priority order end to end: stock beats candidate beats upgrade beats family', () => {
    const common: IdleSuggestionInput = {
      ...base,
      level: 5,
      credits: '50000',
      stockLines: [{ itemCode: 'FIRE_FOAM', facilityId: 'fac_1', low: true }],
      candidates: [{ id: 'cand_1', roleCode: 'EMT', expiresAt: '2099-01-01T00:00:00.000Z' }],
      vehicleTypes: [{ code: 'FIRE_APS', family: 'FIRE', price: '1000', unlocked: true }],
      families: [{ code: 'EMS', requiredLevel: 6, unlocked: false }],
    };
    expect(pickIdleSuggestion(common)?.kind).toBe('LOW_STOCK');
    const { stockLines: _drop, ...withoutStock } = common;
    expect(pickIdleSuggestion(withoutStock)?.kind).toBe('EXPIRING_CANDIDATE');
    const { candidates: _drop2, ...withoutCandidates } = withoutStock;
    expect(pickIdleSuggestion(withoutCandidates)?.kind).toBe('AFFORDABLE_UPGRADE');
    const { vehicleTypes: _drop3, ...withoutUpgrade } = withoutCandidates;
    expect(pickIdleSuggestion(withoutUpgrade)?.kind).toBe('UNCOVERED_FAMILY');
  });
});
