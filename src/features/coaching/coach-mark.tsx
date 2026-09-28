'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { track } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { useCareerIdOptional } from '@/features/game/hooks';
import { useCoachingEnabled, useCoachSeen, markCoachSeen } from './store';
import { useTargetRect } from './target-rect';

export interface CoachMarkProps {
  /** Stable id, unique game-wide (e.g. "crewInsufficient"). Persisted as "seen" per career. */
  id: string;
  /** The real state transition this coach mark is tied to — shown only while true (and unseen, and coaching is on). */
  when: boolean;
  /** CSS selector of the element to spotlight, queried document-wide. Mount this component once per screen: if two
   * instances with the same `id` could ever be active at once, gate `when` so only the first occurrence claims it
   * (see `dispatch-panel.tsx`, which fires this from the panel once for every option row instead of from each row).
   * Keep the target small and self-contained (a title, a compact alert row) — never a whole tall section: the coach
   * mark's own dismiss card is positioned near the target and would otherwise cover the controls inside it. */
  selector: string;
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
  /**
   * Which side of the target the card prefers when both have room (default: above). `below` for a target at the top of a
   * page whose navigation (tabs, header) sits right above it: the card must never cover the way around the screen.
   */
  prefer?: 'above' | 'below';
}

/**
 * Generalises the guided tutorial's spotlight (`features/game/tutorial-overlay.tsx`, same box-shadow cutout via
 * `useTargetRect`) into a one-off hint any screen can attach to a real condition instead of a fixed step sequence:
 * "the first time you see a CREW_INSUFFICIENT warning", "the first time a vehicle breaks down", etc.
 *
 * Fires once per career (tracked in `store.ts`), never blocks the spotlighted control (`pointer-events: none` on the
 * wrapper, the card itself is the only clickable surface), is silent entirely when the player turned "Suggerimenti
 * attivi" off in Settings, and is always dismissible from the keyboard (Escape, or the close button).
 */
export function CoachMark({
  id,
  when,
  selector,
  title,
  body,
  actionLabel,
  actionHref,
  prefer = 'above',
}: CoachMarkProps) {
  // Coach marks can render outside of a career (e.g. an admin-only account with no career of their own): fall back
  // to a fixed pseudo-id rather than crashing, same as `SectionPrimer`.
  const careerId = useCareerIdOptional() ?? '_no_career';
  // A distinct label ("Got it", not the generic "Chiudi" every dialog's own close button uses): a coach mark can
  // appear unannounced next to another dialog's close control, and the two must never collide as the same
  // accessible name (e.g. for `getByRole('button', { name })` in tests, and for a screen reader telling them apart).
  const tk = useTranslations('coaching');
  const closeLabel = tk('gotIt');
  const enabled = useCoachingEnabled();
  const seen = useCoachSeen(careerId, `mark:${id}`);
  const active = enabled && when && !seen;
  const target = useTargetRect(active ? selector : undefined);
  const shown = active && !!target;

  const dismiss = React.useCallback(() => {
    markCoachSeen(careerId, `mark:${id}`);
    track('coach_mark_dismissed', { id });
  }, [careerId, id]);

  const announced = React.useRef(false);
  React.useEffect(() => {
    if (shown && !announced.current) {
      announced.current = true;
      track('coach_mark_shown', { id });
    }
    if (!active) announced.current = false;
  });

  React.useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, dismiss]);

  if (!shown || !target) return null;

  const pad = 6;
  const gap = 10;
  // A ROUGH ceiling for the card's own height (title + body + one action row): enough to decide which side of the
  // target has room, without needing to measure the card itself before it has rendered.
  const cardHeightEstimate = 170;
  const viewportH = window.innerHeight;
  const spaceAbove = target.top;
  const spaceBelow = viewportH - target.bottom;
  // Anchored to the TARGET, not to a fixed screen edge: the previous version always docked the card at the top or
  // bottom of the whole screen, which could land it on top of the very controls it was explaining when the target
  // sat low in a tall, scrollable panel (e.g. the hospital-transport panel on a phone) — a real "never blocks input"
  // regression a real e2e run caught (`medical.spec.ts`, mobile: `choose-other-hospital` covered by the coach mark).
  const placeAbove =
    prefer === 'below'
      ? !(spaceBelow >= cardHeightEstimate || spaceBelow >= spaceAbove)
      : spaceAbove >= cardHeightEstimate || spaceAbove >= spaceBelow;
  const verticalStyle: React.CSSProperties = placeAbove
    ? { bottom: Math.max(12, viewportH - target.top + gap) }
    : { top: Math.min(target.bottom + gap, Math.max(12, viewportH - cardHeightEstimate)) };
  const node = (
    <div className="pointer-events-none fixed inset-0 z-[55]" data-testid="coach-mark" data-coach-id={id}>
      <div
        aria-hidden
        className="border-focus absolute rounded-lg border-2 transition-all duration-200"
        style={{
          left: target.left - pad,
          top: target.top - pad,
          width: target.width + pad * 2,
          height: target.height + pad * 2,
          boxShadow: '0 0 0 9999px rgb(3 7 14 / 0.4)',
        }}
      />
      <div
        role="status"
        aria-live="polite"
        className="border-border-strong bg-surface-2 shadow-panel pointer-events-auto absolute inset-x-3 mx-auto max-w-xs rounded-lg border p-3.5"
        style={verticalStyle}
      >
        <p className="font-display text-sm font-bold">{title}</p>
        <p className="text-muted mt-1 text-xs">{body}</p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {actionHref && actionLabel ? (
            <Button asChild size="sm" variant="secondary" onClick={dismiss}>
              <Link href={actionHref}>{actionLabel}</Link>
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={dismiss}
            aria-label={closeLabel}
            data-testid="coach-mark-dismiss"
          >
            <X className="size-3.5" aria-hidden />
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
