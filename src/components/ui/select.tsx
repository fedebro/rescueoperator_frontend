'use client';
import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  className,
  id,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label: string;
  className?: string;
  id?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={label}
        className={cn(
          'border-border-strong bg-surface-2 text-fg data-[placeholder]:text-subtle flex h-10 min-w-36 items-center justify-between gap-2 rounded-md border px-3 text-sm pointer-coarse:min-h-11',
          className,
        )}
      >
        {/* One line, left-aligned: a long value ("Caserma Pescara Centro · alloggi esauriti") ends in an ellipsis
            instead of wrapping centred out of the 40 px box on a phone. */}
        {/* (Radix drops a className on Value: the wrapper carries it.) */}
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="text-subtle size-4" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="border-border-strong bg-surface-2 shadow-panel z-[80] max-h-72 max-w-[var(--radix-select-content-available-width)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="text-fg data-[highlighted]:bg-surface-4 relative flex min-h-9 cursor-pointer items-center rounded-sm py-1.5 pr-8 pl-3 text-sm outline-none select-none data-[disabled]:opacity-40 pointer-coarse:min-h-11"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="size-4" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
