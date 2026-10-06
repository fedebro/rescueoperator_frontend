'use client';
import * as React from 'react';

export interface VisualViewportState {
  /** Visible size in CSS px (the layout viewport when the API is missing). */
  width: number;
  height: number;
  /** Where the visible area sits inside the layout viewport: iOS scrolls the page to reveal a focused field. */
  offsetTop: number;
  offsetLeft: number;
  /** Layout-viewport pixels hidden under the visible area — the on-screen keyboard, mostly. */
  bottomInset: number;
  /** `bottomInset` is tall enough to be a keyboard rather than a browser bar sliding in. */
  keyboardOpen: boolean;
  /** `window.visualViewport` exists (every modern browser; false on the server and in old WebViews). */
  supported: boolean;
}

/** Browser toolbars animate by up to ~100 px; a keyboard is never that short. */
export const KEYBOARD_MIN_PX = 120;

const SERVER: VisualViewportState = {
  width: 0,
  height: 0,
  offsetTop: 0,
  offsetLeft: 0,
  bottomInset: 0,
  keyboardOpen: false,
  supported: false,
};

let cached: VisualViewportState = SERVER;

const same = (a: VisualViewportState, b: VisualViewportState) =>
  a.width === b.width &&
  a.height === b.height &&
  a.offsetTop === b.offsetTop &&
  a.offsetLeft === b.offsetLeft &&
  a.supported === b.supported;

/** The current state; the same object is returned while nothing changed (what `useSyncExternalStore` needs). */
export function readVisualViewport(): VisualViewportState {
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const height = Math.round(vv ? vv.height : layoutHeight);
  const offsetTop = Math.round(vv ? vv.offsetTop : 0);
  const bottomInset = Math.max(0, Math.round(layoutHeight - height - offsetTop));
  const next: VisualViewportState = {
    width: Math.round(vv ? vv.width : window.innerWidth),
    height,
    offsetTop,
    offsetLeft: Math.round(vv ? vv.offsetLeft : 0),
    bottomInset,
    keyboardOpen: bottomInset >= KEYBOARD_MIN_PX,
    supported: !!vv,
  };
  if (same(cached, next) && cached.bottomInset === next.bottomInset) return cached;
  cached = next;
  return next;
}

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  vv?.addEventListener('resize', onChange);
  vv?.addEventListener('scroll', onChange);
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    vv?.removeEventListener('resize', onChange);
    vv?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

/**
 * The visual viewport (study 09 §3): the part of the page the player can actually see, which shrinks when the on-screen
 * keyboard opens and moves when iOS scrolls the page to show a focused field. Re-renders on every change; SSR-safe.
 */
export function useVisualViewport(): VisualViewportState {
  return React.useSyncExternalStore(subscribe, readVisualViewport, () => SERVER);
}
