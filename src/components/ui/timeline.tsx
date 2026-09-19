import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  id: string;
  time: string;
  title: React.ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
}

const DOT = {
  neutral: 'border-border-strong text-muted',
  info: 'border-info text-info',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
};

export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol aria-label={label} className="relative flex flex-col">
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 ? (
            <span aria-hidden className="bg-border absolute top-6 bottom-0 left-[11px] w-px" />
          ) : null}
          <span
            aria-hidden
            className={cn(
              'bg-surface-1 z-[1] grid size-6 shrink-0 place-items-center rounded-full border-2 text-[10px]',
              DOT[item.tone ?? 'neutral'],
            )}
          >
            {item.icon ?? <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-fg text-sm">{item.title}</p>
            <time className="tabular text-subtle text-[11px]">{item.time}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}
