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
      // 24 px tall to the eye, 44 px under a finger (03 §2.10): the hit area grows with a pseudo-element.
      "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']",
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
      'border-border-strong bg-surface-2 data-[state=checked]:border-brand data-[state=checked]:bg-brand aria-[invalid=true]:border-danger relative grid size-5 shrink-0 place-items-center rounded-sm border',
      // 20 px to the eye, 44 px under a finger.
      "pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']",
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
