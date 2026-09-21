'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Clock, Hexagon, MinusCircle } from 'lucide-react';
import type { ServiceFamily } from '@/contracts';
import { formatAmount, formatDateTime, formatPercent, parseAmount } from '@/lib/format';
import { track } from '@/lib/analytics';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useUiStore } from '@/stores/ui';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, ProgressBar, SectionTitle, Skeleton, Stat } from '@/components/ui/misc';
import { useSnapshot } from '@/features/game/hooks';
import { CoachMark } from '@/features/coaching/coach-mark';
import { durationParts, useAt, useCoverage, useStipend } from './use-world';

const HISTORY_PREVIEW = 4;

function useDuration() {
  const t = useTranslations('world.duration');
  return (seconds: number) => {
    const { h, m } = durationParts(seconds);
    return h > 0 && m > 0 ? t('hoursMinutes', { h, m }) : h > 0 ? t('hours', { h }) : t('minutes', { m });
  };
}
const multiplier = (value: number, locale: string) =>
  `× ${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value)}`;

/** Economy page: the coverage stipend — next payout, how it is computed, coverage by family, history. */
export function StipendCard() {
  const t = useTranslations('world.stipend');
  const tc = useTranslations('common');
  const tcs = useTranslations('coaching.marks.coverageStipend');
  const locale = useLocale();
  const router = useRouter();
  const duration = useDuration();
  const name = useCatalogName();
  const { career } = useSnapshot();
  const stipend = useStipend();
  const coverage = useCoverage().data;
  const [allHistory, setAllHistory] = React.useState(false);
  const data = stipend.data;
  // The payout is a server-side scheduled action: when its time passes, read the card again.
  useAt(data?.nextPayoutAt, () => void stipend.refetch());

  const openCoverage = () => {
    useUiStore.getState().setMapLayer('coverage', true);
    track('coverage_layer_opened', { source: 'stipend_card' });
    router.push('/game');
  };

  if (stipend.isLoading)
    return (
      <Card>
        <SectionTitle>{t('title')}</SectionTitle>
        <Skeleton className="h-48" />
      </Card>
    );
  if (!data)
    return (
      <Card data-testid="stipend-card">
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="text-muted text-sm">{t('unavailable')}</p>
      </Card>
    );

  const e = data.estimate;
  const coveragePct = data.coveragePct ?? career.coveragePct ?? 0;
  const history = data.history ?? [];
  const shown = allHistory ? history : history.slice(0, HISTORY_PREVIEW);
  const rows: { key: string; label: string; value: React.ReactNode }[] = [
    { key: 'base', label: t('base', { level: career.level }), value: formatAmount(e.base, locale) },
    {
      key: 'coverage',
      label: t('coverageMultiplier', { pct: formatPercent(coveragePct / 100, locale) }),
      value: multiplier(e.coverageMultiplier, locale),
    },
    {
      key: 'reputation',
      label: t('reputationMultiplier', { value: Math.round(career.reputation) }),
      value: multiplier(e.reputationMultiplier, locale),
    },
    ...(data.bonusMultiplier !== undefined && data.bonusMultiplier !== 1
      ? [{ key: 'bonus', label: t('bonusMultiplier'), value: multiplier(data.bonusMultiplier, locale) }]
      : []),
    {
      key: 'personnel',
      label: t('personnelCost'),
      value: <CreditAmount value={-parseAmount(e.personnelCost)} sign label={tc('credits')} />,
    },
  ];

  return (
    <Card className="flex flex-col gap-4" data-testid="stipend-card">
      <CoachMark
        id="coverageStipend"
        when
        // The card's own title, not the whole (long) card: it holds the countdown, the breakdown, coverage by
        // family and history below — spotlighting all of it would let the coach mark's card cover those controls.
        selector='[data-testid="stipend-card"] h2'
        title={tcs('title')}
        body={tcs('body')}
      />
      <div>
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="text-muted text-sm">
          {t('hint', {
            period: duration(data.periodSeconds),
            cap: duration(data.periodSeconds * data.maxAccruedPeriods),
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label={t('next')}
          value={
            <Countdown
              to={data.nextPayoutAt}
              doneLabel={t('paying')}
              prefix={<Clock className="size-4" aria-hidden />}
            />
          }
        />
        <Stat
          label={t('estimate')}
          value={
            <span data-testid="stipend-net">
              <CreditAmount value={e.net} label={tc('credits')} />
            </span>
          }
        />
        <Stat label={t('period')} value={duration(data.periodSeconds)} />
        <Stat
          label={t('accrued')}
          value={t('accruedValue', { n: data.accruedPeriods, max: data.maxAccruedPeriods })}
        />
      </div>
      {data.accrualStopsAt ? (
        <p className="text-muted -mt-2 text-xs" data-testid="stipend-accrual-stop">
          {t('accrualStops', { date: formatDateTime(data.accrualStopsAt, locale, career.timezone) })}
        </p>
      ) : null}

      <section aria-label={t('breakdown')}>
        <SectionTitle>{t('breakdown')}</SectionTitle>
        <dl className="flex flex-col text-sm" data-testid="stipend-breakdown">
          {rows.map((r) => (
            <div
              key={r.key}
              className="border-border flex items-center justify-between gap-3 border-b py-1.5"
            >
              <dt className="text-muted min-w-0">{r.label}</dt>
              <dd className="tabular shrink-0 font-semibold" data-testid={`stipend-row-${r.key}`}>
                {r.value}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-2">
            <dt className="font-semibold">{t('net')}</dt>
            <dd className="shrink-0">
              <CreditAmount value={e.net} label={tc('credits')} size="lg" />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label={t('coverage')}>
        <SectionTitle
          action={
            <Button variant="link" size="sm" onClick={openCoverage} data-testid="stipend-open-coverage">
              <Hexagon className="size-4" aria-hidden />
              {t('showCoverage')}
            </Button>
          }
        >
          {t('coverage')}
        </SectionTitle>
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">{t('overall')}</span>
              <span className="tabular font-semibold" data-testid="stipend-coverage">
                {formatPercent(coveragePct / 100, locale)}
              </span>
            </div>
            <ProgressBar value={coveragePct / 100} label={t('overall')} tone="success" className="mt-1" />
          </div>
          {(coverage?.byFamily ?? [])
            .filter((f) => career.unlockedFamilies.includes(f.family))
            .map((f) => (
              <div key={f.family} data-testid="stipend-family" data-family={f.family}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <FamilyBadge family={f.family as ServiceFamily} size={20} />
                    <span className="truncate">{name('family', f.family)}</span>
                  </span>
                  <span className="tabular text-muted shrink-0 text-xs">
                    {f.thresholdSeconds
                      ? `${t('threshold', { minutes: Math.round(f.thresholdSeconds / 60) })} · `
                      : null}
                    <span className="text-fg text-sm font-semibold">
                      {formatPercent(f.pct / 100, locale)}
                    </span>
                  </span>
                </div>
                <ProgressBar
                  value={f.pct / 100}
                  label={name('family', f.family)}
                  tone="info"
                  className="mt-1"
                />
                {f.active === false ? (
                  <p className="text-warning mt-0.5 text-xs">{t('familyInactive')}</p>
                ) : null}
              </div>
            ))}
          {coverage?.stale ? <p className="text-warning text-xs">{t('stale')}</p> : null}
        </div>
      </section>

      <section aria-label={t('history')}>
        <SectionTitle>{t('history')}</SectionTitle>
        <p className="text-sm" data-testid="stipend-last">
          <span className="text-muted">{t('lastPayout')}: </span>
          {data.lastPayout ? (
            <>
              <CreditAmount value={data.lastPayout.net} sign label={tc('credits')} />{' '}
              <span className="text-muted text-xs">
                · {formatDateTime(data.lastPayout.at, locale, career.timezone)}
              </span>
            </>
          ) : (
            <span>{t('never')}</span>
          )}
        </p>
        {history.length > 0 ? (
          <ul className="mt-2 flex flex-col" data-testid="stipend-history">
            {shown.map((h) => (
              <li
                key={h.periodKey}
                className="border-border flex items-center justify-between gap-2 border-t py-1.5 text-sm"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="tabular text-muted text-xs">
                    {formatDateTime(h.at, locale, career.timezone)}
                  </span>
                  <span className="text-muted tabular text-xs">
                    {formatPercent(h.coveragePct / 100, locale)} · {multiplier(h.coverageMultiplier, locale)}{' '}
                    · {multiplier(h.reputationMultiplier, locale)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={h.status === 'PAID' ? 'success' : 'neutral'}>
                    {h.status === 'PAID' ? (
                      <CheckCircle2 className="size-3" aria-hidden />
                    ) : (
                      <MinusCircle className="size-3" aria-hidden />
                    )}
                    {t(`status.${h.status}`)}
                  </Badge>
                  <CreditAmount value={h.net} sign label={tc('credits')} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {history.length > HISTORY_PREVIEW ? (
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAllHistory((v) => !v)}>
            {allHistory ? t('showLess') : t('showAll', { count: history.length })}
          </Button>
        ) : null}
      </section>
    </Card>
  );
}
