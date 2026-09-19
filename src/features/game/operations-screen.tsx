'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useUiStore } from '@/stores/ui';
import { BottomSheet, snapHeights } from '@/components/ui/bottom-sheet';
import { SectionTitle } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { OperationsMap } from './operations-map';
import { IncidentQueue } from './incident-queue';
import { SelectionInspector } from './inspectors';
import { DutyToggle } from './duty-toggle';
import { useSnapshot } from './hooks';

function QueueHeader() {
  const t = useTranslations('game.queue');
  const { incidents } = useSnapshot();
  const pending = incidents.filter((i) => i.status === 'PENDING_RESPONSE').length;
  return (
    <SectionTitle
      className="mb-0"
      action={pending > 0 ? <Badge tone="danger">{t('pending', { count: pending })}</Badge> : null}
    >
      {t('title')} · {incidents.length}
    </SectionTitle>
  );
}

/**
 * Desktop: [incident queue | map | inspector]. Mobile: fullscreen map + three-height bottom sheet whose content is
 * the queue (nothing selected) or the inspector (selection). Same stores, same components, two layouts.
 */
export function OperationsScreen() {
  const desktop = useIsDesktop();
  const t = useTranslations('game');
  const selection = useUiStore((s) => s.selection);
  const snap = useUiStore((s) => s.sheetSnap);
  const setSnap = useUiStore((s) => s.setSheetSnap);

  if (desktop) {
    return (
      <div className="absolute inset-0 flex">
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
        <div className="relative min-w-0 flex-1">
          <OperationsMap />
        </div>
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

  const peek = selection ? 148 : 104;
  const viewport = typeof window === 'undefined' ? 700 : window.innerHeight - 52 - 60;
  const covered = snap === 'peek' ? peek : snapHeights(viewport, peek).half;
  return (
    <div className="absolute inset-0">
      <OperationsMap bottomPadding={covered} />
      <BottomSheet
        snap={snap}
        onSnapChange={setSnap}
        peekHeight={peek}
        handleLabel={t('sheet.handle')}
        topOffset="calc(var(--rc-topbar-h) + 8px)"
        bottomOffset="calc(var(--rc-bottomnav-h) + var(--rc-safe-bottom))"
        data-testid="bottom-sheet"
      >
        {selection ? (
          <SelectionInspector />
        ) : (
          <div className="flex flex-col gap-3 px-3 pb-4">
            <div className="flex items-center justify-between gap-3 px-1">
              <QueueHeader />
            </div>
            <IncidentQueue />
            <DutyToggle />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
