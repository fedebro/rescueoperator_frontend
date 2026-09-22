'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Navigation, Radio, Send, ShoppingCart, Siren, X } from 'lucide-react';
import { gameApi } from '@/lib/api/endpoints';
import { useUiStore } from '@/stores/ui';
import { useLatest } from '@/hooks/use-latest';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTargetRect } from '@/features/coaching/target-rect';
import { useCareerId, usePatchSnapshot, useSnapshot } from './hooks';

export const TUTORIAL_STEPS = [
  'WELCOME',
  'SELECT_INCIDENT',
  'DISPATCH',
  'WATCH_ARRIVAL',
  'OUTCOME',
  'BUY_VEHICLE',
  'DONE',
] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** Which element each step points at. Steps advance on REAL actions (selecting, dispatching, buying), never on "next". */
const TARGET: Partial<Record<TutorialStep, string>> = {
  SELECT_INCIDENT: '[data-tutorial="incident-queue"] [data-testid="incident-card"]',
  DISPATCH: '[data-tutorial="send-recommended"]',
  BUY_VEHICLE: '[data-tutorial="buy-vehicle"], [data-tutorial="nav-shop"]',
};

const ICON: Record<Exclude<TutorialStep, 'OUTCOME' | 'DONE'>, React.ComponentType<{ className?: string }>> = {
  WELCOME: Siren,
  SELECT_INCIDENT: Radio,
  DISPATCH: Send,
  WATCH_ARRIVAL: Navigation,
  BUY_VEHICLE: ShoppingCart,
};

