'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Package, ShoppingCart } from 'lucide-react';
import type { InventoryLine } from './api';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useIsDesktop } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { useSnapshot } from '@/features/game/hooks';
import { useInventory } from './api';
import { OrderDialog } from './order-dialog';
import { StockChip } from './visuals';

/** Low-stock alert: icon + sentence, never colour alone. */
export function LowStockAlert({ count, onOrder }: { count: number; onOrder?: () => void }) {
  const t = useTranslations('logistics.stock');
  if (count === 0) return null;
  return (
    <div
      role="status"
      data-testid="low-stock-alert"
      className="border-warning/40 bg-warning/10 text-warning flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5 text-sm font-semibold"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{t('lowAlert', { count })}</span>
      {onOrder ? (
        <Button size="sm" variant="secondary" onClick={onOrder} data-testid="low-stock-order">
          <ShoppingCart className="size-3.5" aria-hidden />
          {t('order')}
        </Button>
      ) : null}
    </div>
  );
}

/** Card list of stock lines (mobile layout of the warehouse + the facility page section on every layout). */
export function StockLines({ lines }: { lines: InventoryLine[] }) {
  const t = useTranslations('logistics.stock');
  const name = useCatalogName();
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((l) => (
        <li
          key={`${l.facilityId}-${l.itemCode}`}
          className="border-border bg-surface-2 rounded-md border p-3"
          data-testid="stock-line"
          data-item={l.itemCode}
          data-low={l.low}
        >
          <div className="flex items-center gap-2">
            <Package className="text-muted size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name('item', l.itemCode)}</span>
            <StockChip low={l.low} />
          </div>
          <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
            {(
              [
                ['quantity', l.quantity],
                ['reserved', l.reserved],
                ['inbound', l.inbound],
                ['minimum', l.minimum],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-subtle truncate text-[10px] font-semibold tracking-wide uppercase">
                  {t(`col.${key}`)}
                </dt>
                <dd className="tabular text-sm font-semibold" data-testid={`stock-${key}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** Warehouse tab: every facility's stock. Desktop = one dense table, mobile = one card per facility. */
export function WarehouseTab() {
  const t = useTranslations('logistics.stock');
  const name = useCatalogName();
  const desktop = useIsDesktop();
  const { facilities } = useSnapshot();
  const inventory = useInventory();
  const [orderFor, setOrderFor] = React.useState<string | null>(null);
  const lines = inventory.data?.lines ?? [];
  const lowCount = lines.filter((l) => l.low).length;
  const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? '—';
  const firstLow = lines.find((l) => l.low)?.facilityId ?? lines[0]?.facilityId ?? null;

  if (inventory.isLoading) return <Skeleton className="h-48" />;
  if (lines.length === 0)
    return (
      <EmptyState icon={<Package className="size-5" />} title={t('empty')} description={t('emptyHint')} />
    );

  const columns: Column<InventoryLine>[] = [
    {
      id: 'facility',
      header: t('col.facility'),
      width: 'minmax(160px,2fr)',
      cell: (l) => <span className="truncate">{facilityName(l.facilityId)}</span>,
      sortValue: (l) => facilityName(l.facilityId),
    },
    {
      id: 'item',
      header: t('col.item'),
      width: 'minmax(160px,2fr)',
      cell: (l) => <span className="truncate font-semibold">{name('item', l.itemCode)}</span>,
      sortValue: (l) => name('item', l.itemCode),
    },
    ...(['quantity', 'reserved', 'inbound', 'minimum'] as const).map((key): Column<InventoryLine> => ({
      id: key,
      header: t(`col.${key}`),
      width: '104px',
      align: 'right',
      cell: (l) => <span className="tabular">{l[key]}</span>,
      sortValue: (l) => l[key],
    })),
    {
      id: 'state',
      header: t('col.state'),
      width: '150px',
      cell: (l) => <StockChip low={l.low} />,
      sortValue: (l) => (l.low ? 0 : 1),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="warehouse-tab">
      <LowStockAlert count={lowCount} onOrder={firstLow ? () => setOrderFor(firstLow) : undefined} />
      {desktop ? (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setOrderFor(firstLow)} data-testid="open-order">
              <ShoppingCart className="size-4" aria-hidden />
              {t('order')}
            </Button>
          </div>
          <DataTable
            caption={t('title')}
            columns={columns}
            rows={lines}
            rowKey={(l) => `${l.facilityId}-${l.itemCode}`}
            density="dense"
            onRowClick={(l) => setOrderFor(l.facilityId)}
          />
        </>
      ) : (
        facilities
          .filter((f) => lines.some((l) => l.facilityId === f.id))
          .map((f) => (
            <Card key={f.id} className="flex flex-col gap-3">
              <SectionTitle
                action={
                  <Button size="sm" onClick={() => setOrderFor(f.id)} data-testid="open-order">
                    <ShoppingCart className="size-3.5" aria-hidden />
                    {t('order')}
                  </Button>
                }
              >
                {f.name}
              </SectionTitle>
              <StockLines lines={lines.filter((l) => l.facilityId === f.id)} />
            </Card>
          ))
      )}
      <OrderDialog
        open={orderFor !== null}
        onOpenChange={(o) => {
          if (!o) setOrderFor(null);
        }}
        facilityId={orderFor ?? undefined}
      />
    </div>
  );
}
