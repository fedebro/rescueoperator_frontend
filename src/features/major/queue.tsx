'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Siren } from 'lucide-react';
import type { IncidentDto, MajorIncidentRefDto } from '@/contracts';
import { cn } from '@/lib/utils';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useOpenMajor } from './hooks';
import { MajorGlyph } from './coordination-view';

/**
 * The pinned head of a major incident in the queue (06 §2.6: "majors pinned and visually distinct"): its alarm glyph, the
 * phase, how many sectors wait for vehicles, and one tap to the coordination view. Its members follow right below it.
 */
export function MajorQueueHeader({
  majorRef,
  members,
  selected,
  peek,
}: {
  majorRef: MajorIncidentRefDto;
  members: readonly IncidentDto[];
  selected: boolean;
  /** Marks the end of the phone sheet's peek state (the first card of the queue). */
  peek?: boolean;
}) {
  const t = useTranslations('maxi.queue');
  const tx = useI18nText();
  const openMajor = useOpenMajor();
  const pending = members.filter((m) => m.status === 'PENDING_RESPONSE').length;
  return (
    <button
      type="button"
      onClick={() => openMajor(majorRef.id, majorRef.center)}
      aria-pressed={selected}
      aria-label={t('openAria', { title: tx(majorRef.title) })}
      data-testid="major-queue-header"
      data-major-id={majorRef.id}
      data-phase={majorRef.phase}
      {...(peek ? { 'data-sheet-peek-end': '' } : {})}
      className={cn(
        'bg-major/10 hover:bg-major/15 flex min-h-16 w-full items-center gap-3 rounded-md border-2 py-2 pr-2 pl-3 text-left transition-colors',
        selected ? 'border-focus' : 'border-major/70',
      )}
    >
      <MajorGlyph active size={36} />
      <span className="min-w-0 flex-1">
        <span className="text-major block truncate text-xs leading-4 font-extrabold tracking-[0.08em] whitespace-nowrap uppercase">
          {tx({ key: 'major.common.title' })}
        </span>
        <span className="text-fg block truncate text-sm leading-5 font-semibold" title={tx(majorRef.title)}>
          {tx(majorRef.title)}
        </span>
        <span className="text-muted block truncate text-xs">
          <span className="text-fg font-semibold" data-testid="major-queue-phase">
            {tx({ key: `major.phase.${majorRef.phase}.name` })}
          </span>
          {' · '}
          {t('sectors', { count: members.length })}
          {pending > 0 ? <span className="text-danger"> · {t('pending', { count: pending })}</span> : null}
        </span>
      </span>
      <span className="text-major flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 text-xs font-bold lg:w-14">
        <ChevronRight className="size-5" aria-hidden />
        {t('coordinate')}
      </span>
    </button>
  );
}

/** "Maxi · Settore 2" in a member's inspector: which major, which sector. */
export function MajorMemberBadge({
  majorRef,
  className,
}: {
  majorRef: MajorIncidentRefDto;
  className?: string;
}) {
  const tx = useI18nText();
  const t = useTranslations('maxi.member');
  const sector =
    majorRef.role === 'MAIN'
      ? tx({ key: 'major.sector.main' })
      : tx({ key: 'major.sector.sub', params: { count: majorRef.sector } });
  return (
    <span
      className={cn(
        'text-major bg-major/15 inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-bold whitespace-nowrap',
        className,
      )}
      data-testid="major-member-badge"
      data-role={majorRef.role}
      title={`${tx({ key: 'major.common.title' })} · ${sector}`}
    >
      <Siren className="size-3.5" aria-hidden />
      <span>
        {t('badge')} · {sector}
      </span>
    </span>
  );
}

/**
 * In a member's queue card, where the address would be (the whole event shares one area): its sector, in the major's
 * colour. It takes the address's room — and truncates like it — so the card keeps the width budget of every other one;
 * on a line too narrow for it (the desktop column) it stays out, the siren on the icon marking the member.
 */
export function MajorSectorLabel({ majorRef }: { majorRef: MajorIncidentRefDto }) {
  const tx = useI18nText();
  const sector =
    majorRef.role === 'MAIN'
      ? tx({ key: 'major.sector.main' })
      : tx({ key: 'major.sector.sub', params: { count: majorRef.sector } });
  return (
    <span
      // Too narrow a line (the desktop queue column) would leave a clipped sliver: there the siren on the icon says it.
      className="text-major hidden min-w-0 flex-1 truncate font-semibold @[13rem]:block"
      title={`${tx({ key: 'major.common.title' })} · ${sector}`}
      data-testid="major-member-badge"
      data-role={majorRef.role}
    >
      {sector}
    </span>
  );
}

/** The corner mark on a member's icon in the queue: the major's siren, as on its map pin. */
export function MajorIconMark() {
  return (
    <span
      aria-hidden
      className="bg-major text-inverse ring-surface-2 absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full ring-2"
    >
      <Siren className="size-2.5" />
    </span>
  );
}

/** Inside a member's inspector: which major it belongs to, and the way back to the coordination view. */
export function MajorMemberBanner({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('maxi.member');
  const tx = useI18nText();
  const openMajor = useOpenMajor();
  const ref = incident.major;
  if (!ref) return null;
  // A button sizes to its content even as a flex box: the wrapper gives it the inspector's width (and its gutter).
  return (
    <div className="px-4 pt-3">
      <button
        type="button"
        onClick={() => openMajor(ref.id, ref.center)}
        className="border-major/50 bg-major/10 hover:bg-major/15 flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm"
        data-testid="major-member-banner"
      >
        <Siren className="text-major size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="text-major block truncate text-xs font-bold tracking-wide uppercase">
            {tx({ key: `major.role.${ref.role}` })} · {tx({ key: `major.phase.${ref.phase}.name` })}
          </span>
          <span className="block truncate font-semibold">{tx(ref.title)}</span>
        </span>
        <span className="text-major shrink-0 text-xs font-bold">{t('open')}</span>
        <ChevronRight className="text-major size-4 shrink-0" aria-hidden />
      </button>
    </div>
  );
}