/** Keeps a DOMRect fully inside the viewport, minus a small margin — a spotlight never overflows or misdraws off-screen. */
function clampToViewport(r: DOMRect, margin = 8) {
  const left = Math.min(Math.max(r.left, margin), window.innerWidth - margin);
  const top = Math.min(Math.max(r.top, margin), window.innerHeight - margin);
  const width = Math.min(r.width, window.innerWidth - left - margin);
  const height = Math.min(r.height, window.innerHeight - top - margin);
  return { left, top, width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * Guided tutorial: a spotlight (pure box-shadow cut-out, pointer-events: none — the real control stays clickable)
 * plus a coach card. Explanations can be skipped at any time; skipping never blocks play.
 *
 * The card is always docked at the same safe spot — centered for the WELCOME briefing, top-anchored (below the
 * topbar) for every step that spotlights something further down the screen. Anchoring only ever at the top means it
 * can never compete for space with the bottom sheet or the bottom nav on a phone, which is what made the previous
 * "flip to bottom past 55% of the viewport" heuristic feel cramped there.
 */
export function TutorialOverlay() {
  const careerId = useCareerId();
  const { career, pendingOutcomes, incidents } = useSnapshot();
  const t = useTranslations('game.tutorial');
  const pathname = usePathname();
  const selection = useUiStore((s) => s.selection);
  const patch = usePatchSnapshot();
  const step = (career.tutorial.completed ? 'DONE' : (career.tutorial.step ?? 'DONE')) as TutorialStep;

  const advance = useMutation({
    mutationFn: (next: TutorialStep) => gameApi.tutorialAdvance(careerId, next),
    onMutate: (next) =>
      patch((s) => ({
        ...s,
        career: {
          ...s.career,
          tutorial: { completed: next === 'DONE', step: next === 'DONE' ? null : next },
        },
      })),
    onSuccess: (summary) => patch((s) => ({ ...s, career: { ...s.career, tutorial: summary.tutorial } })),
  });
  const advanceRef = useLatest(advance.mutate);

  // Real-action triggers (the server also advances on its own; both are forward-only and idempotent).
  const tutorialIncident = incidents.find((i) => i.isTutorial);
  React.useEffect(() => {
    if (step === 'SELECT_INCIDENT' && selection?.kind === 'incident') advanceRef.current('DISPATCH');
    if (step === 'DISPATCH' && tutorialIncident && tutorialIncident.status !== 'PENDING_RESPONSE')
      advanceRef.current('WATCH_ARRIVAL');
    if ((step === 'WATCH_ARRIVAL' || step === 'DISPATCH') && pendingOutcomes.length > 0 && !tutorialIncident)
      advanceRef.current('OUTCOME');
  }, [step, selection, tutorialIncident, pendingOutcomes.length, advanceRef]);

  // On phones the queue and the dispatch panel both live in the bottom sheet: keep it open enough to spotlight.
  React.useEffect(() => {
    if (step === 'SELECT_INCIDENT' || step === 'DISPATCH') {
      const current = useUiStore.getState().sheetSnap;
      if (current === 'peek') useUiStore.getState().setSheetSnap('half');
    }
  }, [step]);

  const rawTarget = useTargetRect(
    step === 'BUY_VEHICLE' && pathname.startsWith('/game/shop')
      ? '[data-tutorial="buy-vehicle"]'
      : TARGET[step],
  );
  const target = rawTarget ? clampToViewport(rawTarget) : null;
  if (step === 'DONE' || step === 'OUTCOME') return null; // OUTCOME is carried by the outcome modal itself
  if (step === 'DISPATCH' && selection?.kind !== 'incident') return null;

  const index = TUTORIAL_STEPS.indexOf(step);
  const totalSteps = TUTORIAL_STEPS.length - 2; // exclude OUTCOME (silent) and DONE (terminal) from the count shown
  const pad = 6;
  const Icon = ICON[step as keyof typeof ICON];
  const isWelcome = step === 'WELCOME';

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" data-testid="tutorial" data-step={step}>
      {isWelcome ? <div className="bg-overlay animate-fade-in pointer-events-auto absolute inset-0" /> : null}
      {target && !isWelcome ? (
        <div
          aria-hidden
          className="border-focus absolute rounded-lg border-2 transition-all duration-200"
          style={{
            left: target.left - pad,
            top: target.top - pad,
            width: target.width + pad * 2,
            height: target.height + pad * 2,
            boxShadow: '0 0 0 9999px rgb(3 7 14 / 0.6)',
          }}
        >
          <span className="border-focus absolute inset-0 animate-ping rounded-lg border-2 opacity-75" />
        </div>
      ) : null}
      <div
        role="dialog"
        aria-label={t('label')}
        aria-live="polite"
        data-testid={`tutorial-card-${step}`}
        className={cn(
          'border-border-strong bg-surface-2 shadow-panel animate-fade-in pointer-events-auto absolute overflow-hidden rounded-xl border',
          isWelcome
            ? 'inset-x-4 top-1/2 mx-auto max-w-sm -translate-y-1/2 sm:inset-x-auto'
            : 'inset-x-3 top-[calc(var(--rc-safe-top)+12px)] mx-auto max-w-sm lg:inset-x-auto lg:left-[calc(var(--rc-sidebar-w)+16px)] lg:mx-0',
        )}
      >
        <div className={cn('flex items-start gap-3 p-4', isWelcome && 'flex-col items-center pt-6 text-center')}>
          <span
            aria-hidden
            className={cn(
              'bg-brand/15 text-brand-hot grid shrink-0 place-items-center rounded-full',
              isWelcome ? 'size-14' : 'size-9',
            )}
          >
            <Icon className={isWelcome ? 'size-7' : 'size-5'} />
          </span>
          <div className={cn('min-w-0 flex-1', isWelcome && 'flex-none')}>
            {!isWelcome ? (
              <div
                className="text-skyline mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase"
                aria-hidden
              >
                {Array.from({ length: totalSteps }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === index - 1 ? 'bg-brand-hot w-5' : i < index - 1 ? 'bg-brand-hot/50 w-1.5' : 'bg-surface-4 w-1.5',
                    )}
                  />
                ))}
                <span className="sr-only">{t('progress', { current: index, total: totalSteps })}</span>
              </div>
            ) : null}
            <p className={cn('font-display leading-tight font-bold', isWelcome ? 'text-xl' : 'text-base')}>
              {t(`${step}.title`)}
            </p>
            <p className={cn('text-muted mt-1', isWelcome ? 'text-sm leading-relaxed' : 'text-sm')}>
              {t(`${step}.body`)}
            </p>
          </div>
          {!isWelcome ? (
            <button
              type="button"
              onClick={() => advance.mutate('DONE')}
              className="text-subtle hover:text-fg hover:bg-surface-3 -m-1 shrink-0 rounded-full p-1"
              aria-label={t('skip')}
              data-testid="tutorial-skip"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {isWelcome ? (
          <div className="bg-surface-1 flex flex-col gap-2 p-4 pt-3">
            <Button size="md" className="w-full" onClick={() => advance.mutate('SELECT_INCIDENT')} data-testid="tutorial-start">
              {t('start')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => advance.mutate('DONE')}
              data-testid="tutorial-skip"
            >
              {t('skip')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
