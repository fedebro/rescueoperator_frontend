'use client';
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { useLatest } from '@/hooks/use-latest';
import { cn } from '@/lib/utils';

export type SheetSnap = 'peek' | 'half' | 'full';
const ORDER: SheetSnap[] = ['peek', 'half', 'full'];
const TWO_SNAPS: SheetSnap[] = ['peek', 'full'];

/**
 * Gesture tuning (analisi/studio-2026-09-27/02 §3.4). Exported so tests and the notes quote the real values.
 * Velocities are px/ms, positive = upwards.
 */
export const SHEET_GESTURE = {
  /** Movement under which a press stays a tap (opens the card, cycles the handle) instead of becoming a drag. */
  tapSlop: 7,
  /** The release velocity is averaged over the samples of this last window, not taken from the last sample. */
  velocityWindowMs: 90,
  /** From this release speed the gesture is a flick: it moves exactly one snap in its direction. */
  flickVelocity: 0.45,
  /** A snap closer than this to the release point counts as "where the sheet already is" for a flick. */
  flickTolerance: 8,
  /** Rubber band past the lowest / highest snap: initial give and asymptote (px). */
  rubberGive: 0.55,
  rubberMax: 80,
  /** Settle animation: duration grows with the distance, clamped to this range (ms). */
  settleMinMs: 160,
  settleMaxMs: 300,
  /** Light haptic tick when a drag settles on a different snap (Android; ignored where unsupported). */
  hapticMs: 8,
} as const;

/** Extra sheet surface below the visible area, so the rubber band past `full` never uncovers the map underneath. */
const OVERSCROLL_ROOM = 96;
/** Space kept below a peek anchor that sits in the list (e.g. the first queue card). */
const PEEK_AIR = 10;

/** Height in px of each snap for a given container height. Exported for tests. */
export function snapHeights(
  containerHeight: number,
  peekHeight: number,
  halfRatio = 0.55,
): Record<SheetSnap, number> {
  const full = Math.max(peekHeight, containerHeight);
  return {
    peek: Math.min(peekHeight, full),
    half: Math.min(full, Math.max(peekHeight, Math.round(containerHeight * halfRatio))),
    full,
  };
}

/**
 * Snap for a released height. A slow release goes to the nearest snap; a flick (|velocity| ≥ flickVelocity) goes to
 * the next snap beyond the release point in the direction of the flick — one step from where the sheet is, so a flick
 * never skips half, while a long drag that already passed half can still land on the far end.
 */
export function resolveSnap(
  height: number,
  velocity: number,
  heights: Record<SheetSnap, number>,
  snaps: readonly SheetSnap[] = ORDER,
): SheetSnap {
  const sorted = [...snaps].sort((a, b) => heights[a] - heights[b]);
  if (Math.abs(velocity) >= SHEET_GESTURE.flickVelocity) {
    const tolerance = SHEET_GESTURE.flickTolerance;
    if (velocity > 0) return sorted.find((s) => heights[s] > height + tolerance) ?? sorted.at(-1)!;
    return [...sorted].reverse().find((s) => heights[s] < height - tolerance) ?? sorted[0]!;
  }
  let best = sorted[0]!;
  for (const s of sorted) if (Math.abs(heights[s] - height) < Math.abs(heights[best] - height)) best = s;
  return best;
}

/** Tap on the handle / header: peek → half → full → half — never straight from full down to peek (02 §3.5). */
export function nextTapSnap(current: SheetSnap, snaps: readonly SheetSnap[] = ORDER): SheetSnap {
  const i = Math.max(0, snaps.indexOf(current));
  return i < snaps.length - 1 ? snaps[i + 1]! : snaps[Math.max(0, i - 1)]!;
}

/** Average release velocity over the last `velocityWindowMs` of samples (px/ms, positive = upwards). */
export function releaseVelocity(samples: readonly { t: number; y: number }[], releaseT: number): number {
  const recent = samples.filter((s) => releaseT - s.t <= SHEET_GESTURE.velocityWindowMs);
  // The finger rested before lifting: whatever speed it had earlier is gone.
  if (recent.length < 2) return 0;
  const first = recent[0]!;
  const last = recent.at(-1)!;
  const dt = last.t - first.t;
  return dt <= 0 ? 0 : (first.y - last.y) / dt;
}

