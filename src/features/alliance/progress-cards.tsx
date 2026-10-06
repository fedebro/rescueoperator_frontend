'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { AllianceObjectiveDto, AllianceXpEntryDto } from '@/contracts';
import { formatAmount, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ProgressBar, Skeleton } from '@/components/ui/misc';
import { TimeAgo } from '@/components/ui/time-ago';
import { useAllianceXp, useObjectives } from './hooks';

/** The personal threshold of an objective's reward (06 §2: 5 % of the target or 3 — the smaller, at least 1). */
export function rewardThreshold(o: Pick<AllianceObjectiveDto, 'target' | 'reward'>): number {
  return Math.max(1, Math.min(Math.ceil(o.target * o.reward.minShare), o.reward.minCount));
}

export function ObjectiveRow({
  objective,
  onMember,
}: {
  objective: AllianceObjectiveDto;
  onMember?: (careerId: string) => void;
}) {
  const t = useTranslations('alliance.objectives');
  const tx = useI18nText();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const ratio = objective.target > 0 ? Math.min(1, objective.progress / objective.target) : 0;
  const threshold = rewardThreshold(objective);
  return (
    <li
      className="flex flex-col gap-1.5"
      data-testid="objective"
      data-type={objective.type}
      data-completed={objective.completed}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{tx(objective.title)}</span>
          <span className="text-muted block text-xs">{tx(objective.description)}</span>
        </span>
        {objective.completed ? (
          <Badge tone="success" data-testid="objective-done">
            {t('completed')}
          </Badge>
        ) : null}
      </div>
      <ProgressBar
        value={ratio}
        label={t('progressLabel', { progress: objective.progress, target: objective.target })}
        tone={objective.completed ? 'success' : 'brand'}
      />
      <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="tabular" data-testid="objective-progress">
          {objective.progress} / {objective.target}
        </span>
        <span data-testid="objective-mine">{t('mine', { value: objective.myContribution })}</span>
        <span
          className={cn(objective.myRewardEligible && 'text-success')}
          data-testid="objective-reward-state"
        >
          {objective.myRewardPaidAt
            ? t('paid')
            : objective.myRewardEligible
              ? t('eligible', { credits: formatAmount(objective.reward.memberCredits, locale) })
              : t('threshold', { count: threshold })}
        </span>
        <span>{t('reward', { xp: objective.reward.allianceXp })}</span>
        {objective.contributions.length > 0 ? (
          <button
            type="button"
            className="text-skyline ml-auto inline-flex items-center gap-1 hover:underline"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            data-testid="objective-contributions-toggle"
          >
            {t('contributions', { count: objective.contributions.length })}
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="flex flex-wrap gap-1.5" data-testid="objective-contributions">
          {objective.contributions.map((c) => (
            <li key={c.careerId ?? c.directorName ?? 'x'}>
              <button
                type="button"
                className="bg-surface-2 border-border hover:bg-surface-3 rounded-full border px-2.5 py-0.5 text-xs"
                onClick={() => c.careerId && onMember?.(c.careerId)}
              >
                {c.directorName ?? t('deletedDirector')} <span className="tabular text-muted">{c.value}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The body of the "Obiettivi della settimana" card (study 06 §2): three objectives, each with its contributions. */
export function ObjectivesSection({ onMember }: { onMember?: (careerId: string) => void }) {
  const t = useTranslations('alliance.objectives');
  const locale = useLocale();
  const objectives = useObjectives();
  if (objectives.isPending) return <Skeleton className="h-24" />;
  const data = objectives.data;
  if (!data || data.objectives.length === 0)
    return <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />;
  return (
    <div className="flex flex-col gap-3" data-testid="alliance-objectives">
      <p className="text-subtle text-xs">
        {t('week', {
          start: formatDateTime(data.week.start, locale),
          end: formatDateTime(data.week.end, locale),
        })}
        {data.lastWeek
          ? ` · ${t('lastWeek', { completed: data.lastWeek.completed, total: data.lastWeek.total })}`
          : ''}
      </p>
      <ul className="flex flex-col gap-4">
        {data.objectives.map((o) => (
          <ObjectiveRow key={o.id} objective={o} onMember={onMember} />
        ))}
      </ul>
      <p className="text-subtle text-xs">{t('sized', { count: data.activeMembersLastWeek })}</p>
    </div>
  );
}

function XpRow({ entry }: { entry: AllianceXpEntryDto }) {
  const t = useTranslations('alliance.xp');
  return (
    <li
      className="flex items-center gap-3 py-1.5 text-sm"
      data-testid="xp-entry"
      data-source={entry.source}
      data-capped={entry.capped}
    >
      <span className="min-w-0 flex-1">
        <span>{t(`source.${entry.source}`)}</span>
        {entry.member?.directorName ? (
          <span className="text-muted"> · {entry.member.directorName}</span>
        ) : null}
        {entry.capped ? <span className="text-warning text-xs"> · {t('capped')}</span> : null}
      </span>
      <TimeAgo at={entry.createdAt} className="text-subtle text-xs" />
      <span className={cn('tabular shrink-0 font-semibold', entry.points > 0 ? 'text-xp' : 'text-muted')}>
        +{entry.points}
      </span>
    </li>
  );
}

/** "Ultimi punti" (06 §1.1): where the alliance XP came from, newest first, with the weekly cap made visible. */
export function XpSection() {
  const t = useTranslations('alliance.xp');
  const xp = useAllianceXp();
  if (xp.isPending) return <Skeleton className="h-16" />;
  const entries = xp.data?.pages.flatMap((p) => p.data) ?? [];
  if (entries.length === 0) return <p className="text-muted text-sm">{t('empty')}</p>;
  return (
    <div className="flex flex-col gap-2" data-testid="alliance-xp">
      <ul className="divide-border divide-y">
        {entries.map((e) => (
          <XpRow key={e.id} entry={e} />
        ))}
      </ul>
      {xp.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={() => void xp.fetchNextPage()}
          loading={xp.isFetchingNextPage}
        >
          {t('more')}
        </Button>
      ) : null}
      <p className="text-subtle text-xs">{t('capHint')}</p>
    </div>
  );
}
