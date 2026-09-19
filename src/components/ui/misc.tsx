import * as React from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('bg-surface-3 animate-pulse rounded-md', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      {icon ? (
        <div
          aria-hidden
          className="bg-surface-3 text-subtle mb-1 grid size-12 place-items-center rounded-full"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-fg font-semibold">{title}</p>
      {description ? <p className="text-muted max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  tone = 'brand',
  className,
  showValue,
}: {
  value: number;
  label: string;
  tone?: 'brand' | 'success' | 'info' | 'xp' | 'warning';
  className?: string;
  showValue?: boolean;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const color = {
    brand: 'bg-brand',
    success: 'bg-success',
    info: 'bg-info',
    xp: 'bg-xp',
    warning: 'bg-warning',
  }[tone];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="bg-surface-3 h-2 min-w-0 flex-1 overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue ? <span className="tabular text-muted w-9 text-right text-xs">{pct}%</span> : null}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('panel p-4', className)} {...props} />;
}

export function SectionTitle({
  children,
  className,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-2', className)}>
      <h3 className="text-subtle text-[11px] font-bold tracking-[0.08em] uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <span className="text-subtle truncate text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      <span className="tabular text-fg truncate text-base font-semibold">{value}</span>
    </div>
  );
}
