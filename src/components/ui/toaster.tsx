'use client';
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore, type ToastItem } from '@/stores/toast';
import { cn } from '@/lib/utils';

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };
const TONE = {
  info: 'border-info/50 text-info',
  success: 'border-success/50 text-success',
  warning: 'border-warning/50 text-warning',
  danger: 'border-danger/50 text-danger',
};

function ToastCard({ toast, closeLabel }: { toast: ToastItem; closeLabel: string }) {
  const dismiss = useToastStore((s) => s.dismiss);
  React.useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, dismiss]);
  const Icon = ICON[toast.tone];
  return (
    <div
      data-testid="toast"
      data-tone={toast.tone}
      className={cn(
        'animate-slide-up bg-surface-2 shadow-panel pointer-events-auto flex w-full items-start gap-3 rounded-md border p-3',
        TONE[toast.tone],
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-fg text-sm font-semibold">{toast.title}</p>
        {toast.description ? <p className="text-muted mt-0.5 text-xs">{toast.description}</p> : null}
        {toast.action ? (
          <button
            type="button"
            className="text-skyline mt-1.5 -mb-1 inline-flex min-h-9 items-center text-xs font-bold hover:underline"
            onClick={() => {
              toast.action!.onClick();
              dismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={closeLabel}
        onClick={() => dismiss(toast.id)}
        className="text-muted hover:text-fg -m-2 grid size-11 shrink-0 place-items-center rounded-sm md:-m-1 md:size-7"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

const POSITION =
  'pointer-events-none fixed inset-x-3 top-[calc(var(--rc-safe-top)+60px)] z-[95] mx-auto flex max-w-sm flex-col gap-2 md:inset-x-auto md:top-auto md:right-4 md:bottom-4 md:mx-0 md:w-96';

/**
 * Top-centre on phones (the bottom belongs to the sheet and the nav), bottom-right on desktop.
 * Two PERSISTENT live regions (they exist before any toast, which is what screen readers need to announce
 * insertions): danger toasts are assertive (`role="alert"`), everything else is polite (`role="status"`).
 * The cards themselves carry no live role, so nothing is announced twice.
 */
export function Toaster({ closeLabel }: { closeLabel: string }) {
  const toasts = useToastStore((s) => s.toasts);
  const urgent = toasts.filter((t) => t.tone === 'danger');
  const polite = toasts.filter((t) => t.tone !== 'danger');
  return (
    <div className={POSITION} data-testid="toaster">
      <div role="alert" aria-atomic="false" className="flex flex-col gap-2">
        {urgent.map((t) => (
          <ToastCard key={t.id} toast={t} closeLabel={closeLabel} />
        ))}
      </div>
      <div role="status" aria-atomic="false" className="flex flex-col gap-2">
        {polite.map((t) => (
          <ToastCard key={t.id} toast={t} closeLabel={closeLabel} />
        ))}
      </div>
    </div>
  );
}
