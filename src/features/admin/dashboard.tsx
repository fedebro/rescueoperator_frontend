'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminDashboardDto, type AdminQueueStats } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import type { Column } from '@/components/ui/data-table';
import { Card, SectionTitle, Stat } from '@/components/ui/misc';
import { AdminTable, Heading, QueryState, StateBadge, UpdatedAt } from './shared';

const REFRESH_MS = 15_000;

export type QueueHealth = 'HEALTHY' | 'BUSY' | 'FAILING';
/** Failed jobs always need a human; a long waiting line only deserves attention. */
export function queueHealth(q: AdminQueueStats): QueueHealth {
  if (q.failed > 0) return 'FAILING';
  return q.waiting > 100 ? 'BUSY' : 'HEALTHY';
}
const HEALTH_TONE = { HEALTHY: 'success', BUSY: 'warning', FAILING: 'danger' } as const;

export function AdminDashboard() {
  const t = useTranslations('admin.dashboard');
  const locale = useLocale();
  const q = useQuery({
    queryKey: qk.admin('dashboard'),
    queryFn: adminApi.dashboard,
    refetchInterval: REFRESH_MS,
  });
  const d = q.data;
  const eur = React.useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }),
    [locale],
  );

  const queueColumns: Column<AdminQueueStats>[] = [
    {
      id: 'name',
      header: t('queue.name'),
      width: 'minmax(160px,2fr)',
      cell: (r) => <span className="font-mono text-xs font-semibold">{r.name}</span>,
    },
    {
      id: 'health',
      header: t('queue.health'),
      width: '150px',
      cell: (r) => {
        const health = queueHealth(r);
        return <StateBadge tone={HEALTH_TONE[health]} label={t(`health.${health}`)} />;
      },
    },
    ...(['waiting', 'active', 'delayed', 'failed', 'completed'] as const).map(
      (k): Column<AdminQueueStats> => ({
        id: k,
        header: t(`queue.${k}`),
        width: '100px',
        align: 'right',
        cell: (r) => <span className="tabular">{r[k].toLocaleString(locale)}</span>,
        sortValue: (r) => r[k],
      }),
    ),
  ];
  type Provider = AdminDashboardDto['providers'][number];
  const providerColumns: Column<Provider>[] = [
    {
      id: 'name',
      header: t('provider.name'),
      width: 'minmax(140px,1fr)',
      cell: (p) => (
        <span className="font-semibold">
          {t.has(`provider.names.${p.name}` as never) ? t(`provider.names.${p.name}` as never) : p.name}
        </span>
      ),
    },
    {
      id: 'health',
      header: t('provider.status'),
      width: '150px',
      cell: (p) => (
        <StateBadge
          tone={p.healthy ? 'success' : 'warning'}
          label={p.healthy ? t('provider.healthy') : t('provider.degraded')}
        />
      ),
    },
    {
      id: 'detail',
      header: t('provider.detail'),
      width: 'minmax(220px,3fr)',
      cell: (p) => <span className="text-muted">{p.detail ?? '—'}</span>,
    },
  ];

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        <UpdatedAt at={q.dataUpdatedAt} fetching={q.isFetching} onRefresh={() => void q.refetch()} />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        {d ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="admin-kpis">
              {(
                [
                  ['users', d.users.toLocaleString(locale), false],
                  ['careers', d.careers.toLocaleString(locale), false],
                  ['onDutyCareers', d.onDutyCareers.toLocaleString(locale), false],
                  ['activeIncidents', d.activeIncidents.toLocaleString(locale), false],
                  ['signups7d', d.signupsLast7d.toLocaleString(locale), false],
                  ['revenue30d', eur.format(d.revenueMinorLast30d / 100), false],
                  [
                    'overdueActions',
                    d.overdueScheduledActions.toLocaleString(locale),
                    d.overdueScheduledActions > 0,
                  ],
                  ['pendingOutbox', d.pendingOutbox.toLocaleString(locale), d.pendingOutbox > 100],
                ] as const
              ).map(([key, value, alert]) => (
                <Card key={key}>
                  <Stat
                    label={t(`kpi.${key}`)}
                    value={
                      alert ? (
                        <StateBadge tone="danger" label={value} />
                      ) : (
                        <span data-testid={`kpi-${key}`}>{value}</span>
                      )
                    }
                  />
                </Card>
              ))}
            </div>
            <section>
              <SectionTitle className="mt-2">{t('queues')}</SectionTitle>
              <AdminTable
                caption={t('queues')}
                columns={queueColumns}
                rows={d.queues}
                rowKey={(r) => r.name}
                titleColumn="name"
                cardTitle={(r) => <span className="font-mono text-sm">{r.name}</span>}
                density="dense"
                maxHeight={260}
                empty={null}
              />
            </section>
            <section>
              <SectionTitle className="mt-2">{t('providers')}</SectionTitle>
              <AdminTable
                caption={t('providers')}
                columns={providerColumns}
                rows={d.providers}
                rowKey={(p) => p.name}
                titleColumn="name"
                cardTitle={(p) => p.name}
                density="dense"
                maxHeight={260}
                empty={null}
              />
            </section>
          </>
        ) : null}
      </QueryState>
    </>
  );
}
