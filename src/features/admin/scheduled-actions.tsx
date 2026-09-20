'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Loader, RotateCw, XCircle } from 'lucide-react';
import { adminApi, type AdminScheduledActionRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useServerNow } from '@/hooks/use-server-now';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/switch';
import { useReasonedAction } from './confirm-with-reason';
import {
  AdminTable,
  DateCell,
  DefinitionGrid,
  Heading,
  IdCode,
  JsonBlock,
  QueryState,
  StateBadge,
  UpdatedAt,
  useCan,
} from './shared';

const ALL = 'ALL';
const STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED'] as const;
const STATUS_VISUAL = {
  PENDING: { tone: 'neutral', icon: Clock },
  QUEUED: { tone: 'info', icon: Loader },
  RUNNING: { tone: 'info', icon: Loader },
  COMPLETED: { tone: 'success', icon: CheckCircle2 },
  CANCELLED: { tone: 'neutral', icon: XCircle },
  FAILED: { tone: 'danger', icon: XCircle },
} as const;

/** Overdue = should have run already and did not finish: the reconciler (or an operator) has to pick it up. */
export function isOverdue(row: Pick<AdminScheduledActionRow, 'status' | 'dueAt'>, now: number): boolean {
  return ['PENDING', 'QUEUED'].includes(row.status) && Date.parse(row.dueAt) < now - 5_000;
}
export const isRetryable = (row: Pick<AdminScheduledActionRow, 'status' | 'dueAt'>, now: number): boolean =>
  row.status === 'FAILED' || isOverdue(row, now);

function ActionStatus({ row, now }: { row: AdminScheduledActionRow; now: number }) {
  const t = useTranslations('admin.scheduledActions');
  if (isOverdue(row, now)) return <StateBadge tone="warning" icon={AlertTriangle} label={t('overdue')} />;
  const visual = STATUS_VISUAL[row.status as keyof typeof STATUS_VISUAL];
  return (
    <StateBadge
      tone={visual?.tone ?? 'neutral'}
      icon={visual?.icon}
      label={visual ? t(`statuses.${row.status as keyof typeof STATUS_VISUAL}`) : row.status}
    />
  );
}

/** Table + row detail + retry; reused by the incident inspector for the actions of one incident. */
export function ScheduledActionsTable({
  rows,
  maxHeight,
}: {
  rows: AdminScheduledActionRow[];
  maxHeight?: number | string;
}) {
  const t = useTranslations('admin.scheduledActions');
  const can = useCan();
  const now = useServerNow(5_000);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const retry = useReasonedAction<AdminScheduledActionRow>({
    run: (row, reason) => adminApi.retryScheduledAction(row.id, reason),
    success: t('retried'),
    invalidate: [qk.admin('scheduledActions'), qk.admin('incident'), qk.admin('dashboard')],
  });
  const columns: Column<AdminScheduledActionRow>[] = [
    {
      id: 'type',
      header: t('type'),
      width: 'minmax(190px,1.5fr)',
      cell: (a) => <code className="text-xs font-semibold">{a.type}</code>,
      sortValue: (a) => a.type,
    },
    { id: 'status', header: t('status'), width: '150px', cell: (a) => <ActionStatus row={a} now={now} /> },
    {
      id: 'due',
      header: t('dueAt'),
      width: '170px',
      cell: (a) => <DateCell iso={a.dueAt} />,
      sortValue: (a) => a.dueAt,
    },
    {
      id: 'attempts',
      header: t('attempts'),
      width: '100px',
      align: 'right',
      cell: (a) => a.attempts,
      sortValue: (a) => a.attempts,
    },
    {
      id: 'aggregate',
      header: t('aggregate'),
      width: 'minmax(260px,2fr)',
      cell: (a) => (
        <span className="text-muted text-xs">
          {a.aggregateType ?? '—'}
          {a.aggregateId ? ` · ${a.aggregateId}` : ''}
        </span>
      ),
    },
    {
      id: 'error',
      header: t('lastError'),
      width: 'minmax(200px,2fr)',
      cell: (a) => <span className="text-danger">{a.lastError ?? ''}</span>,
    },
  ];
  return (
    <>
      <AdminTable
        caption={t('title')}
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        titleColumn="type"
        cardTitle={(a) => <code className="text-sm">{a.type}</code>}
        onRowClick={(a) => setDetailId(a.id)}
        maxHeight={maxHeight}
        actionsWidth="120px"
        actions={
          can('scheduledActions.retry')
            ? (a) =>
                isRetryable(a, now) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7"
                    onClick={() =>
                      retry.ask(a, {
                        title: t('retryTitle'),
                        description: t('retryBody', { type: a.type }),
                        targetId: a.id,
                        confirmLabel: t('retry'),
                        tone: 'primary',
                      })
                    }
                  >
                    <RotateCw className="size-3.5" aria-hidden />
                    {t('retry')}
                  </Button>
                ) : null
            : undefined
        }
        empty={<EmptyState title={t('empty')} />}
      />
      {detailId ? <ActionDetail id={detailId} onClose={() => setDetailId(null)} /> : null}
      {retry.dialog}
    </>
  );
}

function ActionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('admin.scheduledActions');
  const tc = useTranslations('common');
  const q = useQuery({
    queryKey: qk.admin('scheduledAction', id),
    queryFn: () => adminApi.scheduledAction(id),
  });
  const a = q.data;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent title={t('detailTitle')} closeLabel={tc('close')}>
        {a ? (
          <div className="flex flex-col gap-4">
            <DefinitionGrid
              items={[
                ['ID', <IdCode key="id" value={a.id} />],
                [
                  t('type'),
                  <code key="type" className="text-xs">
                    {a.type}
                  </code>,
                ],
                [t('status'), a.status],
                [t('dueAt'), <DateCell key="due" iso={a.dueAt} />],
                [t('attempts'), a.attempts],
                [
                  t('career'),
                  a.careerId ? (
                    <IdCode key="car" value={a.careerId} href={`/admin/careers/${a.careerId}`} />
                  ) : (
                    '—'
                  ),
                ],
              ]}
            />
            {a.lastError ? (
              <div>
                <SectionTitle>{t('lastError')}</SectionTitle>
                <p
                  role="note"
                  className="border-danger/40 bg-danger/10 text-danger rounded-md border p-3 font-mono text-xs break-words"
                >
                  {a.lastError}
                </p>
              </div>
            ) : null}
            <div>
              <SectionTitle>{t('payload')}</SectionTitle>
              <JsonBlock value={a.payload} label={t('payload')} />
            </div>
          </div>
        ) : (
          <Skeleton className="h-40" />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AdminScheduledActions() {
  const t = useTranslations('admin.scheduledActions');
  const tc = useTranslations('admin.common');
  const [status, setStatus] = React.useState(ALL);
  const [type, setType] = React.useState(ALL);
  const [overdue, setOverdue] = React.useState(false);
  const q = useQuery({
    queryKey: qk.admin('scheduledActions', status, overdue),
    queryFn: () =>
      adminApi.scheduledActions({
        status: status === ALL ? undefined : status,
        overdue: overdue || undefined,
      }),
    refetchInterval: 5_000,
  });
  // Action types are open-ended (every domain registers its own): the filter offers the types present right now,
  // so it is applied here instead of narrowing the request (the API supports `?type=` for larger data sets).
  const knownTypes = React.useMemo(() => [...new Set((q.data ?? []).map((a) => a.type))].sort(), [q.data]);
  const rows = React.useMemo(
    () => (q.data ?? []).filter((a) => type === ALL || a.type === type),
    [q.data, type],
  );
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        <UpdatedAt at={q.dataUpdatedAt} fetching={q.isFetching} onRefresh={() => void q.refetch()} />
      </Heading>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          options={[
            { value: ALL, label: t('allStatuses') },
            ...STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
          ]}
        />
        <Select
          label={t('type')}
          value={type}
          onValueChange={setType}
          options={[{ value: ALL, label: t('allTypes') }, ...knownTypes.map((k) => ({ value: k, label: k }))]}
        />
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <Checkbox checked={overdue} onCheckedChange={(c) => setOverdue(c === true)} />
          {t('onlyOverdue')}
        </label>
      </div>
      <QueryState loading={q.isLoading} error={q.error}>
        <ScheduledActionsTable rows={rows} />
        <p className="text-subtle text-xs">{tc('rows', { count: rows.length })}</p>
      </QueryState>
      <QueueStats />
    </>
  );
}

function QueueStats() {
  const t = useTranslations('admin.dashboard');
  const q = useQuery({ queryKey: qk.admin('queues'), queryFn: adminApi.queues, refetchInterval: 15_000 });
  if (!q.data) return null;
  return (
    <section>
      <SectionTitle className="mt-2">{t('queues')}</SectionTitle>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {q.data.map((queue) => (
          <li key={queue.name} className="panel p-3 text-sm">
            <p className="font-mono text-xs font-semibold">{queue.name}</p>
            <dl className="text-muted mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {(['waiting', 'active', 'delayed', 'failed', 'completed'] as const).map((k) => (
                <React.Fragment key={k}>
                  <dt>{t(`queue.${k}`)}</dt>
                  <dd className="tabular text-fg text-right">{queue[k]}</dd>
                </React.Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
