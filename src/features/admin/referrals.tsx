'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Ban, CheckCircle2, Gift, ScanSearch, UserPlus } from 'lucide-react';
import { adminApi, type AdminReferralRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useReasonedAction } from './confirm-with-reason';
import { AdminTable, DateCell, Heading, NoPermission, QueryState, StateBadge, useCan } from './shared';

const ALL = 'ALL';
const STATUS_VISUAL = {
  REGISTERED: { tone: 'neutral', icon: UserPlus },
  ACTIVATED: { tone: 'info', icon: CheckCircle2 },
  REWARDED: { tone: 'success', icon: Gift },
  INVALIDATED: { tone: 'danger', icon: Ban },
  UNDER_REVIEW: { tone: 'warning', icon: ScanSearch },
} as const;
const STATUSES = Object.keys(STATUS_VISUAL) as (keyof typeof STATUS_VISUAL)[];

export function AdminReferrals() {
  const t = useTranslations('admin.referrals');
  const can = useCan();
  const [status, setStatus] = React.useState(ALL);
  const q = useQuery({
    queryKey: qk.admin('referrals', status),
    queryFn: () => adminApi.referrals({ status: status === ALL ? undefined : status }),
  });
  const review = useReasonedAction<{ row: AdminReferralRow; kind: 'approve' | 'invalidate' }>({
    run: ({ row, kind }, reason) =>
      kind === 'approve'
        ? adminApi.approveReferral(row.id, reason)
        : adminApi.invalidateReferral(row.id, reason),
    success: t('done'),
    invalidate: [qk.admin('referrals')],
  });
  const columns: Column<AdminReferralRow>[] = [
    { id: 'referrer', header: t('referrer'), width: 'minmax(170px,1.5fr)', cell: (r) => r.referrerName },
    { id: 'invited', header: t('invited'), width: 'minmax(170px,1.5fr)', cell: (r) => r.invitedName },
    {
      id: 'status',
      header: t('status'),
      width: '170px',
      cell: (r) => (
        <StateBadge
          tone={STATUS_VISUAL[r.status].tone}
          icon={STATUS_VISUAL[r.status].icon}
          label={t(`statuses.${r.status}`)}
        />
      ),
      sortValue: (r) => r.status,
    },
    {
      id: 'signals',
      header: t('signals'),
      width: 'minmax(220px,2fr)',
      cell: (r) =>
        r.signals.length === 0 ? (
          <span className="text-subtle">{t('noSignals')}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {r.signals.map((s) => (
              <Badge key={s} tone="warning">
                {s}
              </Badge>
            ))}
          </span>
        ),
    },
    { id: 'created', header: t('created'), width: '170px', cell: (r) => <DateCell iso={r.createdAt} /> },
    {
      id: 'review',
      header: t('review'),
      width: 'minmax(200px,2fr)',
      cell: (r) => <span className="text-muted">{r.reviewNote ?? ''}</span>,
    },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        {can('referrals.review') ? null : <NoPermission />}
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          options={[
            { value: ALL, label: t('all') },
            ...STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
          ]}
        />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.id}
          cardTitle={(r) => `${r.referrerName} → ${r.invitedName}`}
          actionsWidth="220px"
          actions={
            can('referrals.review')
              ? (r) =>
                  r.status === 'REWARDED' ? null : (
                    <>
                      {r.status !== 'ACTIVATED' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7"
                          onClick={() =>
                            review.ask(
                              { row: r, kind: 'approve' },
                              {
                                title: t('approveTitle'),
                                description: t('approveBody'),
                                targetId: r.id,
                                confirmLabel: t('approve'),
                                tone: 'primary',
                              },
                            )
                          }
                        >
                          {t('approve')}
                        </Button>
                      ) : null}
                      {r.status !== 'INVALIDATED' ? (
                        <Button
                          size="sm"
                          variant="danger"
                          className="h-7"
                          onClick={() =>
                            review.ask(
                              { row: r, kind: 'invalidate' },
                              {
                                title: t('invalidateTitle'),
                                description: t('invalidateBody'),
                                targetId: r.id,
                                confirmLabel: t('invalidate'),
                              },
                            )
                          }
                        >
                          {t('invalidate')}
                        </Button>
                      ) : null}
                    </>
                  )
              : undefined
          }
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
      {review.dialog}
    </>
  );
}
