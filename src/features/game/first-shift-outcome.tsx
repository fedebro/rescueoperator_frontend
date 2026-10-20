'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { PhoneIncoming, Star, Trophy, X } from 'lucide-react';
import type { IncidentOutcomeDto, SyncSnapshot } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useServerNow } from '@/hooks/use-server-now';
import { useLatest } from '@/hooks/use-latest';
import { cn } from '@/lib/utils';
import { useCareerId, useSnapshot } from './hooks';
import { useUiStore } from '@/stores/ui';
import {
  currentLessonIncident,
  firstShiftOf,
  isFirstShiftOutcome,
  rememberFirstShiftIncidents,
  secondsUntil,
  type FirstShiftLesson,
} from './first-shift';

/** How long the card stays when no next call is announced (the 5th mission) or once the next call is there. */
const HOLD_MS = 9_000;
/** The credits / XP count up over this long. */
const COUNT_MS = 900;

/** Counts from 0 to `to` once, on mount (respects reduced motion: shows the value at once). */
function useCountUp(to: number): number {
  const [value, setValue] = React.useState(0);
  const [reduce] = React.useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  const instant = reduce || to === 0;
  React.useEffect(() => {
    if (instant) return;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / COUNT_MS);
      setValue(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, instant]);
  return instant ? to : value;
}

interface Shown {
  outcome: IncidentOutcomeDto;
  mission: number | null;
  lesson: FirstShiftLesson | null;
}

/**
 * «Esito festeggiato e breve» of the first shift (study §3.2): instead of the outcome dialog, a card that celebrates the
 * mission — stars, credits and experience counting up, one line on what went well — and right away «Nuova chiamata tra 8 s…»
 * from `career.firstShift.nextCallAt`. Nothing to close to go on: the outcome is acknowledged at once, the card leaves by
 * itself when the next call arrives (or after a few seconds), the × only hides it sooner.
 */
export function FirstShiftOutcome() {
  const careerId = useCareerId();
  const { pendingOutcomes, career, incidents } = useSnapshot();
  const qc = useQueryClient();
  const [shown, setShown] = React.useState<Shown | null>(null);

  // Keep track of the first-shift calls while they are in the world: their outcome arrives once they have left it.
  React.useEffect(() => rememberFirstShiftIncidents(incidents), [incidents]);

  // The next call is in while the player still looks at the call just finished (the phone sheet shows it RESOLVING or its
  // «closed» notice): back to the list at once, where the new call waits — one call at a time, never a dead end.
  const openCallId = currentLessonIncident(incidents.filter((i) => i.status !== 'RESOLVING'))?.id ?? null;
  const selectedId = useUiStore((st) => (st.selection?.kind === 'incident' ? st.selection.id : null));
  const selectedIncident = selectedId ? incidents.find((i) => i.id === selectedId) : undefined;
  const stale =
    !!openCallId &&
    !!selectedId &&
    selectedId !== openCallId &&
    (!selectedIncident || (!!selectedIncident.firstShift && selectedIncident.status === 'RESOLVING'));
  React.useEffect(() => {
    if (stale) useUiStore.getState().clearSelection();
  }, [stale]);

  const ack = useMutation({
    mutationFn: (incidentId: string) => gameApi.ackOutcome(careerId, incidentId),
    onMutate: (incidentId) => {
      qc.setQueryData<SyncSnapshot>(qk.sync(careerId), (s) =>
        s ? { ...s, pendingOutcomes: s.pendingOutcomes.filter((o) => o.incidentId !== incidentId) } : s,
      );
    },
  });
  const ackRef = useLatest(ack.mutate);

  // A new first-shift outcome: shown at once (state adjusted during render), acknowledged right after.
  const pending = pendingOutcomes.find((o) => isFirstShiftOutcome(o, career));
  const [lastId, setLastId] = React.useState<string | null>(null);
  if (pending && pending.incidentId !== lastId) {
    setLastId(pending.incidentId);
    const info = firstShiftOf(pending.incidentId);
    setShown({ outcome: pending, mission: info?.mission ?? null, lesson: info?.lesson ?? null });
  }
  const pendingId = pending?.incidentId ?? null;
  React.useEffect(() => {
    if (pendingId) ackRef.current(pendingId);
  }, [pendingId, ackRef]);

  // Leaves by itself: once the next first-shift call is in (a short beat to read it), or HOLD_MS after a last mission.
  const nextCallAt = career.firstShift?.nextCallAt ?? null;
  const nextArrived =
    !!shown &&
    incidents.some((i) => i.firstShift && shown.mission !== null && i.firstShift.mission > shown.mission);
  React.useEffect(() => {
    if (!shown) return;
    const wait = nextArrived ? 1_500 : nextCallAt ? null : HOLD_MS;
    if (wait === null) return;
    const id = setTimeout(() => setShown(null), wait);
    return () => clearTimeout(id);
  }, [shown, nextArrived, nextCallAt]);

  if (!shown) return null;
  return (
    <OutcomeCard
      key={shown.outcome.incidentId}
      shown={shown}
      nextCallAt={nextCallAt}
      finished={!career.firstShift || (shown.mission ?? 0) >= 5}
      onClose={() => setShown(null)}
    />
  );
}

