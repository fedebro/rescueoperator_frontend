'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useSnapshot } from '@/features/game/hooks';

/**
 * Monetization (credit shop, rewarded video, referral) is never shown before the tutorial is completed AND the first
 * organic purchase was made (analisi/05 §7.6). The server enforces the same gate; the client derives it from the snapshot:
 * a second vehicle, a second facility or any facility upgrade can only come from an organic purchase.
 */
export function useMonetizationUnlocked(): boolean {
  const { career, vehicles, facilities } = useSnapshot();
  if (!career.tutorial.completed) return false;
  return vehicles.length > 1 || facilities.length > 1 || facilities.some((f) => f.upgrades.length > 0);
}

export type MonetizationFlag = 'creditShop' | 'rewardedAds' | 'referrals';

/** Gate + feature flag of one monetization surface. */
export function useMonetizationFeature(flag: MonetizationFlag): boolean {
  const unlocked = useMonetizationUnlocked();
  const { featureFlags } = useSnapshot();
  return unlocked && featureFlags[flag] === true;
}

/** Page guard: a gated screen opened by URL sends the player back to the map instead of teasing the shop. */
export function useMonetizationPageGuard(flag: MonetizationFlag): boolean {
  const allowed = useMonetizationFeature(flag);
  const router = useRouter();
  // Once per mount: a second `replace` could land after the player has already navigated elsewhere.
  const redirected = React.useRef(false);
  React.useEffect(() => {
    if (allowed || redirected.current) return;
    redirected.current = true;
    router.replace('/game');
  }, [allowed, router]);
  return allowed;
}
