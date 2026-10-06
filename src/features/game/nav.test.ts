import { describe, expect, it } from 'vitest';
import { incident, snapshot } from '@/test/fixtures';
import { BOTTOM_ITEMS, MORE_ITEMS, SIDEBAR_ITEMS, navAllowed } from './nav';
import { navBadges } from './use-nav';

const ctx = { monetizationUnlocked: false, featureFlags: {} as Record<string, boolean>, level: 1 };

describe('navigation model', () => {
  it('keeps the five bottom items (D-34) and puts the alliance first under "Altro"', () => {
    expect(BOTTOM_ITEMS.map((i) => i.labelKey)).toEqual(['map', 'fleet', 'facilities', 'shop', 'more']);
    expect(MORE_ITEMS[0]?.href).toBe('/game/alliance');
    expect(SIDEBAR_ITEMS[1]?.href).toBe('/game/alliance');
  });
  it('gates on a flag, on monetization and on a level — every condition set must hold', () => {
    expect(navAllowed(undefined, ctx)).toBe(true);
    expect(navAllowed({ flag: 'alliances' }, ctx)).toBe(false);
    expect(navAllowed({ flag: 'alliances' }, { ...ctx, featureFlags: { alliances: true } })).toBe(true);
    expect(
      navAllowed({ monetization: true, flag: 'creditShop' }, { ...ctx, featureFlags: { creditShop: true } }),
    ).toBe(false);
    expect(
      navAllowed(
        { monetization: true, flag: 'creditShop' },
        { ...ctx, monetizationUnlocked: true, featureFlags: { creditShop: true } },
      ),
    ).toBe(true);
    expect(navAllowed({ minLevel: 3 }, { ...ctx, level: 2 })).toBe(false);
    expect(navAllowed({ minLevel: 3 }, { ...ctx, level: 3 })).toBe(true);
  });
  it('counts waiting incidents and the alliance unread (chat + board) from the snapshot', () => {
    const base = snapshot({
      incidents: [incident({ id: 'inc_01J8Z0000000000000000000AB' }), incident({ status: 'RESPONDING' })],
    });
    expect(navBadges(base)).toEqual({ pendingIncidents: 1, alliance: 0 });
    const withAlliance = {
      ...base,
      alliance: {
        id: 'all_01J8Z0000000000000000000AA',
        name: 'Abruzzo Soccorso',
        tag: 'ABR',
        role: 'MEMBER' as const,
        unread: { chat: 4, board: 2 },
        operationId: null,
      },
    };
    expect(navBadges(withAlliance).alliance).toBe(6);
    // A malformed or absent field never breaks the navigation.
    expect(navBadges({ ...base, alliance: { id: 'nope' } } as typeof base).alliance).toBe(0);
    expect(navBadges({ ...base, alliance: null } as typeof base).alliance).toBe(0);
  });
});
