'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Minimal non-modal popover for the desktop layout (the design system has Dialog/Tooltip but no popover, and new
 * dependencies are not allowed). Disclosure pattern: the trigger owns `aria-expanded`/`aria-controls`, Escape and an
 * outside press close it and focus returns to the trigger. On phones the same content is shown in a `Dialog` sheet.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  label,
  align = 'end',
  className,
  id,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the props that make it the disclosure button. */
  trigger: (props: {
    'aria-expanded': boolean;
    'aria-controls': string;
    onClick: () => void;
    ref: React.Ref<HTMLButtonElement>;
  }) => React.ReactNode;
  children: React.ReactNode;
  label: string;
  align?: 'start' | 'end';
  className?: string;
  id: string;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        'aria-expanded': open,
        'aria-controls': id,
        onClick: () => onOpenChange(!open),
        ref: triggerRef,
      })}
      {open ? (
        <div
          id={id}
          role="region"
          aria-label={label}
          className={cn(
            'animate-fade-in border-border-strong bg-surface-1 shadow-panel absolute top-full z-[60] mt-2 rounded-lg border p-4',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
