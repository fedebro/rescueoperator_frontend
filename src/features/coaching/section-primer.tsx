'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { HelpCircle, Lightbulb, X } from 'lucide-react';
import { track } from '@/lib/analytics';
import { IconButton } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useCareerIdOptional } from '@/features/game/hooks';
import { markCoachSeen, useCoachingEnabled, useCoachSeen } from './store';

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
  const visible = enabled && !seen;

  const announced = React.useRef(false);
  React.useEffect(() => {
    if (visible && !announced.current) {
      announced.current = true;
      track('coaching_primer_shown', { section: sectionKey });
    }
  }, [visible, sectionKey]);

  if (!visible) return null;
  const dismiss = () => {
    markCoachSeen(careerId, `primer:${sectionKey}`);
    track('coaching_primer_dismissed', { section: sectionKey });
  };
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
      {tips && tips.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1">
          {tips.map((tip) => (
            <li key={tip} className="text-muted flex items-start gap-1.5 text-xs">
              <Lightbulb className="text-skyline mt-0.5 size-3.5 shrink-0" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      ) : null}
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
}: {
  content: SectionCoachingContent;
  label: string;
  closeLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <IconButton
        label={label}
        size="sm"
        onClick={() => {
          setOpen(true);
          track('coaching_help_opened', { section: sectionKey });
        }}
        data-testid={`section-help-${sectionKey.split(':')[0]}`}
      >
        <HelpCircle className="size-5" aria-hidden />
      </IconButton>
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
