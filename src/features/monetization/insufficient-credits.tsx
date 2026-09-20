'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PlayCircle, ShoppingBag, Siren } from 'lucide-react';
import { create } from 'zustand';
import { compareAmount, parseAmount } from '@/lib/format';
import { track } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { useSnapshot } from '@/features/game/hooks';
import { useMonetizationFeature, useMonetizationUnlocked } from './gate';
import { AdBlockNotice } from './ads/rewarded-card';
import { SimulatedAdPlayerHost } from './ads/simulated-player';
import { useRewardedAd } from './ads/use-rewarded-ad';

interface InsufficientCreditsState {
  /** Price of what the player tried to buy; null = closed. */
  price: string | null;
  close: () => void;
}
export const useInsufficientCredits = create<InsufficientCreditsState>((set) => ({
  price: null,
  close: () => set({ price: null }),
}));
/**
 * Any purchase flow calls this on `INSUFFICIENT_CREDITS` (or when it already knows the balance is short).
 * One global dialog (mounted by the game layout) — owner: monetization agent.
 */
export function requestCredits(price: string | number | bigint): void {
  useInsufficientCredits.setState({ price: String(price) });
}

function WatchAdOption() {
  const t = useTranslations('game.shop.insufficient');
  const ta = useTranslations('monetization.ads');
  const { status, blocked, watching, watch } = useRewardedAd();
  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        className="w-full justify-start"
        disabled={!status || blocked !== null}
        loading={watching}
        onClick={() => void watch('insufficient_credits')}
        data-testid="insufficient-watch-ad"
      >
        <PlayCircle className="size-5" aria-hidden />
        {t('watchAd')}
        {status ? (
          <span className="tabular text-muted ml-auto text-xs font-normal">
            {ta('watchedShort', { watched: status.watchedToday, limit: status.dailyLimit })}
          </span>
        ) : null}
      </Button>
      {status && blocked ? (
        <div className="mt-1 px-1">
          <AdBlockNotice
            reason={blocked}
            nextAvailableAt={status.nextAvailableAt}
            resetsAt={status.resetsAt}
          />
        </div>
      ) : null}
    </>
  );
}

function InsufficientCreditsDialog({ price, onClose }: { price: string; onClose: () => void }) {
  const t = useTranslations('game.shop.insufficient');
  const tm = useTranslations('monetization.insufficient');
  const tc = useTranslations('common');
  const { career } = useSnapshot();
  const unlocked = useMonetizationUnlocked();
  const adsOn = useMonetizationFeature('rewardedAds');
  const shopOn = useMonetizationFeature('creditShop');
  const missing = parseAmount(price) - parseAmount(career.credits);
  const covered = compareAmount(career.credits, price) >= 0;

  React.useEffect(() => {
    track('insufficient_credits_shown', { unlocked });
  }, [unlocked]);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title={t('title')}
        description={unlocked ? t('subtitle') : tm('subtitleLocked')}
        closeLabel={tc('close')}
        data-testid="insufficient-credits"
      >
        <p className="border-border bg-surface-2 flex items-center justify-between rounded-md border p-3 text-sm">
          <span className="text-muted">{covered ? tm('covered') : t('missing')}</span>
          <CreditAmount value={missing > 0n ? missing : 0n} label={tc('credits')} size="lg" />
        </p>
        {/* Mandated order (analisi/05 §7.6). Before the gate opens the paid options are not even teased. */}
        <ul className="mt-4 flex flex-col gap-2">
          <li>
            <Button asChild variant="primary" size="lg" className="w-full justify-start">
              <Link href="/game" onClick={onClose}>
                <Siren className="size-5" aria-hidden />
                {t('keepPlaying')}
              </Link>
            </Button>
          </li>
          {adsOn ? (
            <li>
              <WatchAdOption />
            </li>
          ) : unlocked ? (
            <li>
              <Button variant="secondary" size="lg" className="w-full justify-start" disabled>
                <PlayCircle className="size-5" aria-hidden />
                {t('watchAd')}
                <span className="text-muted ml-auto text-xs font-normal">{tm('notAvailable')}</span>
              </Button>
            </li>
          ) : null}
          {shopOn ? (
            <li>
              <Button asChild variant="secondary" size="lg" className="w-full justify-start">
                <Link
                  href="/game/credits"
                  onClick={() => {
                    track('credit_shop_opened', { source: 'insufficient_credits' });
                    onClose();
                  }}
                >
                  <ShoppingBag className="size-5" aria-hidden />
                  {t('buyCredits')}
                </Link>
              </Button>
            </li>
          ) : unlocked ? (
            <li>
              <Button variant="secondary" size="lg" className="w-full justify-start" disabled>
                <ShoppingBag className="size-5" aria-hidden />
                {t('buyCredits')}
                <span className="text-muted ml-auto text-xs font-normal">{tm('notAvailable')}</span>
              </Button>
            </li>
          ) : null}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Not enough credits": keep playing → rewarded video → buy credits, in this order (analisi/05 §7.6).
 * Also hosts the simulated rewarded-video player so the flow works from anywhere inside the game layout.
 */
export function InsufficientCreditsHost() {
  const price = useInsufficientCredits((s) => s.price);
  const onClose = useInsufficientCredits((s) => s.close);
  return (
    <>
      {price !== null ? <InsufficientCreditsDialog price={price} onClose={onClose} /> : null}
      <SimulatedAdPlayerHost />
    </>
  );
}
