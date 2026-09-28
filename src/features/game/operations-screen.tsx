'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ListChecks } from 'lucide-react';
import { useIsShortViewport, useOperationsLayout } from '@/hooks/use-media-query';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SectionTitle } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { MapSlot } from './persistent-map';
import { IncidentQueue } from './incident-queue';
import { SelectionInspector } from './inspectors';
import { DutyToggle } from './duty-toggle';
import { useSnapshot } from './hooks';
import { useSheetHistory, type SheetLevel } from './use-sheet-history';

/** Desktop queue column header: count, waiting badge and the way to the full incident table. */
function QueueHeader() {
  const t = useTranslations('game.queue');
  const { incidents } = useSnapshot();
  const pending = incidents.filter((i) => i.status === 'PENDING_RESPONSE').length;
  return (
    <SectionTitle
      className="mb-0"
      action={
        <span className="flex items-center gap-1">
          {pending > 0 ? <Badge tone="danger">{t('pending', { count: pending })}</Badge> : null}
          <Link
            href="/game/incidents"
            className="text-muted hover:bg-surface-3 hover:text-fg grid size-9 place-items-center rounded-md"
            aria-label={t('allIncidents')}
            title={t('allIncidents')}
            data-testid="all-incidents"
          >
            <ListChecks className="size-4" aria-hidden />
          </Link>
        </span>
      }
    >
      {t('title')} · {incidents.length}
    </SectionTitle>
  );
}

/**
 * Phone / tablet summary row (03 §4): "3 emergenze · 2 in attesa" and the duty switch — its only home below 1024 px.
 * In the bottom sheet it is part of the drag strip: a tap on it opens the sheet, a drag moves it.
 */
function QueueSummary({ className }: { className?: string }) {
  const t = useTranslations('game.queue');
  const { incidents } = useSnapshot();
  const pending = incidents.filter((i) => i.status === 'PENDING_RESPONSE').length;
  return (
    <div className={cn('flex min-h-11 items-center gap-3 px-4', className)} data-testid="queue-summary">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
        {t('summary', { count: incidents.length })}
        {pending > 0 ? <span className="text-danger"> · {t('pending', { count: pending })}</span> : null}
      </h2>
      <DutyToggle compact />
    </div>
  );
}

/**
 * Desktop: [incident queue | map | inspector]. Tablet (768–1023 px): [queue or inspector | map]. Phone: fullscreen map
 * + bottom sheet whose content is the queue (nothing selected) or the inspector (selection). Same stores, same
 * components, three layouts.
 */
export function OperationsScreen() {
  const layout = useOperationsLayout();
  const short = useIsShortViewport();
  const t = useTranslations('game');
  const selection = useUiStore((s) => s.selection);
  const snap = useUiStore((s) => s.sheetSnap);
  const restore = useUiStore((s) => s.sheetRestore);
  const setSnap = useUiStore((s) => s.setSheetSnap);
  const setCover = useUiStore((s) => s.setSheetCover);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Back closes the inspector, then lowers the sheet (phone); on tablets it closes the side-panel inspector.
  const queueRaised = selection ? restore !== null && restore !== 'peek' : snap !== 'peek';
  const levels: SheetLevel[] =
    layout === 'phone'
      ? [...(queueRaised ? (['sheet'] as const) : []), ...(selection ? (['inspector'] as const) : [])]
      : layout === 'tablet' && selection
        ? ['inspector']
        : [];
  useSheetHistory(
    levels,
    React.useCallback((closed: SheetLevel[]) => {
      const ui = useUiStore.getState();
      for (const level of closed) {
        if (level === 'inspector') ui.clearSelection();
        else ui.lowerSheet();
      }
    }, []),
    layout !== 'desktop',
  );

  // Without a sheet nothing covers the map.
  React.useEffect(() => {
    if (layout !== 'phone') setCover(0);
  }, [layout, setCover]);

  const onVisibleHeight = React.useCallback(
    (px: number, settled: boolean) => {
      const root = rootRef.current;
      // The OSM attribution sits just above the sheet's edge (D-83), and never above the map's own top.
      if (root) root.style.setProperty('--rc-map-inset-bottom', `${Math.min(px, root.clientHeight - 28)}px`);
      if (settled) setCover(Math.round(px));
      else if (useUiStore.getState().sheetCover !== null) setCover(null);
    },
    [setCover],
  );

  if (layout === 'desktop') {
    return (
      <div className="absolute inset-0 flex" data-ops-layout="desktop">
        <aside
          className="border-border bg-surface-1 flex w-[320px] shrink-0 flex-col border-r"
          aria-label={t('queue.title')}
        >
          <div className="border-border shrink-0 border-b px-3 py-3">
            <QueueHeader />
          </div>
          <div className="scroll-y min-h-0 flex-1 p-3">
            <IncidentQueue />
          </div>
        </aside>
        <MapSlot className="relative min-w-0 flex-1" />
        {selection ? (
          <aside
            className="border-border bg-surface-1 w-[400px] shrink-0 border-l"
            aria-label={t('inspector.label')}
          >
            <SelectionInspector />
          </aside>
        ) : null}
      </div>
    );
  }

  if (layout === 'tablet') {
    return (
      <div className="absolute inset-0 flex" data-ops-layout="tablet">
        <aside
          className="border-border bg-surface-1 flex w-[340px] shrink-0 flex-col border-r"
          aria-label={selection ? t('inspector.label') : t('queue.title')}
          data-testid="side-panel"
        >
          {selection ? (
            <SelectionInspector />
          ) : (
            <>
              <QueueSummary className="border-border shrink-0 border-b" />
              <div className="scroll-y min-h-0 flex-1 p-3">
                <IncidentQueue />
              </div>
            </>
          )}
        </aside>
        <MapSlot className="relative min-w-0 flex-1" />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="absolute inset-0" data-ops-layout="phone">
      <MapSlot className="absolute inset-0" />
      <BottomSheet
        snap={snap}
        onSnapChange={setSnap}
        contained
        twoSnap={short}
        peekAnchor="[data-sheet-peek-end]"
        handleLabel={t('sheet.handle')}
        collapseLabel={t('sheet.collapse')}
        topOffset="8px"
        header={selection ? undefined : <QueueSummary />}
        scrollKey={selection ? `${selection.kind}:${selection.id}` : 'queue'}
        onVisibleHeight={onVisibleHeight}
        data-testid="bottom-sheet"
      >
        {selection ? (
          <SelectionInspector />
        ) : (
          <div data-sheet-scroll className="scroll-y min-h-0 flex-1 px-3 pt-1 pb-4">
            <IncidentQueue peekMarker />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
