'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRestoreFocus } from './use-restore-focus';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** Rendered only while the dialog is open (Radix Portal/Presence): captures and restores the previous focus. */
function DialogBody({
  onCloseAutoFocus,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  const restoreFocus = useRestoreFocus();
  return (
    <DialogPrimitive.Content
      {...props}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        restoreFocus(event);
      }}
    />
  );
}

/** Centered modal on desktop, bottom-anchored full-width sheet on phones (thumb reach + safe area). */
export function DialogContent({
  title,
  description,
  closeLabel,
  children,
  className,
  overlayClassName,
  hideClose,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  closeLabel: string;
  /** E.g. a clear overlay for a panel whose effect must stay visible behind it (the map layers). */
  overlayClassName?: string;
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'animate-fade-in bg-overlay fixed inset-0 z-[70] backdrop-blur-[2px]',
          overlayClassName,
        )}
      />
      <DialogBody
        {...props}
        aria-describedby={description ? undefined : props['aria-describedby']}
        className={cn(
          'animate-slide-up border-border-strong bg-surface-1 shadow-panel fixed z-[71] flex max-h-[92dvh] flex-col border outline-none',
          'inset-x-0 bottom-0 rounded-t-lg pb-[var(--rc-safe-bottom)] md:inset-auto md:top-1/2 md:left-1/2 md:w-[min(560px,92vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:pb-0',
          className,
        )}
      >
        <header className="border-border flex shrink-0 items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="font-display text-lg leading-tight font-bold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-muted mt-1 text-sm">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="text-muted hover:bg-surface-3 hover:text-fg -mr-2 grid size-11 place-items-center rounded-md md:size-9"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          )}
        </header>
        <div className="scroll-y min-h-0 flex-1 px-5 py-4">{children}</div>
      </DialogBody>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>
      {children}
    </div>
  );
}
