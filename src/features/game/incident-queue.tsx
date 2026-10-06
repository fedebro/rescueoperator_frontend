'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Ambulance, CheckCircle2, Hourglass, LifeBuoy, Loader2, Send, Timer } from 'lucide-react';
import type { IncidentDto } from '@/contracts';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { GameIcon, categoryIconName } from '@/design/icons';
import { SeverityBadge, severityColor } from '@/components/ui/severity-badge';
import { STATUS_VISUALS } from '@/components/ui/status-chip';
import { Countdown } from '@/components/ui/countdown';
import { Button } from '@/components/ui/button';
import { IncidentFamilies } from '@/features/families/family-chips';
import { useFamilies } from '@/features/families/use-families';
import { pickIdleSuggestion } from '@/features/coaching/idle-suggestion';
import { useIdleSuggestionCopy } from '@/features/coaching/idle-suggestion-copy';
import { SEVERITY_ORDER, useCatalog, useSnapshot } from './hooks';
import { canQuickDispatch, useQuickDispatch } from './quick-dispatch';
import { incidentScene } from '@/features/water/water';
import { WaterBodyBadge, useIncidentPlace } from '@/features/water/incident-water';
import { splitQueue } from '@/features/major/major';
import { SharedBadge } from '@/features/alliance/aid-incident';
import { MajorIconMark, MajorQueueHeader, MajorSectorLabel } from '@/features/major/queue';

/** Marks the element whose bottom edge ends the bottom sheet's peek state (see `BottomSheet.peekAnchor`). */
export const PEEK_END = { 'data-sheet-peek-end': '' } as const;

/**
 * Compact queue card (~64 px, 03 §2.3): severity-coloured icon that pulses while the call waits for vehicles, the
 * title on a line of its own, then severity, deadline (timer icon), address and services. The status is only spelled
 * out when it is NOT the default "waiting for vehicles" (that one is said once, by the pulse and the summary row).
 */
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
  const placeOf = useIncidentPlace();
  const resolving = incident.status === 'RESOLVING';
  const pending = incident.status === 'PENDING_RESPONSE';
  const workingUnits = (incident.externalSupport ?? []).filter(
    (u) => u.status === 'REQUESTED' || u.status === 'WORKING',
  ).length;
  const visual = STATUS_VISUALS[incident.status];
  const StatusIcon = visual?.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(incident)}
      aria-pressed={selected}
      data-testid="incident-card"
      data-incident-id={incident.id}
      data-status={incident.status}
      className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 pr-2 pl-3.5 text-left"
    >
      <span className="bg-surface-3 text-fg relative grid size-9 shrink-0 place-items-center rounded-md">
        {pending ? (
          <span
            aria-hidden
            className="animate-pulse-ring-tight absolute inset-0 rounded-md border-2"
            style={{ borderColor: severityColor(incident.severity) }}
          />
        ) : null}
        <GameIcon name={categoryIconName(incident.category)} size={20} />
        {/* A member of a major incident (D-24): the major's siren on its icon, as on its map pin. */}
        {incident.major ? <MajorIconMark /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-fg block truncate text-sm leading-5 font-semibold" title={tx(incident.title)}>
          {tx(incident.title)}
        </span>
        {/* A size container: a major member's sector label only shows where the line has room for it. */}
        <span className="@container mt-1 flex min-w-0 items-center gap-1.5 text-xs leading-4">
          <SeverityBadge
            severity={incident.severity}
            label={t('severity')}
            escalating={incident.escalating}
            size="sm"
          />
          {resolving ? (
            <span className="text-info flex shrink-0 items-center gap-1" data-testid="resolving-hint">
              <LifeBuoy className="size-3.5" aria-hidden />
              {workingUnits > 0 ? tq('externalUnits', { count: workingUnits }) : tq('closing')}
            </span>
          ) : pending && incident.expiresAt ? (
            <Countdown
              to={incident.expiresAt}
              urgentBelowSeconds={120}
              className="text-muted shrink-0"
              prefix={
                <>
                  <Timer className="size-3.5" aria-hidden />
                  <span className="sr-only">{t('expiresIn')}</span>
                </>
              }
            />
          ) : incident.work.estimatedEndAt ? (
            <Countdown
              to={incident.work.estimatedEndAt}
              className="text-info shrink-0"
              doneLabel="…"
              prefix={
                <>
                  <Hourglass className="size-3.5" aria-hidden />
                  <span className="sr-only">{t('endsIn')}</span>
                </>
              }
            />
          ) : (
            <Countdown to={incident.createdAt} elapsed className="text-subtle shrink-0" />
          )}
          {!pending && !resolving && StatusIcon ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 font-semibold',
                incident.status === 'RESPONDING' ? 'text-warning' : 'text-info',
              )}
              data-testid="incident-card-status"
            >
              <StatusIcon className="size-3.5" aria-hidden />
              {ts(incident.status)}
            </span>
          ) : null}
          {/* Water incidents (D-68): an anchor + "Al largo di …" instead of the street of the meeting point. */}
          <WaterBodyBadge incident={incident} compact className="shrink-0" />
          <SharedBadge incident={incident} compact />
          {incident.major ? (
            // A member of a major (D-24): its sector instead of the address the whole event shares.
            <MajorSectorLabel majorRef={incident.major} />
          ) : (
            <span className="text-muted min-w-0 flex-1 truncate" title={placeOf(incident)}>
              {placeOf(incident)}
            </span>
          )}
          {resolving && incident.patientCount > 0 ? (
            <span
              className="text-warning flex shrink-0 items-center gap-1 font-semibold"
              title={t('patientsWaiting', { count: incident.patientCount })}
              data-testid="incident-patients-waiting"
            >
              <Ambulance className="size-3.5" aria-hidden />
              {incident.patientCount}
            </span>
          ) : null}
          <IncidentFamilies incident={incident} size={16} />
        </span>
      </span>
    </button>
  );
}

