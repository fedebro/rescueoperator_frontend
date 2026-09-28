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

/**
 * Which element each step points at. Steps advance on REAL actions (selecting, dispatching, buying), never on "next".
 * All of them are on screen without scrolling in every layout: the first queue card is part of the phone sheet's
 * peek, the send button lives in the inspector's pinned footer, "Acquisti" is in both navigations.
 */
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
 * The card is always docked at the same safe spot — centered for the WELCOME briefing, top-anchored for every step
 * that spotlights something further down the screen: just below the top bar on phones (the top bar row is where
 * toasts appear, and the bottom belongs to the sheet and the nav); on tablets and desktop past the queue panel /
 * column, over the map, so it never covers the queue card it points at.
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

  // Real-action triggers (the server also advances on its own; both are forward-only and idempotent). The tutorial
  // incident has no one-tap "Invia" on its card, but should it ever be dispatched without opening it, the steps
  // still move on instead of pointing at a card that no longer waits.
  const tutorialIncident = incidents.find((i) => i.isTutorial);
  React.useEffect(() => {
    const dispatched = !!tutorialIncident && tutorialIncident.status !== 'PENDING_RESPONSE';
    if (step === 'SELECT_INCIDENT' && selection?.kind === 'incident' && !dispatched)
      advanceRef.current('DISPATCH');
    if ((step === 'SELECT_INCIDENT' || step === 'DISPATCH') && dispatched)
      advanceRef.current('WATCH_ARRIVAL');
    if ((step === 'WATCH_ARRIVAL' || step === 'DISPATCH') && pendingOutcomes.length > 0 && !tutorialIncident)
      advanceRef.current('OUTCOME');
  }, [step, selection, tutorialIncident, pendingOutcomes.length, advanceRef]);

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
            : 'inset-x-3 top-[calc(var(--rc-safe-top)+var(--rc-topbar-h)+8px)] mx-auto max-w-sm md:inset-x-auto md:left-[356px] md:mx-0 lg:top-[calc(var(--rc-safe-top)+12px)] lg:left-[calc(var(--rc-sidebar-w)+336px)]',
        )}
      >
        <div
          className={cn('flex items-start gap-3 p-4', isWelcome && 'flex-col items-center pt-6 text-center')}
        >
          <span
            aria-hidden
            className={cn(
              'bg-brand/15 text-brand-text grid shrink-0 place-items-center rounded-full',
              isWelcome ? 'size-14' : 'size-9',
            )}
          >
            <Icon className={isWelcome ? 'size-7' : 'size-5'} />
          </span>
          <div className={cn('min-w-0 flex-1', isWelcome && 'flex-none')}>
            {!isWelcome ? (
              <div
                className="text-skyline mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase"
                aria-hidden
              >
                {Array.from({ length: totalSteps }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === index - 1
                        ? 'bg-brand w-5'
                        : i < index - 1
                          ? 'bg-brand/50 w-1.5'
                          : 'bg-surface-4 w-1.5',
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
              className="text-subtle hover:text-fg hover:bg-surface-3 -m-2.5 grid size-11 shrink-0 place-items-center rounded-full"
              aria-label={t('skip')}
              data-testid="tutorial-skip"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : null}
        </div>
        {isWelcome ? (
          <div className="bg-surface-1 flex flex-col gap-2 p-4 pt-3">
            <Button
              size="md"
              className="w-full"
              onClick={() => advance.mutate('SELECT_INCIDENT')}
              data-testid="tutorial-start"
            >
              {t('start')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-full lg:h-8"
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
