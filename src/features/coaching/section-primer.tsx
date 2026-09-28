'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, HelpCircle, Lightbulb, X } from 'lucide-react';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useCareerIdOptional } from '@/features/game/hooks';
import { markCoachSeen, useCoachingEnabled, useCoachSeen } from './store';

/** Phones (portrait, or landscape narrower than a tablet): the primer is one line until the player opens it (03 §2.5). */
const useCompactPrimer = (): boolean => useMediaQuery('(max-width: 767.98px)', false);
/** Longest title that still leaves room for "· Scopri di più" on one line of a 375 px phone. */
const SHORT_PRIMER_TITLE = 20;

export interface SectionCoachingContent {
  /** Stable key, unique game-wide (e.g. "personnel", "shop:EMS", "inventory"). Persisted as "seen" per career. */
  sectionKey: string;
  title: string;
  body: string;
  /** One or two short, concrete tips — never a wall of text. */
  tips?: readonly string[];
}

/**
 * First-visit primer for a major section: what this screen is for, the one or two things you can do here, one
 * concrete tip. Shown once per career per section (tracked in `store.ts`, same "seen" pattern as
 * `family-unlock-celebration.tsx`), dismissible, never blocking — it is an inline banner in the page flow, not an
 * overlay, so it never intercepts a click on the real controls below it. Silent entirely when "Suggerimenti attivi"
 * is off; re-enabling it never replays a primer the player already dismissed (only never-seen ones can still show).
 *
 * Phones (03 §2.5): a single line (lightbulb icon, "Personale · Scopri di più") instead of a box pushing the content off screen.
 * Opening it counts as reading it: it stays open while the player reads, then closes by itself for good ("Ho capito",
 * or folding it back). Every explanation stays one tap away from the section's "?" (`SectionHelpButton`).
 */
