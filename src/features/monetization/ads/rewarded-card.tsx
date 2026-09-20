'use client';
import { useLocale, useTranslations } from 'next-intl';
import { Ban, CheckCircle2, Hourglass, PlayCircle } from 'lucide-react';
import { formatTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useRewardedAd, type AdBlockReason } from './use-rewarded-ad';

/** Why the video cannot be started right now — icon + label, never colour alone. */
export function AdBlockNotice({
  reason,
  nextAvailableAt,
  resetsAt,
}: {
  reason: AdBlockReason;
  nextAvailableAt: string | null;
  resetsAt: string;
}) {
  const t = useTranslations('monetization.ads');
  const locale = useLocale();
  if (!reason) return null;
  return (
    <p className="text-muted flex items-center gap-1.5 text-xs" data-testid="ad-blocked" data-reason={reason}>
      {reason === 'COOLDOWN' ? (
        <>
          <Hourglass className="size-3.5 shrink-0" aria-hidden />
          {t('cooldown')} <Countdown to={nextAvailableAt} className="text-fg" />
        </>
      ) : reason === 'LIMIT' ? (
        <>
          <Ban className="size-3.5 shrink-0" aria-hidden />
          {t('limitReached', { time: formatTime(resetsAt, locale) })}
        </>
      ) : (
        <>
          <Ban className="size-3.5 shrink-0" aria-hidden />
          {t('disabled')}
        </>
      )}
    </p>
  );
}

/** Rewarded-video status card (credits page). Renders nothing while monetization is gated or the flag is off. */
export function RewardedAdCard({ source = 'credits_page' }: { source?: string }) {
  const t = useTranslations('monetization.ads');
  const tc = useTranslations('common');
  const { visible, status, loading, blocked, watching, watch } = useRewardedAd();
  if (!visible) return null;
  return (
    <Card className="flex flex-col gap-3" data-testid="rewarded-card">
      <SectionTitle
        action={
          status?.enabled ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3" aria-hidden />
              {t('active')}
            </Badge>
          ) : null
        }
      >
        {t('title')}
      </SectionTitle>
      {loading || !status ? (
        <Skeleton className="h-20" />
      ) : (
        <>
          <p className="text-muted text-sm">{t('description')}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              {t('reward')} <CreditAmount value={status.reward} sign label={tc('credits')} />
            </span>
            <span className="tabular text-sm" data-testid="ads-watched">
              {t('watchedToday', { watched: status.watchedToday, limit: status.dailyLimit })}
            </span>
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="w-full sm:w-auto sm:self-start"
            disabled={blocked !== null}
            loading={watching}
            onClick={() => void watch(source)}
            data-testid="watch-ad"
          >
            <PlayCircle className="size-5" aria-hidden />
            {t('watch')}
          </Button>
          <AdBlockNotice
            reason={blocked}
            nextAvailableAt={status.nextAvailableAt}
            resetsAt={status.resetsAt}
          />
        </>
      )}
    </Card>
  );
}
