'use client';
import { useLocale } from 'next-intl';
import { formatAmount, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CreditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('size-3.5 shrink-0', className)}>
      <circle cx="8" cy="8" r="7" fill="var(--rc-credits)" />
      <circle cx="8" cy="8" r="5" fill="none" stroke="#7a5a10" strokeWidth="1" opacity="0.55" />
      <path
        d="M10.3 5.9A3 3 0 1 0 10.3 10.1"
        fill="none"
        stroke="#5c430a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Credits: integer string on the wire, BigInt in code, coin glyph + tabular digits on screen. */
export function CreditAmount({
  value,
  sign,
  tone = 'auto',
  label,
  className,
  size = 'md',
}: {
  value: string | bigint;
  sign?: boolean;
  tone?: 'auto' | 'plain' | 'credits';
  label: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const locale = useLocale();
  const n = parseAmount(value);
  const text = formatAmount(n, locale, { sign });
  const color =
    tone === 'plain'
      ? 'text-fg'
      : tone === 'credits'
        ? 'text-credits'
        : sign
          ? n < 0n
            ? 'text-danger'
            : n > 0n
              ? 'text-success'
              : 'text-muted'
          : 'text-credits';
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 font-semibold whitespace-nowrap',
        color,
        size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-xl' : 'text-sm',
        className,
      )}
      aria-label={`${text} ${label}`}
    >
      <CreditIcon className={size === 'lg' ? 'size-5' : undefined} />
      <span aria-hidden>{text}</span>
    </span>
  );
}