export function SectionPrimer({
  content: { sectionKey, title, body, tips },
}: {
  content: SectionCoachingContent;
}) {
  // A primer can render outside of a career (e.g. `/admin` for a staff-only account with no career of its own): fall
  // back to a fixed pseudo-id rather than crashing.
  const careerId = useCareerIdOptional() ?? '_no_career';
  // A distinct, self-contained label (not the generic "Chiudi" every dialog's own close button uses): a primer can
  // appear unannounced next to another dialog's close control, and the two must never collide as the same accessible
  // name (e.g. for `getByRole('button', { name })` in tests, and for a screen-reader user telling them apart).
  const tk = useTranslations('coaching');
  const closeLabel = tk('dismissPrimerLabel');
  const enabled = useCoachingEnabled();
  const seen = useCoachSeen(careerId, `primer:${sectionKey}`);
  const compact = useCompactPrimer();
  // Opened on a phone in this visit: it stays on screen while being read even though it already counts as seen.
  const [reading, setReading] = React.useState(false);
  const visible = enabled && (!seen || reading);
  const bodyId = React.useId();

  const announced = React.useRef(false);
  React.useEffect(() => {
    if (visible && !announced.current) {
      announced.current = true;
      track('coaching_primer_shown', { section: sectionKey });
    }
  }, [visible, sectionKey]);

  if (!visible) return null;
  const dismiss = () => {
    setReading(false);
    markCoachSeen(careerId, `primer:${sectionKey}`);
    track('coaching_primer_dismissed', { section: sectionKey });
  };
  const tipList =
    tips && tips.length > 0 ? (
      <ul className="mt-1 flex flex-col gap-1">
        {tips.map((tip) => (
          <li key={tip} className="text-muted flex items-start gap-1.5 text-xs">
            <Lightbulb className="text-skyline mt-0.5 size-3.5 shrink-0" aria-hidden />
            {tip}
          </li>
        ))}
      </ul>
    ) : null;

  if (compact) {
    const open = () => {
      setReading(true);
      markCoachSeen(careerId, `primer:${sectionKey}`);
      track('coaching_primer_opened', { section: sectionKey });
    };
    return (
      <div
        role="note"
        aria-live="polite"
        data-testid="section-primer"
        data-section={sectionKey}
        data-compact=""
        data-open={reading || undefined}
        onKeyDown={(e) => e.key === 'Escape' && dismiss()}
        className="border-border-strong bg-surface-2 relative flex flex-col rounded-lg border text-sm"
      >
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => (reading ? dismiss() : open())}
            aria-expanded={reading}
            aria-controls={bodyId}
            data-testid="section-primer-toggle"
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 pl-3 text-left"
          >
            <Lightbulb className="text-skyline size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate font-semibold">{title}</span>
            {/* The cue fits next to a short title; a long one keeps the room, the chevron says the rest. */}
            {title.length <= SHORT_PRIMER_TITLE ? (
              <span className="text-skyline shrink-0">
                · {reading ? tk('primer.less') : tk('primer.more')}
              </span>
            ) : (
              <span className="sr-only">{reading ? tk('primer.less') : tk('primer.more')}</span>
            )}
            <ChevronDown
              className={cn('text-muted size-4 shrink-0 transition-transform', reading && 'rotate-180')}
              aria-hidden
            />
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={closeLabel}
            data-testid="section-primer-dismiss"
            className="text-muted hover:text-fg grid size-11 shrink-0 place-items-center rounded-md"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {reading ? (
          <div id={bodyId} className="flex flex-col gap-1.5 px-3 pb-3">
            <p className="text-muted">{body}</p>
            {tipList}
            <Button
              variant="secondary"
              size="sm"
              className="mt-1 h-11 self-start"
              onClick={dismiss}
              data-testid="section-primer-done"
            >
              {tk('gotIt')}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-live="polite"
      data-testid="section-primer"
      data-section={sectionKey}
      onKeyDown={(e) => e.key === 'Escape' && dismiss()}
      className="border-border-strong bg-surface-2 relative flex flex-col gap-1.5 rounded-lg border p-4 pr-11 text-sm"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={closeLabel}
        data-testid="section-primer-dismiss"
        className="text-muted hover:text-fg hover:bg-surface-3 absolute top-2 right-2 grid size-9 place-items-center rounded-md"
      >
        <X className="size-4" aria-hidden />
      </button>
      <p className="font-display pr-1 font-bold">{title}</p>
      <p className="text-muted">{body}</p>
      {tipList}
    </div>
  );
}

/**
 * Persistent "?" help affordance for a major section (desktop: section header; mobile: same spot, touch-sized):
 * reopens the section's primer content on demand for a player who skipped or forgot it, regardless of "seen" state
 * and regardless of the coaching on/off setting — it is an explicit request, so it always works.
 */
export function SectionHelpButton({
  content: { sectionKey, title, body, tips },
  label,
  closeLabel,
  withLabel,
}: {
  content: SectionCoachingContent;
  label: string;
  closeLabel: string;
  /** A text button ("? Aiuto su questa sezione") for panels without a title row to host the bare icon. */
  withLabel?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const onOpen = () => {
    setOpen(true);
    track('coaching_help_opened', { section: sectionKey });
  };
  const testId = `section-help-${sectionKey.split(':')[0]}`;
  return (
    <>
      {withLabel ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 gap-1.5 lg:h-9"
          onClick={onOpen}
          data-testid={testId}
        >
          <HelpCircle className="size-4" aria-hidden />
          {label}
        </Button>
      ) : (
        <IconButton
          label={label}
          size="sm"
          // Touch-sized on phones and tablets (44 px), compact next to a desktop title.
          className="size-11 lg:size-8"
          onClick={onOpen}
          data-testid={testId}
        >
          <HelpCircle className="size-5" aria-hidden />
        </IconButton>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={body} closeLabel={closeLabel}>
          {tips && tips.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {tips.map((tip) => (
                <li key={tip} className="flex items-start gap-2 text-sm">
                  <Lightbulb className="text-skyline mt-0.5 size-4 shrink-0" aria-hidden />
                  {tip}
                </li>
              ))}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
