'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Flame, Navigation, Radio, Siren } from 'lucide-react';
import type { IncidentDto, VehicleDto } from '@/contracts';
import { useServerNow } from '@/hooks/use-server-now';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';
import { DONE_LINE, deriveStory, storyIncident, type StoryLine, type StoryPhase } from './live-story-model';
import { useSnapshot } from './hooks';

/** How long «Intervento concluso» stays on the map strip once the narrated incident has closed. */
const DONE_HOLD_MS = 6_000;

const PHASE_ICON: Record<StoryPhase, React.ComponentType<{ className?: string }>> = {
  PREPARING: Siren,
  LEAVING: Siren,
  EN_ROUTE: Navigation,
  ARRIVED: Flame,
  WORKING: Flame,
  ALMOST_DONE: Flame,
  RESOLVING: Radio,
  DONE: CheckCircle2,
};

function useStoryText(): (line: StoryLine) => string {
  const t = useTranslations('liveStory');
  return React.useCallback((line) => t(line.key as never, line.params as never), [t]);
}

/**
 * The story of one incident as it happens: the current line, the bar, and the last two lines above it, faded — the
 * «scheda dell'emergenza» part. Lines are kept per phase so the history reads like a radio log, never a ticker.
 */
function useStoryHistory(incident: IncidentDto, vehicles: VehicleDto[], now: number) {
  const line = deriveStory(incident, vehicles, now);
  const text = useStoryText();
  const [history, setHistory] = React.useState<{ phase: StoryPhase; text: string }[]>([]);
  const current = line ? text(line) : null;
  const phase = line?.phase ?? null;
  // Adjusted during render (no effect): the last entry follows the current line, a new phase opens a new entry.
  const last = history.at(-1);
  if (phase && current && (last?.phase !== phase || last.text !== current))
    setHistory((h) => {
      const tail = h.at(-1);
      if (tail?.phase === phase)
        return tail.text === current ? h : [...h.slice(0, -1), { phase, text: current }];
      return [...h, { phase, text: current }].slice(-3);
    });
  return { line, current, history };
}

export function LiveStoryCard({ incident }: { incident: IncidentDto }) {
  const { vehicles } = useSnapshot();
  const t = useTranslations('liveStory');
  const now = useServerNow(1000);
  const { line, current, history } = useStoryHistory(incident, vehicles, now);
  if (!line || !current) return null;
  const Icon = PHASE_ICON[line.phase];
  const earlier = history.slice(0, -1);
  return (
    <section
      className="border-info/30 bg-info/5 flex flex-col gap-1.5 rounded-md border px-3 py-2.5"
      aria-label={t('label')}
      data-testid="live-story"
      data-phase={line.phase}
    >
      {earlier.length > 0 ? (
        <ol className="text-subtle flex flex-col gap-0.5 text-xs" aria-hidden>
          {earlier.map((h) => (
            <li key={h.phase} className="truncate">
              {h.text}
            </li>
          ))}
        </ol>
      ) : null}
      <p
        className="flex items-center gap-2 text-sm font-semibold"
        aria-live="polite"
        data-testid="live-story-line"
      >
        <Icon className="text-info size-4 shrink-0" aria-hidden />
        <span className="min-w-0">{current}</span>
      </p>
      <StoryBar value={line.progress} label={t('label')} />
    </section>
  );
}

function StoryBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="bg-surface-3 h-1.5 overflow-hidden rounded-full"
      data-testid="live-story-progress"
    >
      <div
        className="bg-info h-full rounded-full transition-[width] duration-1000 ease-linear"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The compact strip on the map: the same story for the incident whose units moved last, one line + the bar, tappable to open
 * the incident. Stays a few seconds on «Intervento concluso» once the call has closed. Hidden on a phone while that very
 * incident is open in the sheet (the card there tells the same story).
 */
export function LiveStoryStrip({
  className,
  hideForSelected,
}: {
  className?: string;
  hideForSelected?: boolean;
}) {
  const { incidents, vehicles } = useSnapshot();
  const t = useTranslations('liveStory');
  const text = useStoryText();
  const select = useUiStore((s) => s.select);
  const selection = useUiStore((s) => s.selection);
  const narrated = storyIncident(incidents, vehicles);
  const now = useServerNow(1000);
  const narratedId = narrated?.id ?? null;
  // Once the last narrated call is gone, «Intervento concluso» for a few seconds, then nothing (adjusted during render).
  const [previous, setPrevious] = React.useState<string | null>(null);
  const [doneFor, setDoneFor] = React.useState<string | null>(null);
  if (narratedId !== previous) {
    setPrevious(narratedId);
    if (narratedId) setDoneFor(null);
    else if (previous && !incidents.some((i) => i.id === previous)) setDoneFor(previous);
  }
  React.useEffect(() => {
    if (!doneFor) return;
    const id = setTimeout(() => setDoneFor(null), DONE_HOLD_MS);
    return () => clearTimeout(id);
  }, [doneFor]);

  const line = narrated ? deriveStory(narrated, vehicles, now) : doneFor !== null ? DONE_LINE : null;
  if (!line) return null;
  if (hideForSelected && narrated && selection?.kind === 'incident' && selection.id === narrated.id)
    return null;
  const Icon = PHASE_ICON[line.phase];
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Icon
          className={cn('size-4 shrink-0', line.phase === 'DONE' ? 'text-success' : 'text-info')}
          aria-hidden
        />
        <span className="min-w-0 truncate" data-testid="live-strip-line">
          {text(line)}
        </span>
      </span>
      <StoryBar value={line.progress} label={t('label')} />
    </>
  );
  return (
    <div
      className={cn('pointer-events-none z-20 flex justify-center px-2', className)}
      data-testid="live-strip"
      data-phase={line.phase}
    >
      {narrated ? (
        <button
          type="button"
          onClick={() => select({ kind: 'incident', id: narrated.id })}
          aria-label={`${t('open')}: ${text(line)}`}
          aria-live="polite"
          className="border-border-strong bg-surface-2/95 shadow-panel pointer-events-auto flex w-full max-w-sm flex-col gap-1.5 rounded-lg border px-3 py-2 text-left backdrop-blur"
        >
          {body}
        </button>
      ) : (
        <div
          role="status"
          className="border-success/40 bg-surface-2/95 shadow-panel flex w-full max-w-sm flex-col gap-1.5 rounded-lg border px-3 py-2"
        >
          {body}
        </div>
      )}
    </div>
  );
}
