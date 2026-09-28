'use client';
import * as React from 'react';
import { useLatest } from '@/hooks/use-latest';

/**
 * Android / browser Back for the operations screen (02 §4 #4): Back first closes the inspector (back to the list as it
 * was), then lowers the raised sheet, and only then leaves the page.
 *
 * One "guard" history entry (same URL, marked `rcSheetGuard`) sits on top while anything is open. Back pops it: the
 * top layer closes and, if another one is still open, the guard goes back on. Layers closed any other way (X, a
 * drag, a tap on the map, an incident that resolves) leave the guard where it is — never a programmatic traversal,
 * which could land after the player's next tap on a link and undo that navigation — and a Back on such a stale
 * guard simply carries on to where the player was going. Next.js copies its router state into the entry, so its own
 * popstate handling treats these as no-op traversals of the same page.
 */
export type SheetLevel = 'sheet' | 'inspector';
export const GUARD_KEY = 'rcSheetGuard';

export interface HistoryLike {
  readonly state: unknown;
  pushState: (data: unknown, unused: string) => void;
  back: () => void;
}

const isGuard = (state: unknown): boolean => (state as Record<string, unknown> | null)?.[GUARD_KEY] === 1;

/** The part that talks to the history, free of React so it can be unit-tested with a fake history. */
export class SheetHistory {
  /** Whether the entry the browser is on is our guard. */
  guard = false;

  constructor(private readonly history: HistoryLike) {}

  /** Re-aligns with the entry the browser is on (after a visit to another page, a reload…). */
  syncFromEntry(): void {
    this.guard = isGuard(this.history.state);
  }

  /** Called whenever the number of open layers changes: something open → a guard on top. */
  reconcile(openLayers: number): void {
    if (openLayers > 0 && !this.guard) {
      this.history.pushState({ [GUARD_KEY]: 1 }, '');
      this.guard = true;
    }
  }

  /**
   * A popstate, with the layers open right now (bottom first). Returns the layers the player closed with Back — the
   * caller closes them in the UI.
   */
  onPopState(state: unknown, open: readonly SheetLevel[]): SheetLevel[] {
    const landedOnGuard = isGuard(state);
    const leftGuard = this.guard && !landedOnGuard;
    this.guard = landedOnGuard;
    if (!leftGuard) return [];
    if (open.length === 0) {
      // A stale guard (everything was already closed): finish the Back the player asked for.
      this.history.back();
      return [];
    }
    if (open.length > 1) this.reconcile(open.length);
    return [open.at(-1)!];
  }
}

let shared: SheetHistory | null = null;
const sharedHistory = (): SheetHistory => (shared ??= new SheetHistory(window.history));

/**
 * Keeps a Back step available while `levels` (the open layers, bottom first) is not empty and calls `onBack` with the
 * layer the player closed with it. Disabled = no history entries at all (desktop).
 */
export function useSheetHistory(
  levels: readonly SheetLevel[],
  onBack: (closed: SheetLevel[]) => void,
  enabled: boolean,
): void {
  const onBackRef = useLatest(onBack);
  const levelsRef = useLatest(levels);
  const open = enabled ? levels.length : 0;

  React.useEffect(() => {
    if (!enabled) return;
    const h = sharedHistory();
    h.syncFromEntry();
    const onPop = (e: PopStateEvent) => {
      const closed = h.onPopState(e.state, levelsRef.current);
      if (closed.length > 0) onBackRef.current(closed);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [enabled, onBackRef, levelsRef]);

  React.useEffect(() => {
    if (enabled) sharedHistory().reconcile(open);
  }, [enabled, open]);
}
