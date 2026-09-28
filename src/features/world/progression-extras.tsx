'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Award, CheckCircle2, Circle, TrendingDown, TrendingUp } from 'lucide-react';
import type { MilestoneDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { compareAmount, formatAmount, formatDateTime, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { Badge } from '@/components/ui/badge';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Card, EmptyState, ProgressBar, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { useMilestones, useStipend } from './use-world';

/* ───────────────────────────── milestones ───────────────────────────── */

const KNOWN_PHASES = ['FIRST_HOURS', 'EARLY', 'MID', 'LATE'] as const;
type KnownPhase = (typeof KNOWN_PHASES)[number];
const isKnownPhase = (phase: string): phase is KnownPhase =>
  (KNOWN_PHASES as readonly string[]).includes(phase);

/** Fractions (coverage 0.5 = 50 %) are shown as percentages, counters as "3 di 10". */
const isFraction = (m: MilestoneDto): boolean => m.progress.target > 0 && m.progress.target < 1;

export function groupByPhase(milestones: readonly MilestoneDto[]): [string, MilestoneDto[]][] {
  const groups = new Map<string, MilestoneDto[]>();
  for (const m of [...milestones].sort((a, b) => a.order - b.order))
    groups.set(m.phase, [...(groups.get(m.phase) ?? []), m]);
  return [...groups.entries()];
}

export function MilestonesCard() {
  const t = useTranslations('world.milestones');
  const { data, isLoading } = useMilestones();
  const groups = React.useMemo(() => groupByPhase(data ?? []), [data]);
  // The phase the player is working on is open; finished and future phases are one tap away.
  const current = groups.find(([, list]) => list.some((m) => !m.achieved))?.[0] ?? groups.at(-1)?.[0];
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const done = (data ?? []).filter((m) => m.achieved).length;

  return (
    <Card className="flex flex-col gap-3" data-testid="milestones-card">
      <SectionTitle
        action={
          data ? (
            <span className="tabular text-muted text-xs" data-testid="milestones-summary">
              {t('summary', { done, total: data.length })}
            </span>
          ) : null
        }
      >
        {t('title')}
      </SectionTitle>
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : groups.length === 0 ? (
        <EmptyState icon={<Award className="size-6" />} title={t('empty')} />
      ) : (
        groups.map(([phase, list]) => {
          const open = expanded[phase] ?? phase === current;
          const achieved = list.filter((m) => m.achieved).length;
          const panelId = `milestones-${phase}`;
          return (
            <section key={phase} data-testid="milestone-phase" data-phase={phase}>
              <h4>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setExpanded((s) => ({ ...s, [phase]: !open }))}
                  className="hover:bg-surface-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-1 text-left text-sm font-semibold lg:min-h-10"
                >
                  <span>{isKnownPhase(phase) ? t(`phase.${phase}`) : phase}</span>
                  <span className="tabular text-muted text-xs">
                    {t('phaseCount', { done: achieved, total: list.length })}
                  </span>
                </button>
              </h4>
              {open ? (
                <ul id={panelId} className="mt-1 flex flex-col gap-2">
                  {list.map((m) => (
                    <MilestoneRow key={m.code} milestone={m} />
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })
      )}
    </Card>
  );
}

function MilestoneRow({ milestone: m }: { milestone: MilestoneDto }) {
  const t = useTranslations('world.milestones');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const { career } = useSnapshot();
  const title = tx(m.title);
  const ratio = m.progress.target > 0 ? m.progress.current / m.progress.target : 0;
  const progressText = isFraction(m)
    ? t('progressPercent', {
        current: formatPercent(m.progress.current, locale),
        target: formatPercent(m.progress.target, locale),
      })
    : t('progress', { current: Math.floor(m.progress.current), target: m.progress.target });

  return (
    <li
      className={cn(
        'bg-surface-2 border-border flex gap-2.5 rounded-md border p-2.5',
        m.achieved && 'border-success/40',
      )}
      data-testid="milestone"
      data-code={m.code}
      data-achieved={m.achieved}
    >
      {m.achieved ? (
        <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" aria-hidden />
      ) : (
        <Circle className="text-subtle mt-0.5 size-5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted text-xs">{tx(m.description)}</p>
        {m.achieved ? (
          <p className="text-success mt-1 text-xs font-semibold">
            {m.achievedAt
              ? t('achievedOn', { date: formatDateTime(m.achievedAt, locale, career.timezone) })
              : t('achieved')}
          </p>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar value={ratio} label={t('progressLabel', { title })} tone="xp" className="flex-1" />
            <span className="tabular text-muted shrink-0 text-xs">{progressText}</span>
          </div>
        )}
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-subtle">{t('reward')}</span>
          {compareAmount(m.rewardCredits, 0n) > 0 ? (
            <CreditAmount value={m.rewardCredits} label={tc('credits')} size="sm" />
          ) : null}
          {compareAmount(m.rewardXp, 0n) > 0 ? (
            <Badge tone="xp">{t('xp', { xp: formatAmount(m.rewardXp, locale) })}</Badge>
          ) : null}
        </p>
      </div>
    </li>
  );
}

/* ───────────────────────────── reputation ───────────────────────────── */

export const REPUTATION_BANDS = [
  { code: 'CRITICAL', from: 0, to: 24 },
  { code: 'LOW', from: 25, to: 49 },
  { code: 'FAIR', from: 50, to: 69 },
  { code: 'GOOD', from: 70, to: 84 },
  { code: 'EXCELLENT', from: 85, to: 100 },
] as const;
export type ReputationBand = (typeof REPUTATION_BANDS)[number]['code'];
export const reputationBand = (value: number): (typeof REPUTATION_BANDS)[number] => {
  const v = Math.min(100, Math.max(0, Math.round(value)));
  return REPUTATION_BANDS.find((b) => v >= b.from && v <= b.to) ?? REPUTATION_BANDS[0];
};
const BAND_TONE: Record<ReputationBand, 'danger' | 'warning' | 'info' | 'success'> = {
  CRITICAL: 'danger',
  LOW: 'warning',
  FAIR: 'info',
  GOOD: 'success',
  EXCELLENT: 'success',
};
const UP_FACTORS = ['fast', 'adequate', 'patients'] as const;
const DOWN_FACTORS = ['expired', 'failed', 'under'] as const;

export function ReputationCard() {
  const t = useTranslations('world.reputation');
  const tx = useI18nText();
  const locale = useLocale();
  const careerId = useCareerId();
  const { career } = useSnapshot();
  const stipend = useStipend().data;
  const progression = useQuery({
    queryKey: [...qk.progression(careerId), career.xp],
    queryFn: () => gameApi.progression(careerId),
  }).data;
  const value = Math.min(100, Math.max(0, Math.round(career.reputation)));
  const band = reputationBand(value);

  return (
    <Card className="flex flex-col gap-4" data-testid="reputation-card">
      <SectionTitle
        action={
          progression?.rank ? (
            <Badge tone="brand" data-testid="career-rank">
              <Award className="size-3" aria-hidden />
              {t('rank', { rank: tx(progression.rank.name) })}
            </Badge>
          ) : null
        }
      >
        {t('title')}
      </SectionTitle>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display tabular text-3xl font-bold" data-testid="reputation-value">
            {value}
            <span className="text-muted text-base font-semibold"> / 100</span>
          </p>
          <Badge tone={BAND_TONE[band.code]} data-testid="reputation-band">
            {t(`band.${band.code}`)}
          </Badge>
        </div>
        {/* Gauge: one segment per band with its numeric range, and a marker at the current value. */}
        <div
          role="meter"
          aria-label={t('title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={t('valueText', { value, band: t(`band.${band.code}`) })}
          className="relative mt-3"
        >
          <div className="flex h-2.5 gap-0.5">
            {REPUTATION_BANDS.map((b) => (
              <span
                key={b.code}
                className={cn('rounded-full', b.code === band.code ? 'bg-fg' : 'bg-surface-4')}
                style={{ width: `${b.to - b.from + 1}%` }}
              />
            ))}
          </div>
          <span
            aria-hidden
            className="border-surface-1 bg-brand absolute -top-1 h-4.5 w-1.5 -translate-x-1/2 rounded-full border"
            style={{ left: `${value}%` }}
          />
          <div className="mt-1 flex gap-0.5" aria-hidden>
            {REPUTATION_BANDS.map((b) => (
              <span
                key={b.code}
                className={cn(
                  'truncate text-center text-xs leading-tight',
                  b.code === band.code ? 'text-fg font-semibold' : 'text-subtle',
                )}
                style={{ width: `${b.to - b.from + 1}%` }}
              >
                <span className="tabular block">
                  {b.from}–{b.to}
                </span>
                <span className="hidden sm:block">{t(`band.${b.code}`)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-surface-2 border-border flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm">
        <span className="text-muted">{t('multiplier')}</span>
        <span className="tabular font-semibold" data-testid="reputation-multiplier">
          {stipend
            ? `× ${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(stipend.estimate.reputationMultiplier)}`
            : '—'}
        </span>
      </div>
      <p className="text-muted -mt-2 text-xs">{t('effects')}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <FactorList
          icon={<TrendingUp className="text-success size-4" aria-hidden />}
          title={t('up')}
          items={UP_FACTORS.map((k) => t(`upItems.${k}`))}
        />
        <FactorList
          icon={<TrendingDown className="text-danger size-4" aria-hidden />}
          title={t('down')}
          items={DOWN_FACTORS.map((k) => t(`downItems.${k}`))}
        />
      </div>
    </Card>
  );
}

function FactorList({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
        {icon}
        {title}
      </p>
      <ul className="text-muted list-disc pl-5 text-xs">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
