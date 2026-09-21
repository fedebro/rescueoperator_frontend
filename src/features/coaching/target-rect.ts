'use client';
import * as React from 'react';

/**
 * Tracks the bounding rect of the first visible element matching `selector`, polling because the target can move
 * (layout shift, a sheet opening, data arriving) without emitting a DOM mutation event worth observing for this.
 * Extracted from the guided tutorial (`features/game/tutorial-overlay.tsx`) so every spotlight in the app — the
 * tutorial's own steps and the game-wide coach marks in `coach-mark.tsx` — shares one implementation.
 */
export function useTargetRect(selector: string | undefined): DOMRect | null {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useEffect(() => {
    if (!selector) return;
    const measure = () => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0,
      );
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) =>
        prev &&
        r &&
        Math.abs(prev.x - r.x) < 1 &&
        Math.abs(prev.y - r.y) < 1 &&
        Math.abs(prev.width - r.width) < 1 &&
        Math.abs(prev.height - r.height) < 1
          ? prev
          : r,
      );
    };
    const first = requestAnimationFrame(measure);
    const timer = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [selector]);
  return selector ? rect : null;
}
