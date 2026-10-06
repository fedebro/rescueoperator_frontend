'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Trophy } from 'lucide-react';
import type { AllianceRankingEntryDto } from '@/contracts';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { Card, EmptyState, SectionTitle, Skeleton, Stat } from '@/components/ui/misc';
import { Emblem } from './emblem';
import { useRanking } from './hooks';

function RankingRow({ entry }: { entry: AllianceRankingEntryDto }) {
  const t = useTranslations('alliance.ranking');
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-2',
        entry.isMine && 'bg-brand/10 ring-brand/40 ring-1',
      )}
      data-testid="ranking-row"
      data-position={entry.position}
      data-mine={entry.isMine}
    >
      <span
        className={cn(
          'tabular w-7 shrink-0 text-center font-bold',
          entry.position > 0 && entry.position <= 3 ? 'text-xp' : 'text-muted',
        )}
      >
        {entry.position > 0 ? entry.position : '—'}
      </span>
      <Emblem emblem={entry.alliance.emblem} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {entry.alliance.name} <span className="text-muted font-mono text-xs">[{entry.alliance.tag}]</span>
        </span>
        <span className="text-muted block text-xs">
          {t('level', { level: entry.alliance.level })} · {t('scoring', { count: entry.scoringMembers })}
        </span>
      </span>
      <span className="tabular shrink-0 text-sm font-semibold" data-testid="ranking-score">
        {entry.score}
      </span>
    </li>
  );
}

/** Classifica (study 06 §3): the weekly top 20, my alliance's place, who carried it, last week's frame. */
export function RankingTab() {
  const t = useTranslations('alliance.ranking');
  const locale = useLocale();
  const ranking = useRanking();
  if (ranking.isPending) return <Skeleton className="h-40" />;
  const data = ranking.data;
  if (!data) return <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />;
  if (!data.enabled)
    return (
      <div data-testid="ranking-disabled">
        <EmptyState title={t('disabledTitle')} description={t('disabledBody')} />
      </div>
    );
  const mine = data.mine;
  return (
    <div className="flex flex-col gap-4" data-testid="alliance-ranking">
      <Card className="flex flex-col gap-3">
        <SectionTitle>{t('title')}</SectionTitle>
        <p className="text-subtle text-xs">
          {t('week', {
            start: formatDateTime(data.week.start, locale),
            end: formatDateTime(data.week.end, locale),
          })}
          {' · '}
          {t('rollover')} <Countdown to={data.rolloverAt} doneLabel="0:00" className="tabular" />
        </p>
        <p className="text-muted text-xs">{t('how', { bestOf: data.bestOf, min: data.minScoringMembers })}</p>
        {mine ? (
          <div
            className="border-border bg-surface-2 grid grid-cols-3 gap-3 rounded-md border p-3"
            data-testid="ranking-mine"
            data-position={mine.position}
          >
            <Stat
              label={t('myPosition')}
              value={
                <span className="tabular">
                  {mine.position > 0 ? `#${mine.position}` : t('notRanked', { min: data.minScoringMembers })}
                </span>
              }
            />
            <Stat label={t('score')} value={<span className="tabular">{mine.score}</span>} />
            <Stat label={t('myPoints')} value={<span className="tabular">{data.myPoints}</span>} />
          </div>
        ) : null}
        {mine?.topContributors && mine.topContributors.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="ranking-top">
            <span className="text-muted">{t('topContributors')}</span>
            {mine.topContributors.map((c) => (
              <span
                key={c.careerId ?? c.directorName ?? 'x'}
                className="bg-surface-2 border-border rounded-full border px-2.5 py-0.5"
              >
                {c.directorName ?? t('deletedDirector')}{' '}
                <span className="tabular text-muted">{c.points}</span>
              </span>
            ))}
          </div>
        ) : null}
        {data.lastWeek ? (
          <p className="text-muted flex flex-wrap items-center gap-2 text-xs" data-testid="ranking-last-week">
            <Trophy className="text-xp size-4" aria-hidden />
            {t('lastWeek', {
              position: data.lastWeek.position,
              total: data.lastWeek.totalRanked,
              score: data.lastWeek.score,
            })}
            {data.lastWeek.frame ? <Badge tone="xp">{t(`frame.${data.lastWeek.frame}`)}</Badge> : null}
          </p>
        ) : null}
      </Card>
      <Card>
        <SectionTitle>{t('top', { count: data.entries.length })}</SectionTitle>
        {data.entries.length === 0 ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
        ) : (
          <ol className="flex flex-col" data-testid="ranking-list">
            {data.entries.map((e) => (
              <RankingRow key={e.alliance.id} entry={e} />
            ))}
            {mine && mine.position > data.entries.length ? (
              <>
                <li className="text-subtle py-1 text-center text-xs" aria-hidden>
                  …
                </li>
                <RankingRow entry={mine} />
              </>
            ) : null}
          </ol>
        )}
        <p className="text-subtle mt-2 text-xs">{t('privacy')}</p>
      </Card>
    </div>
  );
}
