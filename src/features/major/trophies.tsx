'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight, Lock, Medal } from 'lucide-react';
import type { MajorMedal, MajorTrophyDto } from '@/contracts';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { GameIcon, majorIconName } from '@/design/icons';
import { Card, SectionTitle, Skeleton } from '@/components/ui/misc';
import { CreditAmount } from '@/components/ui/credit-amount';
import { useMajorHistory, useMajorTrophies, useOpenMajor } from './hooks';
import { percent } from './major';

const MEDAL_TONE: Record<MajorMedal, string> = {
  GOLD: 'text-credits border-credits/60 bg-credits/10',
  SILVER: 'text-silver border-silver/60 bg-silver/10',
  BRONZE: 'text-warning border-warning/60 bg-warning/10',
};

/** One scenario of the catalog: its medal (or none yet), how many were handled. */
function TrophyTile({ trophy }: { trophy: MajorTrophyDto }) {
  const t = useTranslations('maxi.trophies');
  const tx = useI18nText();
  const won = trophy.medal !== null;
  return (
    <li
      className={cn(
        'border-border bg-surface-2 flex min-h-24 flex-col gap-1.5 rounded-md border p-2.5',
        !won && 'opacity-75',
      )}
      data-testid="major-trophy"
      data-scenario={trophy.scenarioCode}
      data-medal={trophy.medal ?? ''}
    >
      <span className="flex items-center gap-2">
        <span className="bg-surface-3 text-fg grid size-8 shrink-0 place-items-center rounded-md">
          <GameIcon name={majorIconName(trophy.icon)} size={18} />
        </span>
        {won ? (
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-bold',
              MEDAL_TONE[trophy.medal!],
            )}
          >
            <Medal className="size-3.5" aria-hidden />
            {tx({ key: `major.medal.${trophy.medal}.name` })}
          </span>
        ) : (
          <span className="text-subtle text-xs">{t('none')}</span>
        )}
      </span>
      <span className="text-fg line-clamp-2 text-sm leading-snug font-semibold">{tx(trophy.title)}</span>
      {trophy.attempts > 0 ? (
        <span className="text-muted text-xs">
          {t('handled', { handled: trophy.handled, attempts: trophy.attempts })}
          {trophy.bestQuality !== null ? ` · ${t('best', { percent: percent(trophy.bestQuality) })}` : ''}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The career's major incidents (06 §2.5 "un riconoscimento per ogni tipo di maxi gestita"): a medal per scenario of the
 * catalog, won or not, and the last majors with their outcome and bonus (a tap opens the summary).
 */
export function MajorTrophiesCard() {
  const t = useTranslations('maxi.trophies');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const trophies = useMajorTrophies();
  const unlocked = trophies.data?.unlocked ?? false;
  const history = useMajorHistory(5, unlocked);
  const openMajor = useOpenMajor();
  const data = trophies.data;
  return (
    <Card className="flex flex-col gap-3" data-testid="major-trophies">
      <SectionTitle
        className="mb-0"
        action={
          data && unlocked ? (
            <span className="text-muted text-xs" data-testid="major-trophies-handled">
              {t('total', { count: data.handled })}
            </span>
          ) : null
        }
      >
        {t('title')}
      </SectionTitle>
      {!data ? (
        <Skeleton className="h-32" />
      ) : !unlocked ? (
        <p className="text-muted flex items-start gap-2 text-sm" data-testid="major-trophies-locked">
          <Lock className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {tx({ key: 'major.common.teaser' })}{' '}
            <span className="text-subtle">({t('locked', { level: data.minLevel })})</span>
          </span>
        </p>
      ) : (
        <>
          <p className="text-muted text-xs">{t('subtitle')}</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.trophies.map((trophy) => (
              <TrophyTile key={trophy.scenarioCode} trophy={trophy} />
            ))}
          </ul>
          {history.data && history.data.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <SectionTitle className="mt-1 mb-0" level={3}>
                {t('history')}
              </SectionTitle>
              <ul className="flex flex-col gap-1.5">
                {history.data.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => openMajor(m.id, m.center)}
                      className="border-border bg-surface-2 hover:bg-surface-3 flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm"
                      data-testid="major-history-row"
                      data-status={m.status}
                    >
                      <GameIcon name={majorIconName(m.icon)} size={18} className="text-muted shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{tx(m.title)}</span>
                        <span className="text-subtle block truncate text-xs">
                          {m.status === 'ACTIVE'
                            ? tx({ key: `major.phase.${m.phase}.name` })
                            : tx({ key: `major.outcome.${m.outcome ?? 'SUCCESS'}` })}{' '}
                          · {formatDateTime(m.startedAt, locale)}
                        </span>
                      </span>
                      {m.reward.credits && m.reward.credits !== '0' ? (
                        <CreditAmount value={m.reward.credits} sign label={tc('credits')} />
                      ) : null}
                      <ChevronRight className="text-muted size-4 shrink-0" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
