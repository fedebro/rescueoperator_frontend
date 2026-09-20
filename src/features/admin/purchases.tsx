'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, CreditCard, Search, Undo2, XCircle } from 'lucide-react';
import { adminApi, type AdminPurchaseRow } from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import type { Column } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useReasonedAction } from './confirm-with-reason';
import {
  AdminTable,
  DateCell,
  Heading,
  IdCode,
  QueryState,
  StateBadge,
  useCan,
  useDebounced,
} from './shared';

const ALL = 'ALL';
const STATUS_VISUAL = {
  CREATED: { tone: 'neutral', icon: CircleDashed },
  PAID: { tone: 'info', icon: CreditCard },
  CREDITED: { tone: 'success', icon: CheckCircle2 },
  FAILED: { tone: 'danger', icon: XCircle },
  REFUNDED: { tone: 'warning', icon: Undo2 },
} as const;
const STATUSES = Object.keys(STATUS_VISUAL) as (keyof typeof STATUS_VISUAL)[];

/** Money never moves from here: refunds happen at the payment provider; the admin only flags a purchase for review. */
export function AdminPurchases() {
  const t = useTranslations('admin.purchases');
  const locale = useLocale();
  const can = useCan();
  const [status, setStatus] = React.useState(ALL);
  const [value, search, setValue] = useDebounced();
  const q = useQuery({
    queryKey: qk.admin('purchases', status, search),
    queryFn: () =>
      adminApi.purchases({ status: status === ALL ? undefined : status, q: search || undefined }),
  });
  const flag = useReasonedAction<AdminPurchaseRow>({
    run: (row, reason) => adminApi.markPurchaseForRefundReview(row.id, reason),
    success: t('flagged'),
    invalidate: [qk.admin('purchases')],
  });
  const money = (p: AdminPurchaseRow) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency }).format(p.priceMinor / 100);
  const columns: Column<AdminPurchaseRow>[] = [
    {
      id: 'created',
      header: t('created'),
      width: '170px',
      cell: (p) => <DateCell iso={p.createdAt} />,
      sortValue: (p) => p.createdAt,
    },
    { id: 'email', header: t('user'), width: 'minmax(200px,2fr)', cell: (p) => p.email },
    {
      id: 'package',
      header: t('package'),
      width: '120px',
      cell: (p) => <code className="text-xs">{p.packageId}</code>,
    },
    {
      id: 'amount',
      header: t('amount'),
      width: '110px',
      align: 'right',
      cell: (p) => money(p),
      sortValue: (p) => p.priceMinor,
    },
    {
      id: 'credits',
      header: t('credits'),
      width: '120px',
      align: 'right',
      cell: (p) => <CreditAmount value={p.credits} label={t('credits')} size="sm" />,
    },
    {
      id: 'status',
      header: t('status'),
      width: '160px',
      cell: (p) => (
        <StateBadge
          tone={STATUS_VISUAL[p.status].tone}
          icon={STATUS_VISUAL[p.status].icon}
          label={t(`statuses.${p.status}`)}
        />
      ),
      sortValue: (p) => p.status,
    },
    {
      id: 'refund',
      header: t('refund'),
      width: 'minmax(180px,1.5fr)',
      cell: (p) =>
        p.refunded ? (
          <StateBadge tone="warning" icon={Undo2} label={t('refunded')} />
        ) : p.refundReview ? (
          <span title={p.refundReview.reason}>
            <StateBadge tone="info" label={t('underReview')} />
          </span>
        ) : (
          <span className="text-subtle">—</span>
        ),
    },
    {
      id: 'career',
      header: t('career'),
      width: 'minmax(250px,1.5fr)',
      cell: (p) => (p.careerId ? <IdCode value={p.careerId} href={`/admin/careers/${p.careerId}`} /> : '—'),
    },
    {
      id: 'provider',
      header: t('providerRef'),
      width: 'minmax(180px,1.5fr)',
      cell: (p) => (p.providerRef ? <IdCode value={p.providerRef} /> : '—'),
    },
    { id: 'id', header: 'ID', width: '130px', cell: (p) => <IdCode value={p.id} /> },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        <Select
          label={t('status')}
          value={status}
          onValueChange={setStatus}
          options={[
            { value: ALL, label: t('all') },
            ...STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
          ]}
        />
        <Input
          className="w-full text-base sm:w-72 lg:text-sm"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          leading={<Search className="size-4" />}
        />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(p) => p.id}
          cardTitle={(p) => `${p.email} · ${money(p)}`}
          actionsWidth="210px"
          actions={
            can('purchases.refundReview')
              ? (p) =>
                  !p.refunded && !p.refundReview && (p.status === 'PAID' || p.status === 'CREDITED') ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7"
                      onClick={() =>
                        flag.ask(p, {
                          title: t('flagTitle'),
                          description: t('flagBody'),
                          targetId: p.id,
                          confirmLabel: t('flag'),
                          tone: 'primary',
                        })
                      }
                    >
                      {t('flag')}
                    </Button>
                  ) : null
              : undefined
          }
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
      {flag.dialog}
    </>
  );
}
