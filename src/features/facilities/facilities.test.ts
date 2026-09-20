import { describe, expect, it } from 'vitest';
import type { FacilityDto, SiteDto } from '@/contracts';
import { resolveHost } from '@/features/game/shop-screen';
import { promotionChecklist } from './facility-extras';
import { siteFeatures } from './map-overlay';
import { entryOption } from './new-facility-section';
import { siteFamily } from './site-details';
import { transferTargets } from './transfer-vehicle';
import { sitesBbox } from './use-sites';

const facility = (patch: Partial<FacilityDto>): FacilityDto => ({
  id: 'fac_1',
  typeCode: 'FIRE_LOCAL_STATION',
  family: 'FIRE',
  name: 'HQ',
  position: [14.2, 42.46],
  status: 'OPERATIONAL',
  capacities: [
    { domain: 'GROUND', total: 6, used: 4 },
    { domain: 'AIR', total: 0, used: 0 },
  ],
  upgrades: [],
  ...patch,
});
const site = (patch: Partial<SiteDto>): SiteDto => ({
  id: 'sit_1',
  name: 'Site',
  real: true,
  family: 'EMS',
  position: [14.21, 42.45],
  address: null,
  locationId: 'IT-068028',
  capacityPoints: 4,
  expansionPotential: 'LOW',
  profile: 'CENTRAL',
  owned: false,
  options: [],
  ...patch,
});
const option = (facilityTypeCode: string, price: string, available: boolean, family = 'EMS') => ({
  facilityTypeCode,
  family: family as 'EMS',
  tier: 1,
  price,
  requiredLevel: 3,
  setupSeconds: 60,
  available,
  lockedReason: available ? null : 'LEVEL_TOO_LOW',
});

describe('resolveHost (shop delivery facility)', () => {
  const engine = {
    compatibleFacilityTypes: ['FIRE_LOCAL_STATION'],
    domain: 'GROUND' as const,
    capacityPoints: 2,
  };
  it('needs an OPERATIONAL facility of a compatible type', () => {
    expect(resolveHost(engine, [facility({ typeCode: 'EMS_POST' })]).kind).toBe('NO_FACILITY');
    expect(resolveHost(engine, [facility({ status: 'UNDER_CONSTRUCTION' })]).kind).toBe('NO_FACILITY');
  });
  it('needs free capacity in the vehicle domain (a helicopter needs AIR points)', () => {
    expect(resolveHost({ ...engine, capacityPoints: 3 }, [facility({})]).kind).toBe('NO_CAPACITY');
    expect(resolveHost({ ...engine, domain: 'AIR' }, [facility({})]).kind).toBe('NO_CAPACITY');
  });
  it('prefers the facility chosen by the player when it qualifies, else the first that does', () => {
    const a = facility({ id: 'fac_a' });
    const b = facility({ id: 'fac_b' });
    const full = facility({ id: 'fac_full', capacities: [{ domain: 'GROUND', total: 2, used: 2 }] });
    expect(resolveHost(engine, [a, b], 'fac_b')).toMatchObject({
      kind: 'OK',
      facility: { id: 'fac_b' },
      alternatives: 1,
    });
    expect(resolveHost(engine, [full, a], 'fac_full')).toMatchObject({
      kind: 'OK',
      facility: { id: 'fac_a' },
    });
  });
});

describe('transferTargets', () => {
  const type = {
    compatibleFacilityTypes: ['FIRE_LOCAL_STATION', 'FIRE_DETACHMENT'],
    domain: 'GROUND',
    capacityPoints: 2,
  };
  it('explains why each facility can or cannot take the vehicle, valid targets first', () => {
    const targets = transferTargets({ facilityId: 'fac_1' }, type, [
      facility({}),
      facility({ id: 'fac_ems', typeCode: 'EMS_POST' }),
      facility({ id: 'fac_build', status: 'UNDER_CONSTRUCTION' }),
      facility({ id: 'fac_full', capacities: [{ domain: 'GROUND', total: 6, used: 5 }] }),
      facility({ id: 'fac_ok', typeCode: 'FIRE_DETACHMENT' }),
    ]);
    expect(targets[0]).toMatchObject({ facility: { id: 'fac_ok' }, state: 'OK', free: 2 });
    expect(Object.fromEntries(targets.map((t) => [t.facility.id, t.state]))).toEqual({
      fac_1: 'CURRENT',
      fac_ems: 'INCOMPATIBLE',
      fac_build: 'NOT_OPERATIONAL',
      fac_full: 'FULL',
      fac_ok: 'OK',
    });
  });
});

describe('promotionChecklist', () => {
  it('lists the career level and every required upgrade level with progress', () => {
    const list = promotionChecklist(
      { requiredLevel: 7, requiredUpgradeLevels: { GARAGE: 2, QUARTERS: 2 } },
      {
        upgrades: [
          { code: 'GARAGE', level: 2, buildingUntil: null },
          { code: 'QUARTERS', level: 1, buildingUntil: null },
        ],
      },
      5,
    );
    expect(list).toEqual([
      { kind: 'LEVEL', code: 'LEVEL', required: 7, current: 5, met: false },
      { kind: 'UPGRADE', code: 'GARAGE', required: 2, current: 2, met: true },
      { kind: 'UPGRADE', code: 'QUARTERS', required: 2, current: 1, met: false },
    ]);
  });
});

describe('candidate sites helpers', () => {
  it('draws only sites that are not owned and highlights the selected one', () => {
    const features = siteFeatures(
      [site({}), site({ id: 'sit_2' }), site({ id: 'sit_3', owned: true })],
      'sit_2',
    ).features;
    expect(features.map((f) => f.properties)).toEqual([
      { kind: 'site', id: 'sit_1', name: 'Site', image: 'site:0', sort: 0 },
      { kind: 'site', id: 'sit_2', name: 'Site', image: 'site:1', sort: 1 },
    ]);
  });
  it('treats a site that only offers SHARED types as a shared site', () => {
    expect(
      siteFamily(
        site({ family: 'FIRE', options: [option('COORDINATION_CENTER', '30000', false, 'SHARED')] }),
      ),
    ).toBe('SHARED');
    expect(siteFamily(site({ options: [option('EMS_POST', '1200', true)] }))).toBe('EMS');
    expect(siteFamily(site({ options: [] }))).toBe('EMS');
  });
  it('shows the cheapest buyable option first (BigInt-safe), else the cheapest locked one', () => {
    const s = site({
      options: [
        option('EMS_STATION', '9000', true),
        option('EMS_POST', '1200', false),
        option('EMS_X', '10000', true),
      ],
    });
    expect(entryOption(s)?.facilityTypeCode).toBe('EMS_STATION');
    expect(
      entryOption(site({ options: [option('B', '900', false), option('A', '1000', false)] }))
        ?.facilityTypeCode,
    ).toBe('B');
    expect(entryOption(site({}))).toBeUndefined();
  });
  it('pads the career bounds by 10% for the sites query', () => {
    expect(sitesBbox([14, 42, 15, 43])).toEqual([13.9, 41.9, 15.1, 43.1]);
  });
});
