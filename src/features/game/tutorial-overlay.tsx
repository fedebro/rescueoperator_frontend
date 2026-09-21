'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { GraduationCap } from 'lucide-react';
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

/**
 * Guided tutorial: a spotlight (pure box-shadow cut-out, pointer-events: none — the real control stays clickable)
 * plus a coach card. Explanations can be skipped at any time; skipping never blocks play.
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

  // On phones the queue lives in the bottom sheet: open it so the highlighted card is actually on screen.
  React.useEffect(() => {
    if (step === 'SELECT_INCIDENT') useUiStore.getState().setSheetSnap('half');
  }, [step]);

  const target = useTargetRect(
    step === 'BUY_VEHICLE' && pathname.startsWith('/game/shop')
      ? '[data-tutorial="buy-vehicle"]'
      : TARGET[step],
  );
  if (step === 'DONE' || step === 'OUTCOME') return null; // OUTCOME is carried by the outcome modal itself
  if (step === 'DISPATCH' && selection?.kind !== 'incident') return null;

  const index = TUTORIAL_STEPS.indexOf(step);
  const pad = 6;
  const cardOnTop = target ? target.top > window.innerHeight * 0.55 : false;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" data-testid="tutorial" data-step={step}>
      {step === 'WELCOME' ? <div className="bg-overlay pointer-events-auto absolute inset-0" /> : null}
      {target && step !== 'WELCOME' ? (
        <div
          aria-hidden
          className="border-focus absolute rounded-lg border-2 transition-all duration-200"
          style={{
            left: target.left - pad,
            top: target.top - pad,
            width: target.width + pad * 2,
            height: target.height + pad * 2,
            boxShadow: '0 0 0 9999px rgb(3 7 14 / 0.55)',
          }}
        />
      ) : null}
      <div
        role="dialog"
        aria-label={t('label')}
        aria-live="polite"
        className={cn(
          'border-border-strong bg-surface-2 shadow-panel pointer-events-auto absolute inset-x-3 mx-auto max-w-sm rounded-lg border p-4',
          step === 'WELCOME'
            ? 'top-1/2 -translate-y-1/2'
            : cardOnTop
              ? 'top-[calc(var(--rc-safe-top)+64px)]'
              : 'bottom-[calc(var(--rc-bottomnav-h)+var(--rc-safe-bottom)+12px)] lg:right-auto lg:bottom-6 lg:left-[calc(var(--rc-sidebar-w)+344px)] lg:mx-0',
        )}
      >
        <div className="text-skyline flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase">
          <GraduationCap className="size-4" aria-hidden />
          {t('progress', { current: index + 1, total: TUTORIAL_STEPS.length - 1 })}
        </div>
        <p className="font-display mt-1.5 text-lg leading-tight font-bold">{t(`${step}.title`)}</p>
        <p className="text-muted mt-1 text-sm">{t(`${step}.body`)}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => advance.mutate('DONE')}
            data-testid="tutorial-skip"
          >
            {t('skip')}
          </Button>
          {step === 'WELCOME' ? (
            <Button size="md" onClick={() => advance.mutate('SELECT_INCIDENT')} data-testid="tutorial-start">
              {t('start')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
