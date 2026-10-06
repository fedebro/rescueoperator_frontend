'use client';
import * as React from 'react';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useVisualViewport } from '@/hooks/use-visual-viewport';
import { cn } from '@/lib/utils';

export interface KeyboardAwareScreenProps {
  /** Top bar of the screen (title, back, actions). Padded for the status bar / notch. */
  header?: React.ReactNode;
  /** The composer: always visible, right above the keyboard when it is open, above the home indicator when it is not. */
  footer?: React.ReactNode;
  /** The body: a `VirtualList` or any `absolute inset-0` scroll container (the slot is `relative`, fills the rest). */
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
  testId?: string;
}

/**
 * A full-screen page whose footer sits above the on-screen keyboard (study 09 §3 — the chat). Phones: fixed over the
 * whole window (the bottom navigation included), sized to the VISUAL viewport and moved by its offset, so when the
 * keyboard opens the body shrinks and the composer stays visible — in the browser and in the installed app. Desktop:
 * an ordinary column filling its parent. The game shell never scrolls, so nothing else moves.
 */
export function KeyboardAwareScreen({
  header,
  footer,
  children,
  className,
  'aria-label': ariaLabel,
  testId = 'keyboard-aware-screen',
}: KeyboardAwareScreenProps) {
  const viewport = useVisualViewport();
  const desktop = useIsDesktop();
  const follow = !desktop && viewport.supported && viewport.height > 0;
  const style = follow
    ? { height: viewport.height, transform: `translateY(${viewport.offsetTop}px)` }
    : undefined;
  // Desktop fills its parent (the shell's main region); a phone without viewport data takes the whole dynamic viewport.
  // The two classes are decided here, never stacked: `h-dvh-safe` is an unlayered utility that would beat `lg:h-full`.
  const sizing = desktop ? 'h-full' : follow ? undefined : 'h-dvh-safe';
  return (
    <section
      aria-label={ariaLabel}
      data-testid={testId}
      data-keyboard={viewport.keyboardOpen ? 'open' : 'closed'}
      className={cn(
        'bg-bg fixed inset-x-0 top-0 z-[60] flex flex-col lg:static lg:inset-auto lg:z-auto',
        sizing,
        className,
      )}
      style={style}
    >
      {header ? <header className="pt-safe shrink-0 lg:pt-0">{header}</header> : null}
      <div className="relative min-h-0 flex-1">{children}</div>
      {footer ? (
        // The home-indicator padding only while the keyboard is closed: with it open the composer touches the keys.
        <footer className={cn('shrink-0', !viewport.keyboardOpen && 'pb-safe')}>{footer}</footer>
      ) : null}
    </section>
  );
}
