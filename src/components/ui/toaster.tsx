'use client';
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore, type ToastItem } from '@/stores/toast';
import { useIsDesktop } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };
const TONE = {
  info: 'border-info/50 text-info',
  success: 'border-success/50 text-success',
  warning: 'border-warning/50 text-warning',
  danger: 'border-danger/50 text-danger',
};

/** Phone stack: how far each older card peeks out below the front one, and how many are drawn at all. */
const STACK_OFFSET = 5;
const STACK_VISIBLE = 3;
/** A swipe further than this (px) — or a flick — dismisses the card. */
const SWIPE_DISMISS = 72;
/** After being held (pointer, focus, thumb) a card stays at least this long once let go. */
const TOAST_AFTER_HOLD_MS = 1500;

function ToastCard({
  toast,
  closeLabel,
  depth,
  compact,
}: {
  toast: ToastItem;
  closeLabel: string;
  /** 0 = the front card (newest). Only meaningful in the compact phone stack. */
  depth: number;
  compact: boolean;
}) {
  const dismiss = useToastStore((s) => s.dismiss);
  const [swipe, setSwipe] = React.useState<{ x: number; y: number } | null>(null);
  const start = React.useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const swiping = swipe !== null;
  // Never gone from under the pointer or the keyboard (WCAG 2.2.1): the countdown stops while the card is hovered or
  // holds the focus — reaching for "Annulla" must not make it vanish — and resumes with the time it had left.
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const held = swiping || hovered || focused;
  const remaining = React.useRef(toast.durationMs);
  const wasHeld = React.useRef(false);
  React.useEffect(() => {
    if (held) {
      wasHeld.current = true;
      return; // held under the thumb, the pointer or the focus: it stays until let go
    }
    // Let go: a moment to read it again, never an instant disappearance.
    if (wasHeld.current) remaining.current = Math.max(remaining.current, TOAST_AFTER_HOLD_MS);
    const startedAt = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [toast.id, dismiss, held]);
  const Icon = ICON[toast.tone];

  // Swipe to dismiss (phones): sideways or up, like a system notification.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!compact || (e.target as HTMLElement).closest('button')) return;
    start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic or already released pointer */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || e.pointerId !== s.id) return;
    const x = e.clientX - s.x;
    const y = Math.min(0, e.clientY - s.y);
    if (!swiping && Math.abs(x) < 6 && y > -6) return;
    setSwipe({ x, y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !swipe) return;
    const dt = Math.max(1, e.timeStamp - s.t);
    const fast = Math.abs(swipe.x) / dt > 0.6 || -swipe.y / dt > 0.5;
    if (Math.abs(swipe.x) > SWIPE_DISMISS || swipe.y < -SWIPE_DISMISS / 2 || fast) dismiss(toast.id);
    else setSwipe(null);
  };

  const stackStyle: React.CSSProperties | undefined = compact
    ? {
        zIndex: 100 - depth,
        transform: swipe
          ? `translate3d(${swipe.x}px, ${swipe.y}px, 0)`
          : `translate3d(0, ${depth * STACK_OFFSET}px, 0) scale(${1 - depth * 0.04})`,
        opacity: swipe
          ? Math.max(0.2, 1 - Math.abs(swipe.x) / 240 + swipe.y / 120)
          : depth < STACK_VISIBLE
            ? 1
            : 0,
        transition: swipe ? 'none' : 'transform 180ms ease-out, opacity 180ms ease-out',
      }
    : undefined;

  return (
    <div
      data-testid="toast"
      data-tone={toast.tone}
      data-depth={compact ? depth : undefined}
      data-held={held || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setSwipe(null);
      }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      style={stackStyle}
      // Tucked behind the front card: out of the tab order too (it was announced when it arrived).
      inert={compact && depth > 0}
      className={cn(
        'bg-surface-2 shadow-panel flex w-full rounded-md border',
        TONE[toast.tone],
        compact
          ? cn(
              'absolute inset-x-0 top-0 min-h-12 touch-none items-center gap-2.5 py-1.5 pr-1 pl-3 select-none',
              depth === 0 ? 'animate-slide-up pointer-events-auto' : 'pointer-events-none',
            )
          : 'animate-slide-up pointer-events-auto items-start gap-3 p-3',
      )}
    >
      <Icon className={cn('size-4 shrink-0', !compact && 'mt-0.5')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn('text-fg text-sm font-semibold', compact && 'truncate')}>{toast.title}</p>
        {toast.description ? (
          <p className={cn('text-muted text-xs', compact ? 'truncate' : 'mt-0.5')}>{toast.description}</p>
        ) : null}
        {toast.action && !compact ? (
          <button
            type="button"
            className="text-skyline mt-1.5 -mb-1 inline-flex min-h-9 items-center text-xs font-bold hover:underline"
            onClick={() => {
              toast.action!.onClick();
              dismiss(toast.id);
            }}
            data-testid="toast-action"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      {toast.action && compact ? (
        <button
          type="button"
          className="text-skyline hover:bg-surface-3 inline-flex min-h-11 shrink-0 items-center rounded-md px-2.5 text-sm font-bold"
          onClick={() => {
            toast.action!.onClick();
            dismiss(toast.id);
          }}
          data-testid="toast-action"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={() => dismiss(toast.id)}
        className={cn(
          'text-muted hover:text-fg grid shrink-0 place-items-center rounded-sm',
          compact ? 'size-11' : '-m-2 size-11 md:-m-1 md:size-7',
        )}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Desktop: bottom of the map area, up to four stacked. Phones (03 §2.8): ONE compact card at a time, laid over the top bar (the
 * bell excepted) — so it never covers the map controls nor the bottom sheet's handle and close button — with older
 * ones tucked behind it; swipe sideways or up to dismiss.
 * Two PERSISTENT live regions (they exist before any toast, which is what screen readers need to announce
 * insertions): danger toasts are assertive (`role="alert"`), everything else is polite (`role="status"`).
 * The cards themselves carry no live role, so nothing is announced twice.
 */
export function Toaster({ closeLabel }: { closeLabel: string }) {
  const toasts = useToastStore((s) => s.toasts);
  const desktop = useIsDesktop();
  const compact = !desktop;
  const urgent = toasts.filter((t) => t.tone === 'danger');
  const polite = toasts.filter((t) => t.tone !== 'danger');
  // Newest first: that one is in front.
  const depthOf = (id: number) => toasts.filter((t) => t.id > id).length;
  const card = (t: ToastItem) => (
    <ToastCard
      key={t.id}
      toast={t}
      closeLabel={closeLabel}
      depth={compact ? depthOf(t.id) : 0}
      compact={compact}
    />
  );
  return (
    <div
      className={cn(
        'pointer-events-none fixed z-[95]',
        compact
          ? // Over the top bar, but short of its right end: the notification bell stays reachable.
            'top-[calc(var(--rc-safe-top)+2px)] right-14 left-2 max-w-md'
          : // Past the queue column, at the bottom of the map: the right column's pinned "send" button stays clear.
            'bottom-4 left-[calc(var(--rc-sidebar-w)+336px)] flex w-96 flex-col gap-2',
      )}
      data-testid="toaster"
      data-layout={compact ? 'stack' : 'list'}
    >
      <div role="alert" aria-atomic="false" className={compact ? undefined : 'flex flex-col gap-2'}>
        {urgent.map(card)}
      </div>
      <div role="status" aria-atomic="false" className={compact ? undefined : 'flex flex-col gap-2'}>
        {polite.map(card)}
      </div>
    </div>
  );
}
