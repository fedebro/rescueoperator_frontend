'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Controlled value (the counter and the auto-grow read it). */
  value: string;
  invalid?: boolean;
  /** Show "n / max" under the field; needs `maxLength`. */
  counter?: boolean;
  /** Grow with the content, from `rows` up to `maxRows` lines, then scroll. */
  autoGrow?: boolean;
  maxRows?: number;
  /** The counter's id (`aria-describedby` of the field); generated when omitted. */
  counterId?: string;
  wrapperClassName?: string;
}

/**
 * Multi-line text field (study 09 §3): one shared control for the board, the chat and every free-text form. 16 px on
 * touch screens (iOS zooms into smaller fields — the global rule, plus `pointer-coarse:text-base` here), optional
 * character counter that announces the limit, optional auto-grow for composers.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      wrapperClassName,
      invalid,
      counter,
      autoGrow,
      maxRows = 6,
      rows = 3,
      maxLength,
      counterId: counterIdProp,
      value,
      onChange,
      'aria-describedby': describedBy,
      ...props
    },
    forwardedRef,
  ) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const setRefs = (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };
    const generatedId = React.useId();
    const counterId = counterIdProp ?? `${generatedId}-counter`;
    const showCounter = counter && maxLength !== undefined;
    const length = value.length;
    const nearLimit = maxLength !== undefined && length >= Math.floor(maxLength * 0.9);
    const overLimit = maxLength !== undefined && length > maxLength;

    // Auto-grow: let the browser lay the text out, then take its scroll height (capped at `maxRows` lines).
    React.useLayoutEffect(() => {
      const el = innerRef.current;
      if (!autoGrow || !el) return;
      el.style.height = 'auto';
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const padding = el.offsetHeight - el.clientHeight; // borders only: the box is content-box
      const max = lineHeight * maxRows + padding;
      el.style.height = `${Math.min(max, Math.max(lineHeight * rows, el.scrollHeight))}px`;
      el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
    }, [autoGrow, maxRows, rows, value]);

    return (
      <div className={cn('flex flex-col gap-1', wrapperClassName)}>
        <textarea
          ref={setRefs}
          value={value}
          onChange={onChange}
          rows={rows}
          maxLength={maxLength}
          aria-invalid={invalid || overLimit || undefined}
          aria-describedby={
            [describedBy, showCounter ? counterId : null].filter(Boolean).join(' ') || undefined
          }
          className={cn(
            'bg-surface-2 text-fg placeholder:text-subtle focus:border-focus focus:ring-focus/50 w-full resize-none rounded-md border px-3 py-2 text-sm leading-5 transition-colors outline-none focus:ring-2 pointer-coarse:text-base',
            invalid || overLimit ? 'border-danger' : 'border-border-strong',
            className,
          )}
          {...props}
        />
        {showCounter ? (
          <p
            id={counterId}
            className={cn(
              'tabular text-subtle self-end text-xs',
              nearLimit && !overLimit && 'text-warning',
              overLimit && 'text-danger',
            )}
            aria-live={nearLimit ? 'polite' : 'off'}
            data-testid="textarea-counter"
          >
            {length} / {maxLength}
          </p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