function QuickDispatchButton({
  incident,
  sending,
  onSend,
}: {
  incident: IncidentDto;
  sending: boolean;
  onSend: (incident: IncidentDto) => void;
}) {
  const t = useTranslations('game.quickDispatch');
  const tx = useI18nText();
  return (
    <button
      type="button"
      onClick={() => onSend(incident)}
      disabled={sending}
      aria-busy={sending || undefined}
      aria-label={t('sendAria', { title: tx(incident.title) })}
      data-testid="quick-dispatch"
      data-incident-id={incident.id}
      className="border-border text-brand-text hover:bg-brand-soft active:bg-brand-soft flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-l text-xs font-bold disabled:opacity-60 lg:w-14"
    >
      {sending ? (
        <Loader2 className="size-5 animate-spin" aria-hidden />
      ) : (
        <Send className="size-5" aria-hidden />
      )}
      {t('send')}
    </button>
  );
}

/**
 * Always-visible column on desktop, side panel on tablets, bottom-sheet content on phones. Sorted: unattended first,
 * then by severity. `peekMarker` marks the first entry as the end of the sheet's peek state.
 */
export function IncidentQueue({
  onSelected,
  className,
  peekMarker,
}: {
  onSelected?: (incident: IncidentDto) => void;
  className?: string;
  peekMarker?: boolean;
}) {
  const { incidents, vehicles, career } = useSnapshot();
  const catalog = useCatalog();
  const families = useFamilies();
  const t = useTranslations('game.queue');
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const quick = useQuickDispatch();
  // Majors pinned on top (06 §2.6), each followed by its members in sector order; then every other call.
  const { majors, others } = React.useMemo(() => splitQueue(incidents, SEVERITY_ORDER), [incidents]);
  const handle = (incident: IncidentDto) => {
    select({ kind: 'incident', id: incident.id }, { focus: incidentScene(incident) });
    onSelected?.(incident);
  };
  const row = (i: IncidentDto, peek: boolean, member = false) => {
    const selected = selection?.kind === 'incident' && selection.id === i.id;
    return (
      <li
        key={i.id}
        className={cn(
          'bg-surface-2 hover:bg-surface-3 relative flex items-stretch overflow-hidden rounded-md border transition-colors',
          selected ? 'border-focus' : member ? 'border-major/40' : 'border-border',
        )}
        {...(peek ? PEEK_END : {})}
      >
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-1 rounded-r"
          style={{ background: severityColor(i.severity) }}
        />
        <IncidentCard incident={i} selected={selected} onSelect={handle} />
        {canQuickDispatch(i, vehicles) ? (
          <QuickDispatchButton
            incident={i}
            sending={quick.sending.has(i.id)}
            onSend={(incident) => void quick.send(incident)}
          />
        ) : null}
      </li>
    );
  };
  // "What should I do now": an idle Operations screen picks ONE concrete next action from real career state
  // (a broken-down vehicle, an affordable upgrade, a family close to unlocking) instead of generic copy.
  const idleSuggestion =
    incidents.length === 0
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
      {incidents.length === 0 ? (
        <div
          className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3"
          data-testid="queue-empty"
          {...(peekMarker ? PEEK_END : {})}
        >
          <CheckCircle2 className="text-success size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('emptyTitle')}</p>
            <p className="text-muted text-xs">
              {idleCopy?.text ?? (career.onDuty ? t('emptyOnDuty') : t('emptyOffDuty'))}
            </p>
          </div>
          {idleCopy ? (
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="h-11 lg:h-8"
              data-testid="idle-suggestion-action"
            >
              <Link href={idleCopy.href}>{idleCopy.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {majors.map((block, index) => (
            <li
              key={block.majorId}
              className="flex flex-col gap-1.5"
              data-testid="major-queue-block"
              data-major-id={block.majorId}
            >
              <MajorQueueHeader
                majorRef={block.ref}
                members={block.members}
                selected={selection?.kind === 'major' && selection.id === block.majorId}
                peek={!!peekMarker && index === 0}
              />
              {/* The major's rail runs in the column's gutter: the members keep the full card width. */}
              <ul
                className="before:bg-major/60 relative flex flex-col gap-1.5 before:absolute before:inset-y-1 before:-left-2 before:w-0.5 before:rounded-full"
                aria-label={t('majorMembers')}
              >
                {block.members.map((i) => row(i, false, true))}
              </ul>
            </li>
          ))}
          {others.map((i, index) => row(i, !!peekMarker && majors.length === 0 && index === 0))}
        </ul>
      )}
    </section>
  );
}
