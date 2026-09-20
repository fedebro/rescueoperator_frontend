'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  CheckCircle2,
  CircleDashed,
  Lock,
  RefreshCw,
  XCircle,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { canAdmin, type AdminAction } from '@/lib/api/admin';
import { useErrorMessage } from '@/lib/api/error-message';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, formatTime } from '@/lib/format';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

/** UX-only permission check (hide AND disable): the API enforces the same matrix with 403. */
export function useCan(): (action: AdminAction) => boolean {
  const roles = useAuthStore((s) => s.user?.roles);
  return React.useCallback((action) => canAdmin(roles, action), [roles]);
}

export function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-extrabold break-words">{title}</h1>
        {subtitle ? <p className="text-muted mt-1 text-sm">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{children}</div> : null}
    </div>
  );
}

export function QueryState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: unknown;
  children: React.ReactNode;
}) {
  const errorMessage = useErrorMessage();
  if (error)
    return (
      <p role="alert" className="panel text-danger p-4 text-sm">
        {errorMessage(error)}
      </p>
    );
  if (loading) return <Skeleton className="h-64" />;
  return <>{children}</>;
}

export function useDebounced(delayMs = 250): [string, string, (v: string) => void] {
  const [value, setValue] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return [value, debounced, setValue];
}

/** Selectable identifier, optionally linking to its inspector. */
export function IdCode({ value, href, className }: { value: string; href?: string; className?: string }) {
  const code = <code className={cn('tabular text-xs break-all select-all', className)}>{value}</code>;
  return href ? (
    <Link href={href} className="text-skyline hover:underline">
      {code}
    </Link>
  ) : (
    <span className="text-muted">{code}</span>
  );
}

export function DateCell({ iso }: { iso: string | null | undefined }) {
  const locale = useLocale();
  return <span className="tabular text-muted">{iso ? formatDateTime(iso, locale) : '—'}</span>;
}

type Tone = NonNullable<BadgeProps['tone']>;
const TONE_ICON: Record<Tone, LucideIcon> = {
  neutral: CircleDashed,
  brand: CircleDashed,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: CircleDashed,
  credits: CircleDashed,
  xp: CircleDashed,
};
/** Status badge: the icon carries the state together with the label, colour only reinforces it. */
export function StateBadge({ tone, label, icon }: { tone: Tone; label: string; icon?: LucideIcon }) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}

export function UpdatedAt({
  at,
  fetching,
  onRefresh,
}: {
  at: number;
  fetching: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations('admin.common');
  const locale = useLocale();
  return (
    <div className="text-subtle flex items-center gap-2 text-xs" data-testid="admin-updated-at">
      <span aria-live="off">
        {at ? t('updatedAt', { time: formatTime(new Date(at).toISOString(), locale) }) : t('loading')}
      </span>
      <Button size="sm" variant="ghost" onClick={onRefresh} loading={fetching}>
        <RefreshCw className="size-3.5" aria-hidden />
        {t('refresh')}
      </Button>
    </div>
  );
}

/** Shown in place of a control the current role cannot use (the control itself is not rendered). */
export function NoPermission({ className }: { className?: string }) {
  const t = useTranslations('admin.shell');
  return (
    <p className={cn('text-subtle inline-flex items-center gap-1.5 text-xs', className)}>
      <Lock className="size-3.5" aria-hidden />
      {t('noPermission')}
    </p>
  );
}

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      // 16px on phones: smaller inputs make iOS zoom the page on focus.
      'bg-surface-2 text-fg placeholder:text-subtle focus:border-focus min-h-20 w-full rounded-md border px-3 py-2 text-base outline-none lg:text-sm',
      invalid ? 'border-danger' : 'border-border-strong',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export interface AdminTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Card heading on phones. */
  cardTitle: (row: T) => React.ReactNode;
  /** Column already shown as the card heading: left out of the card body on phones. */
  titleColumn?: string;
  /** Row actions: last column on desktop, footer of the card on phones. */
  actions?: (row: T) => React.ReactNode;
  actionsWidth?: string;
  onRowClick?: (row: T) => void;
  rowHref?: (row: T) => string;
  empty: React.ReactNode;
  maxHeight?: number | string;
  density?: 'dense' | 'compact';
}

/**
 * One data set, two first-class layouts (D-12): a dense virtualized table on desktop, a list of cards with the
 * same fields and the same actions on phones.
 */
export function AdminTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  cardTitle,
  titleColumn,
  actions,
  actionsWidth = '200px',
  onRowClick,
  rowHref,
  empty,
  maxHeight = 'calc(100dvh - 260px)',
  density = 'compact',
}: AdminTableProps<T>) {
  const desktop = useIsDesktop();
  const t = useTranslations('admin.common');
  if (desktop) {
    const all: Column<T>[] = actions
      ? [
          ...columns,
          {
            id: '__actions',
            header: t('actions'),
            width: actionsWidth,
            align: 'right',
            cell: (row) => (
              <span
                className="flex justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                {actions(row)}
              </span>
            ),
          },
        ]
      : columns;
    return (
      <DataTable
        caption={caption}
        columns={all}
        rows={rows}
        rowKey={rowKey}
        density={density}
        onRowClick={onRowClick}
        maxHeight={maxHeight}
        empty={empty}
      />
    );
  }
  if (rows.length === 0) return <div className="panel p-2">{empty}</div>;
  return (
    <ul aria-label={caption} className="flex flex-col gap-2">
      {rows.map((row) => {
        const href = rowHref?.(row);
        return (
          <li key={rowKey(row)} className="panel flex flex-col gap-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 font-semibold break-words">{cardTitle(row)}</div>
              {href ? (
                <Link href={href} className="text-skyline shrink-0 text-sm font-semibold hover:underline">
                  {t('details')}
                </Link>
              ) : onRowClick ? (
                <Button size="sm" variant="secondary" onClick={() => onRowClick(row)}>
                  {t('details')}
                </Button>
              ) : null}
            </div>
            <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-[13px]">
              {columns
                .filter((c) => c.header !== '' && c.id !== titleColumn)
                .map((c) => (
                  <React.Fragment key={c.id}>
                    <dt className="text-subtle text-[11px] font-semibold tracking-wide uppercase">
                      {c.header}
                    </dt>
                    <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                  </React.Fragment>
                ))}
            </dl>
            {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions(row)}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className="bg-surface-2 border-border scroll-y max-h-72 overflow-x-auto rounded-md border p-3 font-mono text-xs"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function DefinitionGrid({ items }: { items: [label: string, value: React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col">
          <dt className="text-subtle text-[11px] font-semibold tracking-wide uppercase">{label}</dt>
          <dd className="text-fg min-w-0 text-sm break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
