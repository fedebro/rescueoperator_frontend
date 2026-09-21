'use client';
import * as React from 'react';
import { useSettingsStore } from '@/stores/settings';

/**
 * "Seen" tracking for the game-wide contextual-coaching system (section primers + one-off coach marks), generalising
 * the pattern of `features/families/family-unlock-celebration.tsx`: one JSON array per career in localStorage, a tiny
 * external store so React re-renders when it changes, and an in-memory fallback when storage is blocked (private
 * mode, quota exceeded) so a primer can still be dismissed for the rest of the session.
 *
 * Keys are namespaced by kind so a primer and a coach mark can never collide: `primer:<sectionKey>`, `mark:<markId>`.
 */
const storageKey = (careerId: string) => `rc-coach-seen:${careerId}`;

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

function readSeenRaw(careerId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(careerId));
  } catch {
    return null;
  }
}
// Private mode / blocked storage: keep the list in memory so dismissing still works for this session.
const memory = new Map<string, string>();
function writeSeenRaw(careerId: string, raw: string): void {
  memory.set(careerId, raw);
  try {
    window.localStorage.setItem(storageKey(careerId), raw);
  } catch {
    /* storage unavailable: the in-memory copy applies for this session */
  }
  for (const cb of listeners) cb();
}
function parseSeen(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Pure read: has `key` already been dismissed/shown for this career? Safe to call outside React. */
export function hasCoachSeen(careerId: string, key: string): boolean {
  return parseSeen(memory.get(careerId) ?? readSeenRaw(careerId)).includes(key);
}

/** Pure write: mark `key` as seen for this career (idempotent). */
export function markCoachSeen(careerId: string, key: string): void {
  const current = parseSeen(memory.get(careerId) ?? readSeenRaw(careerId));
  if (current.includes(key)) return;
  writeSeenRaw(careerId, JSON.stringify([...current, key]));
}

/** Forgets everything for a career — used only by tests / the mock's `window.__rcMock.reset()` helper family. */
export function resetCoachSeen(careerId: string): void {
  writeSeenRaw(careerId, '[]');
}

/** Reactive read of {@link hasCoachSeen}. */
export function useCoachSeen(careerId: string, key: string): boolean {
  const raw = React.useSyncExternalStore(
    subscribe,
    () => memory.get(careerId) ?? readSeenRaw(careerId),
    () => null,
  );
  const seen = React.useMemo(() => parseSeen(raw), [raw]);
  return seen.includes(key);
}

/**
 * The single settings toggle ("Suggerimenti attivi"): turns every primer and coach mark off at once. It reuses the
 * `tutorialHints` flag already in `useSettingsStore` (wired to nothing until this feature), so the guided first-mission
 * tutorial and the rest of the contextual-coaching system share one on/off switch, as a player expects.
 * Turning it off never clears "seen" state — re-enabling it does not replay everything the player already dismissed.
 */
export function useCoachingEnabled(): boolean {
  return useSettingsStore((s) => s.tutorialHints);
}
