'use client';
import * as React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

/** Row actions ("…" menus): Radix dropdown with the game's surfaces; items are 44 px tall under a finger. */
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={6}
        align="end"
        collisionPadding={8}
        className={cn(
          'border-border-strong bg-surface-2 shadow-panel animate-fade-in z-[80] min-w-56 rounded-md border p-1 outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Menu.Item> & { tone?: 'default' | 'danger' }
>(({ className, tone = 'default', ...props }, ref) => (
  <Menu.Item
    ref={ref}
    className={cn(
      'flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm outline-none select-none pointer-coarse:min-h-11',
      'data-[highlighted]:bg-surface-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
      tone === 'danger' ? 'text-danger' : 'text-fg',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn('text-subtle px-2.5 py-1.5 text-xs font-semibold tracking-wide uppercase', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('bg-border my-1 h-px', className)} {...props} />;
}
