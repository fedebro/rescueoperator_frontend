'use client';
import * as React from 'react';
import { useServerNow } from '@/hooks/use-server-now';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface CountdownProps {
  /** Target instant (ISO). The remaining time is computed against the SERVER clock. */
  to: string | null | undefined;
  /** Shown when the target has passed (e.g. "arriving…") */
  doneLabel?: string;
  prefix?: React.ReactNode;
  className?: string;
  /** count up from `to` instead of down (elapsed timers) */
  elapsed?: boolean;
  urgentBelowSeconds?: number;
}

export function Countdown({
  to,
  doneLabel = '0:00',
  prefix,
  className,
  elapsed,
  urgentBelowSeconds,
}: CountdownProps) {
  const now = useServerNow(1000, !!to);
  if (!to) return null;
  const target = Date.parse(to);
  const seconds = elapsed ? (now - target) / 1000 : (target - now) / 1000;
  const done = !elapsed && seconds <= 0;
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1',
        urgentBelowSeconds !== undefined && !done && seconds < urgentBelowSeconds && 'text-danger',
        className,
      )}
      data-testid="countdown"
    >
      {prefix}
      <time dateTime={to} suppressHydrationWarning>
        {done ? doneLabel : formatClock(seconds)}
      </time>
    </span>
  );
}

/** ETA pill: countdown to an arrival instant. */
export function Eta({
  arriveAt,
  label,
  doneLabel,
  className,
}: {
  arriveAt: string | null | undefined;
  label: string;
  doneLabel: string;
  className?: string;
}) {
  return (
    <Countdown
      to={arriveAt}
      doneLabel={doneLabel}
      className={className}
      prefix={<span className="text-subtle text-[10px] font-bold tracking-wider uppercase">{label}</span>}
    />
  );
}
