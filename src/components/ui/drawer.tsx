'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Modal side drawer (navigation on mobile, secondary panels on desktop). */
export function Drawer({
  open,
  onOpenChange,
  side = 'right',
  title,
  closeLabel,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'left' | 'right';
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in bg-overlay fixed inset-0 z-[70]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'border-border-strong bg-surface-1 shadow-panel fixed inset-y-0 z-[71] flex w-[min(380px,88vw)] flex-col pt-[var(--rc-safe-top)] pb-[var(--rc-safe-bottom)] outline-none',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            className,
          )}
        >
          <header className="border-border flex h-13 shrink-0 items-center justify-between border-b px-4 py-2">
            <DialogPrimitive.Title className="font-display text-base font-bold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="text-muted hover:bg-surface-3 hover:text-fg grid size-9 place-items-center rounded-md"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          <div className="scroll-y min-h-0 flex-1">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
