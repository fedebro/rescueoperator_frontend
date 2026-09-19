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
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      data-testid="toast"
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
            className="text-skyline mt-1.5 text-xs font-bold hover:underline"
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
        className="text-subtle hover:text-fg -m-1 grid size-7 shrink-0 place-items-center rounded-sm"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Top-centre on phones (the bottom belongs to the sheet and the nav), bottom-right on desktop. */
export function Toaster({ closeLabel }: { closeLabel: string }) {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 top-[calc(var(--rc-safe-top)+60px)] z-[95] mx-auto flex max-w-sm flex-col gap-2 md:inset-x-auto md:top-auto md:right-4 md:bottom-4 md:mx-0 md:w-96"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} closeLabel={closeLabel} />
      ))}
    </div>
  );
}