const rubber = (overshoot: number): number => {
  const { rubberGive, rubberMax } = SHEET_GESTURE;
  return (1 - 1 / ((overshoot * rubberGive) / rubberMax + 1)) * rubberMax;
};

const INTERACTIVE =
  'button, a, input, select, textarea, label, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"]';

const prefersReducedMotion = (): boolean =>
  document.documentElement.dataset.reducedMotion === 'true' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Visible height (px) in the peek state when no `peekAnchor` is found. */
  peekHeight?: number;
  /**
   * Selector (inside the sheet) of the element whose bottom edge ends the peek state: the peek then shows exactly
   * the strip, everything down to that element and the pinned footer (`[data-sheet-footer]`), measured live.
   */
  peekAnchor?: string;
  /** Share of the container used by the half state (02 §3.6: 50–55%). */
  halfRatio?: number;
  /** Only peek and full (phones in landscape: there is no room for a meaningful half). */
  twoSnap?: boolean;
  /**
   * Positioned inside the nearest positioned ancestor (e.g. the game's `<main>`, which already sits between the top
   * bar — plus any connection banner — and the bottom nav) instead of the viewport.
   */
  contained?: boolean;
  /** Space reserved below the sheet (bottom navigation), CSS length. */
  bottomOffset?: string;
  /** Space kept free above the sheet in the full state, CSS length. */
  topOffset?: string;
  handleLabel: string;
  /** Label of the thumb-reachable "collapse" button shown in the full state. */
  collapseLabel?: string;
  /** Always-visible header inside the drag strip (the whole strip drags and taps like the handle). */
  header?: React.ReactNode;
  /** Identity of the content: its scroll position is remembered per key and restored when the key comes back. */
  scrollKey?: string;
  /** Visible height on every frame while it moves (`settled` false) and once it rests (`settled` true). */
  onVisibleHeight?: (px: number, settled: boolean) => void;
  children: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

interface Gesture {
  id: number;
  touch: boolean;
  startX: number;
  startY: number;
  startH: number;
  startScroll: number;
  scroller: HTMLElement | null;
  inContent: boolean;
  inDragZone: boolean;
  interactive: boolean;
  claimed: boolean;
  abandoned: boolean;
  scrolled: boolean;
  wasMoving: boolean;
  samples: { t: number; y: number }[];
}

/**
 * Non-modal bottom sheet with three snap heights (two on short screens), built for thumbs (02 §3):
 * - the handle, the strip `header` and any `[data-sheet-drag]` element in the content (e.g. an inspector header) drag
 *   the sheet; in peek the whole surface does; a press that moves less than `tapSlop` stays a tap;
 * - list ↔ sheet hand-off: with the list at its top a downward drag moves the sheet; from half an upward drag first
 *   raises the sheet to full and then scrolls the list (`[data-sheet-scroll]` marks the one scroll container);
 * - release velocity averaged over the last ~90 ms, a flick moves exactly one snap, rubber band at both ends;
 * - driven by `transform` from requestAnimationFrame outside React state; the content height (so the list scrolls to
 *   its very end) and the pinned footer (`[data-sheet-footer]`) are re-laid out only when the sheet settles;
 * - keyboard: the handle is a button (Enter/Space = tap cycle, arrows = one snap, Home/PageUp = full,
 *   End/PageDown/Escape = peek).
 */
