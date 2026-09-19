'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SheetSnap = 'peek' | 'half' | 'full';
const ORDER: SheetSnap[] = ['peek', 'half', 'full'];

export interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Visible height (px) in the peek state. */
  peekHeight?: number;
  /** Space reserved below the sheet (bottom navigation), CSS length. */
  bottomOffset?: string;
  /** Space kept free above the sheet in the full state, CSS length. */
  topOffset?: string;
  handleLabel: string;
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Height in px of each snap for a given container height. Exported for tests. */
export function snapHeights(containerHeight: number, peekHeight: number): Record<SheetSnap, number> {
  return {
    peek: peekHeight,
    half: Math.max(peekHeight, Math.round(containerHeight * 0.48)),
    full: Math.max(peekHeight, containerHeight),
  };
}

/** Nearest snap to a released height, biased by fling velocity (px/ms, positive = upwards). */
export function resolveSnap(height: number, velocity: number, heights: Record<SheetSnap, number>): SheetSnap {
  const projected = height + velocity * 180;
  let best: SheetSnap = 'peek';
  for (const s of ORDER) if (Math.abs(heights[s] - projected) < Math.abs(heights[best] - projected)) best = s;
  return best;
}

/**
 * Non-modal bottom sheet with three snap heights. Drag the handle/header with touch or mouse;
 * the handle is also a button (Enter/Space cycles, ArrowUp/ArrowDown move one snap) for keyboard users.
 * The content scrolls only in the `full` and `half` states so map gestures are never stolen in `peek`.
 */
export function BottomSheet({
  snap,
  onSnapChange,
  peekHeight = 112,
  bottomOffset = '0px',
  topOffset = '0px',
  handleLabel,
  header,
  children,
  className,
  ...rest
}: BottomSheetProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = React.useState(600);
  const [dragHeight, setDragHeight] = React.useState<number | null>(null);
  const drag = React.useRef<{
    startY: number;
    startHeight: number;
    lastY: number;
    lastT: number;
    velocity: number;
    moved: boolean;
    fromHandle: boolean;
  } | null>(null);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerHeight(el.clientHeight);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const heights = snapHeights(containerHeight, peekHeight);
  const height = dragHeight ?? heights[snap];

  const cycle = () => onSnapChange(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]!);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Buttons in the header (close, centre…) keep their own clicks: only empty header space and the handle start a drag.
    const target = e.target as HTMLElement;
    const fromHandle = !!target.closest('[data-sheet-handle]');
    if (!fromHandle && target.closest('button, a, input, [role="tab"]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = {
      startY: e.clientY,
      startHeight: heights[snap],
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      moved: false,
      fromHandle,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.velocity = (d.lastY - e.clientY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    if (d.moved) setDragHeight(Math.min(heights.full, Math.max(peekHeight * 0.6, d.startHeight + dy)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved && dragHeight !== null) onSnapChange(resolveSnap(dragHeight, d.velocity, heights));
    // Pointer capture retargets the click away from the handle, so a tap is resolved here.
    else if (!d.moved && d.fromHandle) cycle();
    setDragHeight(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = ORDER.indexOf(snap);
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onSnapChange(ORDER[Math.min(2, i + 1)]!);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onSnapChange(ORDER[Math.max(0, i - 1)]!);
    }
  };

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-x-0 z-40"
      style={{ top: `calc(${topOffset} + var(--rc-safe-top))`, bottom: bottomOffset }}
    >
      <section
        {...rest}
        data-snap={snap}
        aria-label={handleLabel}
        className={cn(
          'border-border-strong bg-surface-1 shadow-panel pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col rounded-t-lg border border-b-0',
          dragHeight === null && 'transition-[height] duration-200 ease-out',
          className,
        )}
        style={{ height, touchAction: 'none' }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        >
          <button
            type="button"
            data-sheet-handle
            onClick={(e) => {
              if (e.detail === 0) cycle(); /* keyboard activation only */
            }}
            onKeyDown={onKeyDown}
            aria-label={handleLabel}
            aria-expanded={snap !== 'peek'}
            data-testid="sheet-handle"
            className="flex h-6 w-full items-center justify-center"
          >
            <span aria-hidden className="bg-border-strong h-1.5 w-11 rounded-full" />
          </button>
          {header}
        </div>
        <div
          className={cn(
            'min-h-0 flex-1',
            snap === 'peek' && dragHeight === null ? 'overflow-hidden' : 'scroll-y',
          )}
          style={{ touchAction: 'pan-y' }}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
