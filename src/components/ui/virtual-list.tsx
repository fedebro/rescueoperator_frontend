'use client';
import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

export interface VirtualListHandle {
  /** Reverse mode: to the newest item; normal mode: to the last one. */
  scrollToEnd: (behavior?: ScrollBehavior) => void;
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end' | 'auto') => void;
  /** Reverse mode: is the viewer looking at the newest items? */
  isAtEnd: () => boolean;
}

export interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Estimated row height in px (rows are measured once rendered). */
  estimateSize?: number | ((item: T, index: number) => number);
  /**
   * Chat mode (study 09 §3): anchored to the END — opens on the newest item, follows new items while the viewer is at
   * the bottom, keeps the view still when earlier items are prepended, and reports `onNewBelow` otherwise.
   */
  reverse?: boolean;
  /** Called once per page when the viewer nears the "earlier" edge (top in reverse mode, bottom otherwise). */
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  /** Shown at the "earlier" edge while `loadingMore`. */
  loader?: React.ReactNode;
  /** Reverse mode: fired when items were appended while the viewer was not at the end (→ "Nuovi messaggi ↓"). */
  onNewBelow?: (count: number) => void;
  /** Reverse mode: the viewer reached / left the end. */
  onEndStateChange?: (atEnd: boolean) => void;
  overscan?: number;
  className?: string;
  role?: 'list' | 'log' | 'feed';
  'aria-label'?: string;
  testId?: string;
  ref?: React.Ref<VirtualListHandle>;
}

/** How close (px) to the earlier edge before the next page is asked for. */
const LOAD_MORE_PX = 320;
/** Within this many px of the end the viewer counts as "at the end" (a last line half hidden still follows). */
const END_THRESHOLD_PX = 40;

/**
 * Windowed list: only the rows on screen (plus `overscan`) exist in the DOM — chat and board stay light with thousands
 * of entries (study 09 §10 #5). The body is `absolute inset-0`: give it a sized `relative` parent.
 */
