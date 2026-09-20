'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Truck, Zap } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useIsDesktop } from '@/hooks/use-media-query';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import { useInventory, type OrderV2 } from './api';
import { OrderStatusChip } from './visuals';

function Arrival({ order }: { order: OrderV2 }) {
  const t = useTranslations('logistics.orders');
  if (order.status !== 'IN_DELIVERY' && order.status !== 'PLACED')
    return <span className="text-subtle text-xs">{t('arrived')}</span>;
  return (
    <span className="flex items-center gap-2">
      <Countdown to={order.arrivesAt} doneLabel={t('arriving')} className="text-sm" />
      <SpeedupButton target="SUPPLY_DELIVERY" targetId={order.id} endsAt={order.arrivesAt} size="sm" />
    </span>
  );
}

function UrgentBadge() {
  const t = useTranslations('logistics.orders');
  return (
    <Badge tone="warning">
      <Zap className="size-3" aria-hidden />
      {t('urgent')}
    </Badge>
  );
}

/** Supplies orders: status chip, delivery countdown and speed-up. */
export function OrdersTab() {
  const t = useTranslations('logistics.orders');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const locale = useLocale();
  const desktop = useIsDesktop();
  const inventory = useInventory();
  const orders = (inventory.data?.orders ?? []).filter((o) => o.kind === 'SUPPLIES');

  if (inventory.isLoading) return <Skeleton className="h-40" />;
  if (orders.length === 0)
    return <EmptyState icon={<Truck className="size-5" />} title={t('empty')} description={t('emptyHint')} />;

  const columns: Column<OrderV2>[] = [
    {
      id: 'placed',
      header: t('col.placed'),
      width: '170px',
      cell: (o) => <span className="tabular text-muted">{formatDateTime(o.placedAt, locale)}</span>,
      sortValue: (o) => o.placedAt,
    },
    {
      id: 'summary',
      header: t('col.summary'),
      width: 'minmax(220px,3fr)',
      cell: (o) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{tx(o.summary)}</span>
          {o.urgent ? <UrgentBadge /> : null}
        </span>
      ),
    },
    {
      id: 'total',
      header: t('col.total'),
      width: '120px',
      align: 'right',
      cell: (o) => <CreditAmount value={o.total} label={tc('credits')} />,
      sortValue: (o) => BigInt(o.total),
    },
    {
      id: 'status',
      header: t('col.status'),
      width: '150px',
      cell: (o) => <OrderStatusChip status={o.status} />,
      sortValue: (o) => o.status,
    },
    { id: 'arrival', header: t('col.arrival'), width: '190px', cell: (o) => <Arrival order={o} /> },
  ];

  return desktop ? (
    <DataTable caption={t('title')} columns={columns} rows={orders} rowKey={(o) => o.id} density="compact" />
  ) : (
    <ul className="flex flex-col gap-2" data-testid="orders-list">
      {orders.map((o) => (
        <li
          key={o.id}
          className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3"
          data-testid="supply-order"
          data-order-status={o.status}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tx(o.summary)}</span>
            <OrderStatusChip status={o.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CreditAmount value={o.total} label={tc('credits')} />
            {o.urgent ? <UrgentBadge /> : null}
            <span className="ml-auto">
              <Arrival order={o} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
