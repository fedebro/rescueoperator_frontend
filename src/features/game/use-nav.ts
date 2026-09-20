'use client';
import { useMonetizationUnlocked } from '@/features/monetization/gate';
import { useSnapshot } from './hooks';
import type { NavItem } from './nav';

/** Filters navigation entries by their gate (monetization is hidden until tutorial + first organic purchase). */
export function useVisibleNav(items: NavItem[]): NavItem[] {
  const unlocked = useMonetizationUnlocked();
  const { featureFlags } = useSnapshot();
  return items.filter((i) => !i.gate || (unlocked && featureFlags[i.gate.flag] === true));
}