function OutcomeCard({
  shown,
  nextCallAt,
  finished,
  onClose,
}: {
  shown: Shown;
  nextCallAt: string | null;
  finished: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('firstShift.outcome');
  const locale = useLocale();
  const now = useServerNow(500);
  const { outcome } = shown;
  const credits = useCountUp(Number(outcome.netCredits));
  const xp = useCountUp(Number(outcome.xp));
  const seconds = secondsUntil(nextCallAt, now);
  const fast = outcome.notes.some((n) => n.key === 'outcome.note.FAST_RESPONSE');
  const praise = shown.lesson ? `praise.${shown.lesson}` : fast ? 'praise.FAST' : 'praise.DEFAULT';
  const number = new Intl.NumberFormat(locale);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--rc-safe-top)+var(--rc-topbar-h)+8px)] z-[58] flex justify-center px-3 lg:top-[calc(var(--rc-safe-top)+16px)] lg:left-[var(--rc-sidebar-w)]"
      data-testid="first-shift-outcome"
      data-mission={shown.mission ?? ''}
    >
      <section
        role="status"
        aria-live="polite"
        aria-label={t('label')}
        className="border-success/50 bg-surface-2 shadow-panel animate-fade-in pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-xl border"
      >
        <div className="flex items-start gap-3 p-3.5 pr-11">
          <span
            className="bg-success/15 text-success grid size-10 shrink-0 place-items-center rounded-full"
            aria-hidden
          >
            <Trophy className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="font-display text-base leading-tight font-bold"
              data-testid="first-shift-outcome-title"
            >
              {finished
                ? t('finishedTitle')
                : shown.mission
                  ? t('title', { mission: shown.mission })
                  : t('titleGeneric')}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                role="img"
                aria-label={t('stars', { stars: outcome.stars })}
                className="flex gap-0.5"
                data-testid="first-shift-outcome-stars"
                data-stars={outcome.stars}
              >
                {[1, 2, 3].map((i) => (
                  <Star
                    key={i}
                    aria-hidden
                    className={cn(
                      'size-4',
                      i <= outcome.stars ? 'fill-credits text-credits' : 'text-surface-4',
                    )}
                  />
                ))}
              </span>
              <span className="text-credits font-bold tabular-nums" data-testid="first-shift-outcome-credits">
                {t('credits', { amount: number.format(credits) })}
              </span>
              <span className="text-xp font-bold tabular-nums">{t('xp', { amount: number.format(xp) })}</span>
            </div>
            <p className="text-muted mt-1 text-xs">{t(praise as never)}</p>
          </div>
        </div>
        {finished ? (
          <p
            className="bg-surface-1 text-muted px-3.5 py-2 text-xs"
            data-testid="first-shift-outcome-finished"
          >
            {t('finishedBody')}
          </p>
        ) : seconds !== null ? (
          <p
            className="bg-brand/10 text-brand-text flex items-center gap-2 px-3.5 py-2 text-sm font-semibold"
            data-testid="first-shift-next-call"
          >
            <PhoneIncoming className="size-4 shrink-0" aria-hidden />
            {seconds > 0 ? t('nextCallIn', { seconds }) : t('nextCallNow')}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('hide')}
          className="text-subtle hover:text-fg hover:bg-surface-3 absolute top-1 right-1 grid size-10 place-items-center rounded-full"
          data-testid="first-shift-outcome-close"
        >
          <X className="size-4" aria-hidden />
        </button>
      </section>
    </div>
  );
}
