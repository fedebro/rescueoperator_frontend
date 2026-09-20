'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Accessible label of the group; each box gets "<label> n/N". */
  label: string;
}

/** Six single-digit boxes with paste support, arrow/backspace navigation and SMS/e-mail autofill (one-time-code). */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  invalid,
  autoFocus,
  label,
}: OtpInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const commit = (next: string, focusIndex: number) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    refs.current[Math.min(length - 1, Math.max(0, focusIndex))]?.focus();
    if (clean.length === length) onComplete?.(clean);
  };

  const handleInput = (index: number, raw: string) => {
    const onlyDigits = raw.replace(/\D/g, '');
    if (onlyDigits.length === 0) return;
    // Autofill / typing several chars into one box behaves like a paste starting at that box.
    const next = (value.slice(0, index) + onlyDigits + value.slice(index + onlyDigits.length)).slice(
      0,
      length,
    );
    commit(next, index + onlyDigits.length);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[index]) commit(value.slice(0, index) + value.slice(index + 1), index);
      else if (index > 0) commit(value.slice(0, index - 1) + value.slice(index), index - 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      refs.current[Math.max(0, index - 1)]?.focus();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      refs.current[Math.min(length - 1, index + 1)]?.focus();
    }
  };

  return (
    <div
      role="group"
      aria-label={label}
      className="flex justify-center gap-2"
      onPaste={(e) => {
        e.preventDefault();
        commit(e.clipboardData.getData('text'), length - 1);
      }}
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`${label} ${i + 1}/${length}`}
          aria-invalid={invalid || undefined}
          data-testid={`otp-${i}`}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            'tabular bg-surface-2 text-fg caret-brand focus:border-focus focus:ring-focus/50 h-14 w-11 rounded-md border text-center text-2xl font-semibold transition-colors outline-none focus:ring-2 sm:w-12',
            invalid ? 'border-danger' : digit ? 'border-border-strong' : 'border-border',
          )}
        />
      ))}
    </div>
  );
}