export function BottomSheet({
  snap,
  onSnapChange,
  peekHeight = 112,
  peekAnchor,
  halfRatio = 0.55,
  twoSnap = false,
  contained = false,
  bottomOffset = '0px',
  topOffset = '0px',
  handleLabel,
  collapseLabel,
  header,
  scrollKey = 'default',
  onVisibleHeight,
  children,
  className,
  ...rest
}: BottomSheetProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const sectionRef = React.useRef<HTMLElement>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = React.useState(0);
  const [stripHeight, setStripHeight] = React.useState(0);
  const [anchorBottom, setAnchorBottom] = React.useState<number | null>(null);
  const [footerHeight, setFooterHeight] = React.useState(0);

  const snaps = twoSnap ? TWO_SNAPS : ORDER;
  const effective: SheetSnap = snaps.includes(snap) ? snap : 'peek';
  const measuredPeek =
    anchorBottom === null ? peekHeight : Math.ceil(stripHeight + anchorBottom + footerHeight);
  const full = Math.max(0, containerHeight);
  const heights = snapHeights(full, Math.min(measuredPeek, full || measuredPeek), halfRatio);

  // Everything the imperative gesture engine needs, always current (written after commit, never during render).
  const live = useLatest({
    effective,
    snaps,
    heights,
    stripHeight,
    onSnapChange,
    onVisibleHeight,
    scrollKey,
  });
  /** Current visible height, as painted. */
  const hRef = React.useRef(0);
  const animRef = React.useRef<number | null>(null);
  const gestureRef = React.useRef<Gesture | null>(null);
  const dragLayoutRef = React.useRef(false);
  const hapticRef = React.useRef(false);
  const settledSnapRef = React.useRef<SheetSnap | null>(null);
  const scrollMemory = React.useRef(new Map<string, number>());
  /** True while a remembered scroll position is being re-applied: the clamped values seen meanwhile are not remembered. */
  const restoringScroll = React.useRef(false);

  // Two-snap screens have no half: whoever asks for it gets peek (e.g. selecting on a phone held in landscape).
  React.useEffect(() => {
    if (snap !== effective) onSnapChange(effective);
  }, [snap, effective, onSnapChange]);

  /* ───────────── imperative painting ───────────── */
  const engine = React.useMemo(() => {
    const scroller = (): HTMLElement | null =>
      viewportRef.current?.querySelector<HTMLElement>('[data-sheet-scroll]') ?? null;
    const footer = (): HTMLElement | null =>
      viewportRef.current?.querySelector<HTMLElement>('[data-sheet-footer]') ?? null;

    const paint = (h: number) => {
      const section = sectionRef.current;
      if (!section) return;
      const { heights: hs } = live.current;
      hRef.current = h;
      section.style.transform = `translate3d(0, ${Math.round(hs.full - h)}px, 0)`;
      if (dragLayoutRef.current) {
        const f = footer();
        if (f) f.style.transform = `translate3d(0, ${Math.round(Math.min(0, h - hs.full))}px, 0)`;
      }
      live.current.onVisibleHeight?.(Math.max(0, h), false);
    };
    /** Content laid out at full height: moving the sheet is then transform-only, and the footer rides along. */
    const enterDragLayout = () => {
      const viewport = viewportRef.current;
      if (!viewport || dragLayoutRef.current) return;
      const { heights: hs, stripHeight: strip } = live.current;
      viewport.style.height = `${Math.max(0, hs.full - strip)}px`;
      dragLayoutRef.current = true;
    };
    /** Content laid out at the rest height: the scroll container ends exactly at the visible bottom. */
    const enterRestLayout = (h: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.style.height = `${Math.max(0, h - live.current.stripHeight)}px`;
      const f = footer();
      if (f) f.style.transform = '';
      dragLayoutRef.current = false;
    };
    const stop = () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      animRef.current = null;
    };
    const settle = (h: number) => {
      stop();
      enterRestLayout(h);
      paint(h);
      const { effective: current, heights: hs } = live.current;
      if (current === 'peek' || h <= hs.peek) {
        // In peek the list is shown from its top (the most urgent card is what the peek is for).
        const s = scroller();
        if (s) s.scrollTop = 0;
      }
      if (hapticRef.current && settledSnapRef.current !== null && settledSnapRef.current !== current)
        navigator.vibrate?.(SHEET_GESTURE.hapticMs);
      hapticRef.current = false;
      settledSnapRef.current = current;
      live.current.onVisibleHeight?.(Math.max(0, h), true);
    };
    const animateTo = (target: number) => {
      stop();
      const from = hRef.current;
      if (prefersReducedMotion() || Math.abs(target - from) < 1) {
        settle(target);
        return;
      }
      enterDragLayout();
      const { settleMinMs, settleMaxMs } = SHEET_GESTURE;
      const duration = Math.min(settleMaxMs, Math.max(settleMinMs, Math.abs(target - from) * 0.6));
      // Timed from the first frame: a frame's timestamp can precede the moment this was called, and a negative
      // progress through the cubic easing would fling the sheet far off-screen for a frame.
      let start: number | null = null;
      const frame = (now: number) => {
        start ??= now;
        const p = Math.min(1, Math.max(0, (now - start) / duration));
        const eased = 1 - (1 - p) ** 3;
        paint(from + (target - from) * eased);
        if (p < 1) animRef.current = requestAnimationFrame(frame);
        else settle(target);
      };
      animRef.current = requestAnimationFrame(frame);
    };
    return { scroller, paint, enterDragLayout, enterRestLayout, stop, settle, animateTo };
  }, [live]);

  /* ───────────── measurements ───────────── */
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const strip = stripRef.current;
    const viewport = viewportRef.current;
    const section = sectionRef.current;
    if (!container || !strip || !viewport || !section) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setContainerHeight(container.clientHeight);
      setStripHeight(strip.offsetHeight);
      const f = viewport.querySelector<HTMLElement>('[data-sheet-footer]');
      setFooterHeight(f ? f.offsetHeight : 0);
      const anchor = peekAnchor ? viewport.querySelector<HTMLElement>(peekAnchor) : null;
      if (!anchor) {
        setAnchorBottom(null);
        return;
      }
      // Bottom edge of the anchor in content coordinates (the list may be scrolled, the sheet may be moving); a
      // list item also gets a little air below it, so the peek never ends flush on its border.
      const inScroller = anchor.closest<HTMLElement>('[data-sheet-scroll]');
      const bottom =
        anchor.getBoundingClientRect().bottom -
        viewport.getBoundingClientRect().top +
        (inScroller ? inScroller.scrollTop + PEEK_AIR : 0);
      setAnchorBottom(Math.max(0, Math.round(bottom)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(container);
    ro?.observe(strip);
    ro?.observe(viewport);
    const observeContent = () => {
      for (const el of viewport.querySelectorAll<HTMLElement>(
        '[data-sheet-footer], [data-sheet-scroll] > *, [data-sheet-drag]',
      ))
        ro?.observe(el);
    };
    observeContent();
    // Cards come and go (and the anchor with them): re-measure after structural changes only, once per frame.
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            observeContent();
            schedule();
          })
        : null;
    mo?.observe(viewport, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [peekAnchor]);

  /* ───────────── rest position: follow the snap (and the measured heights) ───────────── */
  const restHeight = heights[effective];
  const restFull = heights.full;
  const firstPaint = React.useRef(true);
  React.useLayoutEffect(() => {
    if (!restFull) return;
    const g = gestureRef.current;
    if (g?.claimed) return; // the release decides
    if (firstPaint.current) {
      firstPaint.current = false;
      settledSnapRef.current = live.current.effective;
      engine.settle(restHeight);
      return;
    }
    engine.animateTo(restHeight);
  }, [restHeight, restFull, effective, engine, live]);

  React.useEffect(() => () => engine.stop(), [engine]);

  /* ───────────── scroll memory per content key ───────────── */
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (restoringScroll.current) return;
      if (target instanceof HTMLElement && target.matches('[data-sheet-scroll]'))
        scrollMemory.current.set(live.current.scrollKey, target.scrollTop);
    };
    viewport.addEventListener('scroll', onScroll, true);
    return () => viewport.removeEventListener('scroll', onScroll, true);
  }, [live]);
  React.useLayoutEffect(() => {
    const s = engine.scroller();
    const target = scrollMemory.current.get(scrollKey) ?? 0;
    if (!s) return;
    s.scrollTop = target;
    if (target === 0 || s.scrollTop >= target - 1) return;
    // The list may not be laid out yet (WebKit then clamps the position to 0): apply it again on the next frames,
    // for a short while, without remembering the clamped values meanwhile.
    restoringScroll.current = true;
    const until = performance.now() + 1500;
    let frame = requestAnimationFrame(function retry() {
      const el = engine.scroller();
      if (el) el.scrollTop = target;
      if (!el || el.scrollTop >= target - 1 || performance.now() > until) {
        restoringScroll.current = false;
        return;
      }
      frame = requestAnimationFrame(retry);
    });
    return () => {
      cancelAnimationFrame(frame);
      restoringScroll.current = false;
    };
  }, [scrollKey, engine]);

  /* ───────────── gestures ───────────── */
  React.useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    let frame = 0;
    let pendingH: number | null = null;
    const flush = () => {
      frame = 0;
      if (pendingH !== null) engine.paint(pendingH);
      pendingH = null;
    };
    const paintSoon = (h: number) => {
      pendingH = h;
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const suppressNextClick = () => {
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        done();
      };
      const done = () => {
        window.removeEventListener('click', swallow, true);
        clearTimeout(timer);
      };
      window.addEventListener('click', swallow, true);
      const timer = setTimeout(done, 400);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (gestureRef.current) return; // a second finger: ignore
      const target = e.target as HTMLElement;
      const scroller = target.closest<HTMLElement>('[data-sheet-scroll]');
      const wasMoving = animRef.current !== null;
      if (wasMoving) engine.stop(); // grab the sheet where it is
      gestureRef.current = {
        id: e.pointerId,
        touch: e.pointerType === 'touch' || e.pointerType === 'pen',
        startX: e.clientX,
        startY: e.clientY,
        startH: hRef.current,
        startScroll: scroller?.scrollTop ?? 0,
        scroller: scroller && section.contains(scroller) ? scroller : null,
        inContent: !!scroller,
        inDragZone: !!target.closest('[data-sheet-strip], [data-sheet-drag]'),
        interactive: !!target.closest(INTERACTIVE) && !target.closest('[data-sheet-handle]'),
        claimed: false,
        abandoned: false,
        scrolled: false,
        wasMoving,
        samples: [{ t: e.timeStamp, y: e.clientY }],
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.id || g.abandoned) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.claimed) {
        if (Math.abs(dx) < SHEET_GESTURE.tapSlop && Math.abs(dy) < SHEET_GESTURE.tapSlop) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          g.abandoned = true; // horizontal: a chip row, a swipe on a toast… not the sheet's business
          if (g.wasMoving) engine.animateTo(live.current.heights[live.current.effective]);
          return;
        }
        const { effective: current } = live.current;
        // Who owns a vertical drag: the sheet, unless it is full and the list can still scroll that way.
        const own = !g.inContent || current !== 'full' || (dy > 0 && g.startScroll <= 0);
        if (!own) {
          g.abandoned = true;
          return;
        }
        g.claimed = true;
        engine.enterDragLayout();
        section.dataset.dragging = 'true';
        try {
          section.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic or already released pointer */
        }
      }
      if (e.cancelable) e.preventDefault();
      g.samples.push({ t: e.timeStamp, y: e.clientY });
      if (g.samples.length > 24) g.samples.splice(0, g.samples.length - 24);
      const { heights: hs, snaps: available } = live.current;
      const lowest = Math.min(...available.map((s) => hs[s]));
      let h = g.startH - dy;
      if (h > hs.full) {
        const s = g.scroller;
        if (g.inContent && s && s.scrollHeight > s.clientHeight) {
          // Hand-off: the sheet is at the top, the rest of the gesture scrolls the list.
          s.scrollTop = g.startScroll + (h - hs.full);
          g.scrolled = true;
          h = hs.full;
        } else h = hs.full + rubber(h - hs.full);
      } else {
        if (g.scrolled && g.scroller) g.scroller.scrollTop = g.startScroll;
        if (h < lowest) h = lowest - rubber(lowest - h);
      }
      paintSoon(h);
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.id) return;
      gestureRef.current = null;
      delete section.dataset.dragging;
      const { effective: current, snaps: available, heights: hs, onSnapChange: change } = live.current;
      if (g.claimed) {
        if (frame) {
          cancelAnimationFrame(frame);
          flush();
        }
        suppressNextClick();
        const velocity = cancelled ? 0 : releaseVelocity(g.samples, e.timeStamp);
        let target: SheetSnap;
        if (g.scrolled && hRef.current >= hs.full - 1) {
          target = 'full';
          // Keep the list moving a little after a flick, like a native scroll would.
          if (velocity > 0.3 && g.scroller) g.scroller.scrollBy({ top: velocity * 240, behavior: 'smooth' });
        } else target = resolveSnap(hRef.current, velocity, hs, available);
        hapticRef.current = g.touch;
        if (target !== current) change(target);
        else engine.animateTo(hs[current]);
        return;
      }
      if (
        !cancelled &&
        !g.abandoned &&
        !g.interactive &&
        (g.inDragZone || (current === 'peek' && !g.inContent))
      ) {
        // The compatibility click a touch tap produces is hit-tested a frame later, when the sheet has started to
        // move: it would land on whatever is under the finger by then — the map, whose empty tap lowers the sheet.
        suppressNextClick();
        hapticRef.current = g.touch;
        change(nextTapSnap(current, available));
        return;
      }
      if (g.wasMoving) engine.animateTo(hs[current]);
    };
    const onPointerUp = (e: PointerEvent) => finish(e, false);
    const onPointerCancel = (e: PointerEvent) => finish(e, true);
    // Touch scrolling is arbitrated here: once the sheet owns the gesture the list must not scroll natively.
    const onTouchMove = (e: TouchEvent) => {
      if (gestureRef.current?.claimed && e.cancelable) e.preventDefault();
    };

    section.addEventListener('pointerdown', onPointerDown);
    section.addEventListener('pointermove', onPointerMove);
    section.addEventListener('pointerup', onPointerUp);
    section.addEventListener('pointercancel', onPointerCancel);
    section.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      section.removeEventListener('pointerdown', onPointerDown);
      section.removeEventListener('pointermove', onPointerMove);
      section.removeEventListener('pointerup', onPointerUp);
      section.removeEventListener('pointercancel', onPointerCancel);
      section.removeEventListener('touchmove', onTouchMove);
    };
  }, [engine, live]);

  /* ───────────── keyboard ───────────── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = snaps.indexOf(effective);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onSnapChange(snaps[Math.min(snaps.length - 1, i + 1)]!);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onSnapChange(snaps[Math.max(0, i - 1)]!);
    }
    if (e.key === 'Home' || e.key === 'PageUp') {
      e.preventDefault();
      onSnapChange('full');
    }
    // Escape collapses the sheet (it is not modal, so there is nothing to close — only to get out of the way).
    if (e.key === 'End' || e.key === 'PageDown' || (e.key === 'Escape' && effective !== 'peek')) {
      e.preventDefault();
      onSnapChange('peek');
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn('pointer-events-none inset-x-0 z-40', contained ? 'absolute' : 'fixed')}
      style={{
        top: contained ? topOffset : `calc(${topOffset} + var(--rc-safe-top))`,
        bottom: bottomOffset,
      }}
    >
      <section
        ref={sectionRef}
        {...rest}
        data-snap={effective}
        aria-label={handleLabel}
        className={cn(
          'group/sheet border-border-strong bg-surface-1 shadow-panel pointer-events-auto absolute inset-x-0 top-0 flex flex-col rounded-t-lg border border-b-0 will-change-transform data-[dragging=true]:select-none',
          className,
        )}
        style={
          {
            height: full + OVERSCROLL_ROOM,
            // Room at the end of the list for the floating "collapse" button (see globals.css).
            '--rc-sheet-tail': effective === 'full' ? '72px' : '0px',
          } as React.CSSProperties
        }
      >
        <div
          ref={stripRef}
          data-sheet-strip
          className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        >
          <button
            type="button"
            data-sheet-handle
            onClick={(e) => {
              if (e.detail === 0) onSnapChange(nextTapSnap(effective, snaps)); /* keyboard activation only */
            }}
            onKeyDown={onKeyDown}
            aria-label={handleLabel}
            aria-expanded={effective !== 'peek'}
            data-testid="sheet-handle"
            // 20px tall visually; the pseudo-element extends the hit area to 44px for thumbs.
            className="relative flex h-5 w-full items-center justify-center after:absolute after:inset-x-0 after:-top-3 after:-bottom-3 after:content-['']"
          >
            <span aria-hidden className="bg-border-strong h-1.5 w-11 rounded-full" />
          </button>
          {header}
        </div>
        <div ref={viewportRef} data-sheet-viewport className="relative flex min-h-0 flex-col overflow-hidden">
          {children}
        </div>
        {effective === 'full' && collapseLabel ? (
          <button
            type="button"
            onClick={() => onSnapChange(twoSnap ? 'peek' : 'half')}
            data-testid="sheet-collapse"
            className="border-border-strong bg-surface-3 text-fg shadow-panel absolute right-3 z-10 inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold"
            style={{ bottom: OVERSCROLL_ROOM + footerHeight + 12 }}
          >
            <ChevronDown className="size-4" aria-hidden />
            {collapseLabel}
          </button>
        ) : null}
      </section>
    </div>
  );
}
