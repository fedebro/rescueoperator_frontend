'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock, Minus, Package, Plus, Sparkles, Zap } from 'lucide-react';
import { logisticsApi } from '@/lib/api/depth';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { qk } from '@/lib/api/query-keys';
import { track } from '@/lib/analytics';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { Button, IconButton } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { ProgressBar, SectionTitle } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import {
  DEFAULT_URGENT,
  quoteLines,
  useInventory,
  useItemTypes,
  type InventoryLine,
  type ItemType,
} from './api';
import { StockChip } from './visuals';

/** Packs that bring a low line back to a comfortable level (2.5 × its minimum), counting what is already inbound. */
export function suggestedPacks(line: InventoryLine, packSize: number): number {
  if (!line.low) return 0;
  const target = Math.max(line.minimum * 2.5, line.minimum + packSize);
  return Math.max(0, Math.ceil((target - line.quantity - line.inbound) / packSize));
}

export function OrderDialog({
  open,
  onOpenChange,
  facilityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId?: string;
}) {
  const t = useTranslations('logistics.order');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('title')}
        description={t('subtitle')}
        closeLabel={tc('close')}
        data-testid="order-dialog"
      >
        {/* The form lives inside the content: Radix unmounts it on close, so every order starts from a clean state. */}
        <OrderForm facilityId={facilityId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function OrderForm({ facilityId: initialFacilityId, onDone }: { facilityId?: string; onDone: () => void }) {
  const t = useTranslations('logistics.order');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const careerId = useCareerId();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const { facilities } = useSnapshot();
  const inventory = useInventory();
  const { items } = useItemTypes();
  const [facilityId, setFacilityId] = React.useState(initialFacilityId);
  const [packs, setPacks] = React.useState<Record<string, number>>({});
  const [urgent, setUrgent] = React.useState(false);

  const lines = React.useMemo(() => inventory.data?.lines ?? [], [inventory.data]);
  const stocked = facilities.filter((f) => lines.some((l) => l.facilityId === f.id));
  const activeFacilityId = facilityId ?? initialFacilityId ?? stocked[0]?.id;
  const rows = lines
    .filter((l) => l.facilityId === activeFacilityId)
    .flatMap((line) => {
      const item = items.find((i) => i.code === line.itemCode);
      return item ? [{ line, item }] : [];
    });
  const chosen = rows
    .map((r) => ({ item: r.item, packs: packs[r.item.code] ?? 0 }))
    .filter((r) => r.packs > 0);
  const quote = quoteLines(chosen, inventory.data?.urgent ?? DEFAULT_URGENT);
  const active = urgent ? quote.urgent : quote.standard;
  const storage = inventory.data?.storage?.find((s) => s.facilityId === activeFacilityId);
  const addedPacks = chosen.reduce((s, r) => s + r.packs, 0);

  const setItemPacks = (item: ItemType, value: number) =>
    setPacks((p) => ({ ...p, [item.code]: Math.max(0, Math.min(99, value)) }));

  const order = useMutation({
    mutationFn: () =>
      logisticsApi.order(careerId, {
        facilityId: activeFacilityId ?? '',
        lines: chosen.map((r) => ({ itemCode: r.item.code, quantity: r.packs * r.item.packSize })),
        urgent,
      }),
    onSuccess: () => {
      track('supplies_ordered', { lines: chosen.length, packs: addedPacks, urgent });
      toast({ tone: 'success', title: t('placed') });
      void qc.invalidateQueries({ queryKey: qk.inventory(careerId) });
      onDone();
    },
    onError: (e) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS')) requestCredits(active.total);
      else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });

  return (
    <>
      {stocked.length > 1 ? (
        <div className="mb-4">
          <SectionTitle>{t('facility')}</SectionTitle>
          <Select
            label={t('facility')}
            value={activeFacilityId}
            onValueChange={(v) => {
              setFacilityId(v);
              setPacks({});
            }}
            options={stocked.map((f) => ({ value: f.id, label: f.name }))}
            className="w-full"
          />
        </div>
      ) : null}
      <SectionTitle
        action={
          rows.some((r) => r.line.low) ? (
            <Button
              variant="ghost"
              size="sm"
              data-testid="order-suggest"
              onClick={() =>
                setPacks(
                  Object.fromEntries(rows.map((r) => [r.item.code, suggestedPacks(r.line, r.item.packSize)])),
                )
              }
            >
              <Sparkles className="size-3.5" aria-hidden />
              {t('suggest')}
            </Button>
          ) : null
        }
      >
        {t('lines')}
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {rows.map(({ line, item }) => {
          const count = packs[item.code] ?? 0;
          const itemName = name('item', item.code);
          return (
            <li
              key={item.code}
              className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-2.5"
              data-testid="order-line"
              data-item={item.code}
            >
              <Package className="text-muted size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                  <span className="truncate">{itemName}</span>
                  {line.low ? <StockChip low /> : null}
                </p>
                <p className="text-muted flex flex-wrap items-center gap-x-2 text-xs">
                  <span>{t('pack', { size: item.packSize, unit: name('item', item.code, 'unit') })}</span>
                  <CreditAmount
                    value={BigInt(item.price) * BigInt(item.packSize)}
                    label={tc('credits')}
                    size="sm"
                  />
                  <span className="tabular">{t('inStock', { quantity: line.quantity })}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  label={t('decrease', { item: itemName })}
                  variant="secondary"
                  disabled={count === 0}
                  onClick={() => setItemPacks(item, count - 1)}
                >
                  <Minus className="size-4" aria-hidden />
                </IconButton>
                <span
                  className="tabular w-8 text-center text-base font-bold"
                  aria-live="polite"
                  aria-label={t('packsOf', { count, item: itemName })}
                  data-testid="order-packs"
                >
                  {count}
                </span>
                <IconButton
                  label={t('increase', { item: itemName })}
                  variant="secondary"
                  onClick={() => setItemPacks(item, count + 1)}
                >
                  <Plus className="size-4" aria-hidden />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      {storage ? (
        <div className="mt-3">
          <div className="text-muted mb-1 flex items-center justify-between text-xs">
            <span>{t('storage')}</span>
            <span className="tabular">
              {storage.used + addedPacks}/{storage.capacity}
            </span>
          </div>
          <ProgressBar
            value={storage.capacity ? (storage.used + addedPacks) / storage.capacity : 0}
            label={t('storage')}
            tone={storage.used + addedPacks > storage.capacity ? 'warning' : 'info'}
          />
        </div>
      ) : null}

      <SectionTitle className="mt-5">{t('delivery')}</SectionTitle>
      <div role="radiogroup" aria-label={t('delivery')} className="grid grid-cols-2 gap-2">
        {(
          [
            { key: 'standard', value: false, icon: Clock, q: quote.standard },
            { key: 'urgent', value: true, icon: Zap, q: quote.urgent },
          ] as const
        ).map(({ key, value, icon: Icon, q }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={urgent === value}
            onClick={() => setUrgent(value)}
            data-testid={`quote-${key}`}
            className={cn(
              'flex min-h-20 flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors',
              urgent === value
                ? 'border-brand bg-brand-soft'
                : 'border-border-strong bg-surface-2 hover:bg-surface-3',
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon className="size-4" aria-hidden />
              {t(key)}
            </span>
            <CreditAmount value={q.total} label={tc('credits')} />
            <span className="tabular text-muted text-xs">
              {t('arrivesIn', { time: formatClock(q.seconds) })}
            </span>
          </button>
        ))}
      </div>
      <p className="text-subtle mt-2 text-xs">{t('urgentHint')}</p>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button
          size="lg"
          disabled={chosen.length === 0 || !activeFacilityId}
          loading={order.isPending}
          onClick={() => order.mutate()}
          data-testid="order-submit"
        >
          {t('submit')}
          <CreditAmount value={active.total} label={tc('credits')} tone="plain" className="text-white" />
        </Button>
      </DialogFooter>
    </>
  );
}
