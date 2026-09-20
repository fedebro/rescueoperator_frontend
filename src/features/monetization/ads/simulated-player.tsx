'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clapperboard, PauseCircle } from 'lucide-react';
import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { ProgressBar } from '@/components/ui/misc';
import {
  registerRewardedAdProvider,
  type RewardedAdConfig,
  type RewardedAdOutcome,
  type RewardedAdProvider,
} from './provider';

export const SIMULATED_PROVIDER_ID = 'simulated';
const TICK_MS = 100;

interface PlayerState {
  session: { config: RewardedAdConfig; resolve: (outcome: RewardedAdOutcome) => void } | null;
  /** The player UI is mounted (game layout). Without it the provider reports itself unavailable. */
  hostMounted: boolean;
}
const usePlayer = create<PlayerState>(() => ({ session: null, hostMounted: false }));

/** Provider `simulated`: no ad network, a modal "video" with the same contract as a real SDK (complete / abandon). */
export const simulatedAdProvider: RewardedAdProvider = {
  id: SIMULATED_PROVIDER_ID,
  isAvailable: () => usePlayer.getState().hostMounted,
  show: (config) =>
    new Promise<RewardedAdOutcome>((resolve) => {
      usePlayer.getState().session?.resolve({ completed: false });
      usePlayer.setState({ session: { config, resolve } });
    }),
};
registerRewardedAdProvider(simulatedAdProvider);

/**
 * Watch-time accumulator: counts only while the tab is visible (a hidden tab pauses the "video"), so the reward can
 * never be claimed before `minWatchSeconds` of actual viewing.
 */
export function useWatchProgress(minWatchSeconds: number, active: boolean) {
  const [watchedMs, setWatchedMs] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    const onVisibility = () => setPaused(document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    // Ticks are counted instead of reading a clock: timers can fire late but never early, so sleep, clock changes or
    // background throttling can only under-count the watched time.
    const timer = setInterval(() => {
      if (!document.hidden) setWatchedMs((w) => w + TICK_MS);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);
  const totalMs = minWatchSeconds * 1000;
  return { ratio: Math.min(1, watchedMs / totalMs), done: watchedMs >= totalMs, paused, watchedMs };
}

function Player({ config, onEnd }: { config: RewardedAdConfig; onEnd: (o: RewardedAdOutcome) => void }) {
  const t = useTranslations('monetization.ads.player');
  const { ratio, done, paused, watchedMs } = useWatchProgress(config.minWatchSeconds, true);
  const remaining = Math.max(0, Math.ceil(config.minWatchSeconds - watchedMs / 1000));
  React.useEffect(() => {
    if (done) onEnd({ completed: true, proof: `simulated:${config.adToken}` });
  }, [done, onEnd, config.adToken]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onEnd({ completed: false });
      }}
    >
      <DialogContent
        title={t('title')}
        description={t('simulated')}
        closeLabel={t('abandon')}
        hideClose
        data-testid="ad-player"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div
          aria-hidden
          className="border-border bg-surface-2 text-subtle grid aspect-video place-items-center rounded-md border"
        >
          {paused ? <PauseCircle className="size-12" /> : <Clapperboard className="size-12" />}
        </div>
        <ProgressBar value={ratio} label={t('progress')} tone="info" className="mt-4" showValue />
        <p className="text-muted mt-2 text-sm" aria-live="polite">
          {paused ? t('paused') : t('remaining', { seconds: remaining })}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onEnd({ completed: false })}>
            {t('abandon')}
          </Button>
        </DialogFooter>
        <p className="text-subtle mt-2 text-xs">{t('abandonHint')}</p>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once by the game layout (through `InsufficientCreditsHost`). */
export function SimulatedAdPlayerHost() {
  const session = usePlayer((s) => s.session);
  React.useEffect(() => {
    usePlayer.setState({ hostMounted: true });
    return () => {
      usePlayer.getState().session?.resolve({ completed: false });
      usePlayer.setState({ hostMounted: false, session: null });
    };
  }, []);
  const onEnd = React.useCallback((outcome: RewardedAdOutcome) => {
    const current = usePlayer.getState().session;
    usePlayer.setState({ session: null });
    current?.resolve(outcome);
  }, []);
  return session ? <Player key={session.config.adToken} config={session.config} onEnd={onEnd} /> : null;
}
