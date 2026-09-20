'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { monetizationApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { formatAmount } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useServerNow } from '@/hooks/use-server-now';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { useMonetizationUnlocked } from '../gate';
import { getRewardedAdProvider } from './provider';

export type AdBlockReason = 'DISABLED' | 'LIMIT' | 'COOLDOWN' | null;

/** Status of the rewarded video + the whole watch flow (start → provider → complete). Shared by the card and the dialog. */
export function useRewardedAd() {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const t = useTranslations('monetization.ads');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const unlocked = useMonetizationUnlocked();
  const { featureFlags } = useSnapshot();
  const visible = unlocked && featureFlags.rewardedAds === true;
  const statusQuery = useQuery({
    queryKey: qk.adsStatus(careerId),
    queryFn: () => monetizationApi.adsStatus(careerId),
    enabled: visible,
  });
  const status = statusQuery.data;
  const [watching, setWatching] = React.useState(false);
  // Server clock: the cooldown ends without polling the status.
  const now = useServerNow(1000, !!status?.nextAvailableAt);

  const blocked: AdBlockReason = !status
    ? null
    : !status.enabled
      ? 'DISABLED'
      : status.watchedToday >= status.dailyLimit
        ? 'LIMIT'
        : status.nextAvailableAt && Date.parse(status.nextAvailableAt) > now
          ? 'COOLDOWN'
          : null;

  const watch = React.useCallback(
    async (source: string): Promise<boolean> => {
      if (watching) return false;
      setWatching(true);
      try {
        const start = await monetizationApi.adStart(careerId);
        const provider = getRewardedAdProvider(start.provider);
        if (!provider || !(await provider.isAvailable())) {
          toast({ tone: 'warning', title: t('unavailable') });
          return false;
        }
        track('rewarded_ad_started', { source, provider: start.provider });
        const outcome = await provider.show({
          adToken: start.adToken,
          minWatchSeconds: start.minWatchSeconds,
          providerConfig: start.providerConfig,
        });
        if (!outcome.completed) {
          track('rewarded_ad_abandoned', { source });
          toast({ tone: 'info', title: t('abandoned') });
          return false;
        }
        const result = await monetizationApi.adComplete(careerId, {
          adToken: start.adToken,
          providerProof: outcome.proof,
        });
        qc.setQueryData(qk.adsStatus(careerId), result.status);
        track('rewarded_ad_completed', { source, credited: Number(result.credited) });
        toast({ tone: 'success', title: t('credited', { credits: formatAmount(result.credited, locale) }) });
        return true;
      } catch (e) {
        toast({ tone: 'danger', title: errorMessage(e) });
        void qc.invalidateQueries({ queryKey: qk.adsStatus(careerId) });
        return false;
      } finally {
        setWatching(false);
      }
    },
    [watching, careerId, qc, t, errorMessage, locale],
  );

  return { visible, status, loading: statusQuery.isLoading, blocked, watching, watch };
}
