'use client';
import * as React from 'react';
import type { SyncSnapshot } from '@/contracts';
import { useMonetizationUnlocked } from '@/features/monetization/gate';
import { allianceOf } from '@/features/alliance/snapshot';
import { useSnapshot } from './hooks';
import { MORE_ITEMS, navAllowed, type NavBadge, type NavItem } from './nav';

/** Filters navigation entries by their gate (monetization unlock, feature flag, level — see `NavGate`). */
export function useVisibleNav(items: NavItem[]): NavItem[] {
  const monetizationUnlocked = useMonetizationUnlocked();
  const { featureFlags, career } = useSnapshot();
  return React.useMemo(
    () =>
      items.filter((i) => navAllowed(i.gate, { monetizationUnlocked, featureFlags, level: career.level })),
    [items, monetizationUnlocked, featureFlags, career.level],
  );
}

/** Pure: every badge counter of the snapshot (the waiting incidents, the alliance's unread chat + board). */
export function navBadges(snapshot: SyncSnapshot): Record<NavBadge, number> {
  const alliance = allianceOf(snapshot);
  return {
    pendingIncidents: snapshot.incidents.filter((i) => i.status === 'PENDING_RESPONSE').length,
    alliance: alliance ? alliance.unread.chat + alliance.unread.board : 0,
  };
}

export function useNavBadges(): Record<NavBadge, number> {
  const snapshot = useSnapshot();
  return React.useMemo(() => navBadges(snapshot), [snapshot]);
}

/** The sum shown on "Altro": the badges of the visible entries it hides. */
export function useMoreBadge(): number {
  const items = useVisibleNav(MORE_ITEMS);
  const badges = useNavBadges();
  return items.reduce((sum, i) => sum + (i.badge ? badges[i.badge] : 0), 0);
}
