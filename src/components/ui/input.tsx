import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leading?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leading, ...props }, ref) => (
    <div
      className={cn(
        'bg-surface-2 focus-within:border-focus flex h-11 items-center gap-2 rounded-md border px-3 transition-colors',
        invalid ? 'border-danger' : 'border-border-strong',
        className,
      )}
    >
      {leading ? (
        <span className="text-subtle shrink-0" aria-hidden>
          {leading}
        </span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className="placeholder:text-subtle text-fg h-full w-full min-w-0 bg-transparent outline-none"
        {...props}
      />
    </div>
  ),
);
Input.displayName = 'Input';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-muted text-xs font-semibold tracking-wide uppercase">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : hint ? (
        <p className="text-subtle text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
