'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { useTargetRect } from '@/features/coaching/target-rect';
import { useSnapshot } from './hooks';
import { currentLessonIncident, lessonBubble, type Bubble, type BubbleAction } from './first-shift';

/** True while some vehicle is ticked in the dispatch list (Radix checkbox state), polled like the spotlight targets. */
function useTicked(enabled: boolean): boolean {
  const [ticked, setTicked] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    const read = () =>
      setTicked(
        document.querySelector('[data-testid="dispatch-option"] [role="checkbox"][data-state="checked"]') !==
          null,
      );
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [enabled]);
  return enabled && ticked;
}

/**
 * «Salta» of the guided first shift (study §3.3): small, and asks first — «Vuoi davvero giocare senza guida? Le prime missioni
 * restano brevi». Confirming ends the tutorial (POST DONE): the pace of the first shift stays, only the bubbles go.
 */
export function SkipGuide({ onSkip, className }: { onSkip: () => void; className?: string }) {
  const t = useTranslations('firstShift.skip');
  const tc = useTranslations('common');
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('text-subtle hover:text-fg text-xs underline-offset-2 hover:underline', className)}
        data-testid="tutorial-skip"
      >
        {t('button')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t('title')}
          description={t('body')}
          closeLabel={tc('close')}
          data-testid="tutorial-skip-confirm"
        >
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} data-testid="tutorial-skip-cancel">
              {t('keep')}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                track('tutorial_skipped', {});
                onSkip();
              }}
              data-testid="tutorial-skip-confirm-button"
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ACTION_LABEL: Record<BubbleAction, string> = {
  OPEN_CALL: 'openCall',
  GO_SHOP: 'goShop',
  BACK_TO_CALL: 'backToCall',
};

/**
 * The guided missions 1–4 of the first shift (study §3.3): ONE line next to the right control — «Apri la chiamata», «Invia i
 * mezzi consigliati», «Spunta tu il mezzo giusto», «Servono due mezzi: compra il secondo», «Reindirizza qui» — with a soft ring
 * around it. Nothing is dimmed and nothing blocks: the bubble follows the real state and moves on when the thing is done.
 * Shown only while `career.firstShift.guided`.
 */
export function FirstShiftGuide({ onSkip }: { onSkip: () => void }) {
  const { career, incidents, vehicles } = useSnapshot();
  const t = useTranslations('firstShift.bubble');
  const pathname = usePathname();
  const router = useRouter();
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const incident = currentLessonIncident(incidents);
  const lesson = incident?.firstShift?.lesson ?? null;
  const page = pathname === '/game' ? 'MAP' : pathname.startsWith('/game/shop') ? 'SHOP' : 'OTHER';
  const selected = selection?.kind === 'incident' && selection.id === incident?.id;
  const ticked = useTicked(lesson === 'CHOOSE_VEHICLE' && selected);
  const bubble: Bubble | null =
    career.firstShift?.guided && incident && lesson
      ? lessonBubble({
          lesson,
          incident,
          selected,
          page,
          available: vehicles.filter((v) => v.status === 'AVAILABLE').length,
          delivering: vehicles.filter((v) => v.status === 'IN_DELIVERY').length,
          returning: vehicles.filter((v) => v.status === 'RETURNING').length,
          owned: vehicles.filter((v) => v.typeCode === 'FIRE_APS').length,
          ticked,
        })
      : null;
  const rect = useTargetRect(bubble?.selector);

  React.useEffect(() => {
    if (bubble) track('first_shift_bubble', { id: bubble.id, lesson: lesson ?? '' });
  }, [bubble?.id, lesson]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bubble || !incident) return null;
  const act = (action: BubbleAction) => {
    if (action === 'GO_SHOP') router.push('/game/shop?family=FIRE');
    else {
      if (pathname !== '/game') router.push('/game');
      select({ kind: 'incident', id: incident.id });
    }
  };
  // Docked when the control is not on screen (or the bubble has none): just under the top bar, over the map.
  const docked = !rect;
  if (docked && !bubble.action) return null;

  const gap = 10;
  const cardH = 92;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const above = rect ? rect.top >= cardH + gap || rect.top > vh - rect.bottom : false;
  const width = Math.min(300, vw - 24);
  const left = rect ? Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), vw - width - 12) : 0;
  const style: React.CSSProperties = rect
    ? above
      ? { left, width, bottom: Math.max(12, vh - rect.top + gap) }
      : { left, width, top: Math.min(rect.bottom + gap, vh - cardH - 12) }
    : {};

  const node = (
    <div
      className="pointer-events-none fixed inset-0 z-[57]"
      data-testid="tutorial"
      data-step={career.tutorial.step ?? 'DONE'}
      data-bubble={bubble.id}
      data-lesson={lesson ?? ''}
    >
      {rect ? (
        <div
          aria-hidden
          className="border-focus absolute rounded-lg border-2 transition-all duration-200"
          style={{ left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }}
        >
          <span className="border-focus absolute inset-0 animate-ping rounded-lg border-2 opacity-60" />
        </div>
      ) : null}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'border-focus/60 bg-surface-2 shadow-panel animate-fade-in pointer-events-auto absolute flex flex-col gap-2 rounded-lg border px-3 py-2.5',
          docked &&
            'inset-x-3 top-[calc(var(--rc-safe-top)+var(--rc-topbar-h)+8px)] mx-auto max-w-xs lg:top-[calc(var(--rc-safe-top)+12px)]',
        )}
        style={style}
        data-testid="first-shift-bubble"
        data-bubble={bubble.id}
      >
        <p className="text-sm font-semibold">{t(bubble.id)}</p>
        <div className="flex items-center justify-between gap-2">
          <SkipGuide onSkip={onSkip} />
          {bubble.action ? (
            <Button size="sm" onClick={() => act(bubble.action!)} data-testid="first-shift-bubble-action">
              {t(`action.${ACTION_LABEL[bubble.action]}` as never)}
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