export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 72,
  reverse = false,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  loader,
  onNewBelow,
  onEndStateChange,
  overscan = 8,
  className,
  role = 'list',
  'aria-label': ariaLabel,
  testId = 'virtual-list',
  ref,
}: VirtualListProps<T>) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const estimate = React.useCallback(
    (index: number) =>
      typeof estimateSize === 'function' ? estimateSize(items[index]!, index) : estimateSize,
    [estimateSize, items],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is safe here: the component is not memoised by the compiler
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimate,
    getItemKey: (index) => getKey(items[index]!),
    overscan,
    initialRect: { width: 360, height: 640 },
    // Chat mode: the core anchors the viewport to the newest item, keeps the view still on a prepend (items are keyed)
    // and follows appends only while the viewer is at the end.
    anchorTo: reverse ? 'end' : 'start',
    followOnAppend: reverse ? 'auto' : false,
    scrollEndThreshold: END_THRESHOLD_PX,
  });

  // Read from the DOM, not from the virtualizer: its own scroll listener runs after this component's, so its offset is
  // one event behind when a scroll handler asks.
  const isAtEnd = React.useCallback(() => {
    const el = parentRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= END_THRESHOLD_PX;
  }, []);
  // A DOM scroll lands at once (the core's `scrollToIndex` does not before the rows are measured); the core follows
  // through its own scroll listener.
  const scrollToEnd = React.useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = parentRef.current;
      if (!el || items.length === 0) return;
      if (behavior === 'smooth') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else el.scrollTop = el.scrollHeight;
    },
    [items.length],
  );
  React.useImperativeHandle(
    ref,
    () => ({
      scrollToEnd,
      scrollToIndex: (index, align = 'auto') => virtualizer.scrollToIndex(index, { align }),
      isAtEnd,
    }),
    [scrollToEnd, isAtEnd, virtualizer],
  );

  // Reverse mode sticks to the newest item while the viewer is at the end: on open, after every measurement that
  // changes the total size, on every append. Until the first landing the list is not "near the earlier edge": the
  // core's own initial positioning fires scroll events at offset 0 first.
  const atEndRef = React.useRef(true);
  const settledAtEnd = React.useRef(!reverse);
  const totalSize = virtualizer.getTotalSize();
  React.useLayoutEffect(() => {
    if (!reverse || items.length === 0 || !atEndRef.current) return;
    scrollToEnd();
    // Measured heights land after the first paint: re-align once they have.
    const frame = requestAnimationFrame(() => {
      if (atEndRef.current) scrollToEnd();
      settledAtEnd.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [reverse, items.length, totalSize, scrollToEnd]);

  // The viewer at / away from the end, and "new items below" when something is appended while they are away.
  const onEndStateChangeRef = React.useRef(onEndStateChange);
  onEndStateChangeRef.current = onEndStateChange;
  const updateEndState = React.useCallback(() => {
    // Until the opening landing settled, the scroll events belong to the core's own positioning, not to the viewer.
    if (!settledAtEnd.current) return;
    const next = isAtEnd();
    if (next !== atEndRef.current) {
      atEndRef.current = next;
      onEndStateChangeRef.current?.(next);
    }
  }, [isAtEnd]);
  const edges = React.useRef<{ first: string | null; last: string | null; length: number }>({
    first: null,
    last: null,
    length: 0,
  });
  const onNewBelowRef = React.useRef(onNewBelow);
  onNewBelowRef.current = onNewBelow;
  React.useEffect(() => {
    const first = items.length ? getKey(items[0]!) : null;
    const last = items.length ? getKey(items[items.length - 1]!) : null;
    const prev = edges.current;
    edges.current = { first, last, length: items.length };
    if (!reverse || prev.last === null || last === null || last === prev.last) return;
    // Appended at the end (the first key did not move): follow or tell.
    if (prev.first === first && !atEndRef.current) onNewBelowRef.current?.(items.length - prev.length);
  }, [items, getKey, reverse]);

  // "Load earlier": one request per page, also right after a page landed when the list is still too short to scroll.
  const requestedAt = React.useRef(-1);
  const onLoadMoreRef = React.useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const maybeLoadMore = React.useCallback(
    (reason: 'scroll' | 'settled') => {
      const el = parentRef.current;
      if (!el || !hasMore || loadingMore || !onLoadMoreRef.current) return;
      if (requestedAt.current === items.length || (reason === 'scroll' && !settledAtEnd.current)) return;
      const distance = reverse ? el.scrollTop : el.scrollHeight - el.scrollTop - el.clientHeight;
      // Without a scroll (a page just landed, the first items are in) only a list too short to ever be scrolled near its
      // earlier edge asks on its own — in reverse mode the viewport may still be on its way to the end.
      const near =
        reason === 'scroll' ? distance <= LOAD_MORE_PX : el.scrollHeight - el.clientHeight <= LOAD_MORE_PX;
      if (near) {
        requestedAt.current = items.length;
        onLoadMoreRef.current();
      }
    },
    [hasMore, loadingMore, items.length, reverse],
  );
  React.useEffect(() => {
    if (!loadingMore) maybeLoadMore('settled');
  }, [loadingMore, maybeLoadMore]);

  // The container shrank (the keyboard opened) while the viewer was at the end: stay there.
  React.useEffect(() => {
    const el = parentRef.current;
    if (!el || !reverse || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atEndRef.current) scrollToEnd();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [reverse, scrollToEnd]);

  const onScroll = () => {
    updateEndState();
    maybeLoadMore('scroll');
  };

  const rows = virtualizer.getVirtualItems();
  return (
    <div
      ref={parentRef}
      role={role}
      aria-label={ariaLabel}
      aria-busy={loadingMore || undefined}
      data-testid={testId}
      onScroll={onScroll}
      className={cn('scroll-y absolute inset-0 overscroll-contain', className)}
    >
      {reverse && loadingMore && loader ? <div className="sticky top-0 z-10">{loader}</div> : null}
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {rows.map((row) => (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            role={role === 'list' ? 'listitem' : undefined}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${row.start}px)`,
            }}
          >
            {renderItem(items[row.index]!, row.index)}
          </div>
        ))}
      </div>
      {!reverse && loadingMore && loader ? loader : null}
    </div>
  );
}
