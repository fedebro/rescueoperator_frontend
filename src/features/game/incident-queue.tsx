'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CheckCircle2, LifeBuoy } from 'lucide-react';
import type { IncidentDto } from '@/contracts';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { GameIcon, categoryIconName } from '@/design/icons';
import { SeverityBadge, severityColor } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Countdown } from '@/components/ui/countdown';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { IncidentFamilies } from '@/features/families/family-chips';
import { useFamilies } from '@/features/families/use-families';
import { pickIdleSuggestion } from '@/features/coaching/idle-suggestion';
import { useIdleSuggestionCopy } from '@/features/coaching/idle-suggestion-copy';
import { SEVERITY_ORDER, useCatalog, useSnapshot } from './hooks';

export function IncidentCard({
  incident,
  selected,
  onSelect,
}: {
  incident: IncidentDto;
  selected: boolean;
  onSelect: (incident: IncidentDto) => void;
}) {
  const t = useTranslations('game.incident');
  const ts = useTranslations('status.incident');
  const tq = useTranslations('families.queue');
  const tx = useI18nText();
  const resolving = incident.status === 'RESOLVING';
  const workingUnits = (incident.externalSupport ?? []).filter(
    (u) => u.status === 'REQUESTED' || u.status === 'WORKING',
  ).length;
  const pending = incident.status === 'PENDING_RESPONSE';
  return (
    <button
      type="button"
      onClick={() => onSelect(incident)}
      aria-pressed={selected}
      data-testid="incident-card"
      data-incident-id={incident.id}
      data-status={incident.status}
      className={cn(
        'bg-surface-2 hover:bg-surface-3 relative flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
        selected ? 'border-focus' : 'border-border',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-1 rounded-r"
        style={{ background: severityColor(incident.severity) }}
      />
      <span className="bg-surface-3 text-fg relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-md">
        {pending ? (
          <span
            aria-hidden
            className="animate-pulse-ring absolute inset-0 rounded-md border-2"
            style={{ borderColor: severityColor(incident.severity) }}
          />
        ) : null}
        <GameIcon name={categoryIconName(incident.category)} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">{tx(incident.title)}</span>
          <SeverityBadge
            severity={incident.severity}
            label={t('severity')}
            escalating={incident.escalating}
            size="sm"
          />
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="text-muted min-w-0 flex-1 truncate text-xs">{incident.address}</span>
          <IncidentFamilies incident={incident} size={16} />
        </span>
        <span className="mt-1.5 flex items-center justify-between gap-2">
          <StatusChip status={incident.status} label={ts(incident.status)} />
          {resolving ? (
            <span className="text-info flex items-center gap-1 text-xs" data-testid="resolving-hint">
              <LifeBuoy className="size-3" aria-hidden />
              {workingUnits > 0 ? tq('externalUnits', { count: workingUnits }) : tq('closing')}
            </span>
          ) : pending && incident.expiresAt ? (
            <Countdown
              to={incident.expiresAt}
              urgentBelowSeconds={120}
              className="text-muted text-xs"
              prefix={<span className="sr-only">{t('expiresIn')}</span>}
            />
          ) : incident.work.estimatedEndAt ? (
            <Countdown
              to={incident.work.estimatedEndAt}
              className="text-info text-xs"
              doneLabel="…"
              prefix={<span className="sr-only">{t('endsIn')}</span>}
            />
          ) : (
            <Countdown to={incident.createdAt} elapsed className="text-subtle text-xs" />
          )}
        </span>
      </span>
    </button>
  );
}

/** Always-visible column on desktop, sheet content / page list on mobile. Sorted: unattended first, then by severity. */
export function IncidentQueue({
  onSelected,
  className,
}: {
  onSelected?: (incident: IncidentDto) => void;
  className?: string;
}) {
  const { incidents, vehicles, career } = useSnapshot();
  const catalog = useCatalog();
  const families = useFamilies();
  const t = useTranslations('game.queue');
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const sorted = React.useMemo(() => [...incidents].sort(SEVERITY_ORDER), [incidents]);
  const handle = (incident: IncidentDto) => {
    select({ kind: 'incident', id: incident.id }, { focus: incident.position });
    onSelected?.(incident);
  };
  // "What should I do now": an idle Operations screen picks ONE concrete next action from real career state
  // (a broken-down vehicle, an affordable upgrade, a family close to unlocking) instead of generic copy.
  const idleSuggestion =
    sorted.length === 0
      ? pickIdleSuggestion({
          vehicles,
          vehicleTypes: catalog?.vehicleTypes,
          families,
          credits: career.credits,
          level: career.level,
        })
      : null;
  const idleCopy = useIdleSuggestionCopy(idleSuggestion);
  return (
    <section
      aria-label={t('title')}
      className={cn('flex min-h-0 flex-col', className)}
      data-tutorial="incident-queue"
      data-testid="incident-queue"
    >
      {sorted.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-5" />}
          title={t('emptyTitle')}
          description={idleCopy?.text ?? (career.onDuty ? t('emptyOnDuty') : t('emptyOffDuty'))}
          action={
            idleCopy ? (
              <Button asChild variant="secondary" size="sm" data-testid="idle-suggestion-action">
                <Link href={idleCopy.href}>{idleCopy.label}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((i) => (
            <li key={i.id}>
              <IncidentCard
                incident={i}
                selected={selection?.kind === 'incident' && selection.id === i.id}
                onSelect={handle}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
