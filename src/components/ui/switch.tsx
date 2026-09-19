'use client';
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Switch = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'border-border-strong bg-surface-3 data-[state=checked]:border-success data-[state=checked]:bg-success/30 relative h-6 w-11 shrink-0 rounded-full border transition-colors',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="bg-muted data-[state=checked]:bg-success block size-4.5 translate-x-0.5 rounded-full transition-transform data-[state=checked]:translate-x-[22px]" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export const Checkbox = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'border-border-strong bg-surface-2 data-[state=checked]:border-brand data-[state=checked]:bg-brand aria-[invalid=true]:border-danger grid size-5 shrink-0 place-items-center rounded-sm border',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      <Check className="size-3.5 text-white" aria-hidden />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';
