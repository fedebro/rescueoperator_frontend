'use client';
import * as React from 'react';
import { useLocale } from 'next-intl';
import { useServerNow } from '@/hooks/use-server-now';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export type RelativeTime = { value: number; unit: Intl.RelativeTimeFormatUnit };

/**
 * Pure: how to say "when" relative to now. Under 45 s → "now"; then minutes, hours, days up to a week; older (or
 * farther in the future) → `null`: show the date instead. Works both ways (`diffMs` > 0 = past).
 */
export function relativeTime(diffMs: number): RelativeTime | null {
  const abs = Math.abs(diffMs);
  const sign = diffMs > 0 ? -1 : 1;
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (abs < 45 * SEC) return { value: 0, unit: 'second' };
  if (abs < HOUR) return { value: sign * Math.round(abs / MIN), unit: 'minute' };
  if (abs < DAY) return { value: sign * Math.round(abs / HOUR), unit: 'hour' };
  if (abs < 7 * DAY) return { value: sign * Math.round(abs / DAY), unit: 'day' };
  return null;
}

export function formatRelative(at: string, now: number, locale: string, timeZone?: string): string {
  const target = Date.parse(at);
  const rel = Number.isNaN(target) ? null : relativeTime(now - target);
  if (!rel) return formatDateTime(at, locale, timeZone);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(rel.value, rel.unit);
}

export interface TimeAgoProps {
  /** ISO instant. */
  at: string;
  className?: string;
  timeZone?: string;
  /** Refresh period (ms). */
  intervalMs?: number;
}

/**
 * "adesso · 5 minuti fa · ieri · 12 set 2026, 10:31" against the SERVER clock, in the player's language, refreshed
 * every half minute. The full date is the tooltip and the machine-readable `dateTime`.
 */
export function TimeAgo({ at, className, timeZone, intervalMs = 30_000 }: TimeAgoProps) {
  const locale = useLocale();
  const now = useServerNow(intervalMs);
  const text = formatRelative(at, now, locale, timeZone);
  return (
    <time
      dateTime={at}
      title={formatDateTime(at, locale, timeZone)}
      className={cn('whitespace-nowrap', className)}
      suppressHydrationWarning
    >
      {text}
    </time>
  );
}
