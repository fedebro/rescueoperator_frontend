'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ChevronDown, Fuel, Gauge, Package, Plane } from 'lucide-react';
import type { VehicleAutonomyDto } from '@/contracts';
import { catalogIconName, GameIcon } from '@/design/icons';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { cn } from '@/lib/utils';
import {
  autonomyTone,
  fuelTone,
  isFull,
  lowItems,
  stockRatio,
  stockTone,
  type AutonomyTone,
} from './autonomy';

const BAR: Record<AutonomyTone, string> = { ok: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
const TEXT: Record<AutonomyTone, string> = {
  ok: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};
const CHIP: Record<AutonomyTone, string> = {
  ok: 'text-success border-success/40 bg-success/10',
  warning: 'text-warning border-warning/40 bg-warning/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
};

/** Item code → its catalog icon key (`EXTRICATION_KIT` → `item-extrication-kit`). */
const itemIcon = (code: string) => catalogIconName(`item-${code.toLowerCase().replaceAll('_', '-')}`);

/** A thin bar; colour only reinforces the state, which is always also written next to it. */
export function AutonomyBar({
  value,
  tone,
  label,
  className,
}: {
  value: number;
  tone: AutonomyTone;
  label: string;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('bg-surface-3 h-1.5 min-w-0 overflow-hidden rounded-full', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', BAR[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Small state tag: icon + words (never colour alone). */
function StateTag({ tone, children }: { tone: AutonomyTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-xs leading-none font-semibold whitespace-nowrap',
        CHIP[tone],
      )}
    >
      {tone === 'ok' ? null : <AlertTriangle className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * Tank gauge (study §3.4 "Carburante", a jerrycan): km left of the range, reserve / low tags. Aircraft (flight endurance,
 * phase 3) send the same block in minutes of flight: an additive `fuel.unit: 'MIN'` the gauge already reads.
 */
export function FuelGauge({ fuel }: { fuel: NonNullable<VehicleAutonomyDto['fuel']> }) {
  const t = useTranslations('autonomy');
  const tone = fuelTone(fuel);
  const flight = (fuel as { unit?: 'KM' | 'MIN' }).unit === 'MIN';
  const Icon = flight ? Plane : Fuel;
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="fuel-gauge"
      data-tone={tone}
      data-ratio={fuel.ratio}
      data-unit={flight ? 'MIN' : 'KM'}
    >
      <div className="flex min-h-5 items-center gap-2 text-xs">
        <Icon className={cn('size-4 shrink-0', TEXT[tone])} aria-hidden />
        <span className="text-muted min-w-0 flex-1 truncate font-semibold">
          {flight ? t('flight') : t('fuel')}
        </span>
        {fuel.reserve ? (
          <StateTag tone="danger">{t('reserve')}</StateTag>
        ) : fuel.low ? (
          <StateTag tone="warning">{t('low')}</StateTag>
        ) : null}
        <span className="tabular text-fg shrink-0" data-testid="fuel-value">
          {flight
            ? t('flightValue', { minutes: Math.round(fuel.km), range: fuel.rangeKm })
            : t('fuelValue', { km: Math.round(fuel.km), range: fuel.rangeKm })}
        </span>
      </div>
      <AutonomyBar value={fuel.ratio} tone={tone} label={flight ? t('flight') : t('fuel')} />
    </div>
  );
}

/**
 * Onboard stock gauge (a toolbox): the bar is the most depleted item — the one the rule looks at — and the whole row opens
 * the per-item detail on demand (study §3.4: details only on request).
 */
export function StockGauge({ items }: { items: VehicleAutonomyDto['items'] }) {
  const t = useTranslations('autonomy');
  const name = useCatalogName();
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const tone = stockTone({ items });
  const ratio = stockRatio({ items }) ?? 1;
  const low = lowItems({ items }).length;
  return (
    <div className="flex flex-col" data-testid="stock-gauge" data-tone={tone}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="hover:bg-surface-3 -mx-1.5 flex min-h-11 flex-col justify-center gap-1.5 rounded-md px-1.5 text-left"
        data-testid="stock-toggle"
      >
        <span className="flex min-h-5 w-full items-center gap-2 text-xs">
          <Package className={cn('size-4 shrink-0', TEXT[tone])} aria-hidden />
          <span className="text-muted min-w-0 flex-1 truncate font-semibold">{t('stock')}</span>
          {/* Either what needs reloading or, when all is well, how many items are carried: never both (375 px). */}
          {low > 0 ? (
            <StateTag tone={tone}>{t('itemsLow', { count: low })}</StateTag>
          ) : (
            <span className="text-fg shrink-0">{t('stockValue', { count: items.length })}</span>
          )}
          <ChevronDown
            className={cn('text-muted size-4 shrink-0 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
          <span className="sr-only">{open ? t('hideItems') : t('showItems')}</span>
        </span>
        <AutonomyBar value={ratio} tone={tone} label={t('stock')} className="w-full" />
      </button>
      {open ? (
        <ul id={id} className="mt-1 flex flex-col gap-1.5" data-testid="stock-items">
          {items.map((item) => {
            const itemTone: AutonomyTone = item.quantity <= 0 ? 'danger' : item.low ? 'warning' : 'ok';
            const itemName = name('item', item.itemCode);
            return (
              <li
                key={item.itemCode}
                className="flex min-h-7 items-center gap-2 text-xs"
                data-testid="stock-item"
                data-item={item.itemCode}
                data-low={item.low}
              >
                <GameIcon name={itemIcon(item.itemCode)} size={16} className="text-muted" />
                <span className="min-w-0 flex-1 truncate" title={itemName}>
                  {itemName}
                </span>
                {item.low ? (
                  <span className={cn('shrink-0', TEXT[itemTone])} title={t('itemLow')}>
                    <AlertTriangle className="size-3.5" aria-hidden />
                    <span className="sr-only">{t('itemLow')}</span>
                  </span>
                ) : null}
                <AutonomyBar
                  value={item.capacity > 0 ? item.quantity / item.capacity : 0}
                  tone={itemTone}
                  label={itemName}
                  className="w-12 shrink-0"
                />
                <span className="tabular text-muted min-w-[4.5rem] shrink-0 text-right whitespace-nowrap">
                  {t('itemQuantity', { quantity: item.quantity, capacity: item.capacity })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** "Autonomia: circa N missioni" — the one line that is enough in 90 % of the cases (study §3.7). */
export function MissionsLeftLine({
  autonomy,
  className,
}: {
  autonomy: VehicleAutonomyDto;
  className?: string;
}) {
  const t = useTranslations('autonomy');
  const tone = autonomyTone(autonomy);
  const count = autonomy.missionsLeftEstimate;
  return (
    <p
      className={cn('flex items-center gap-2 text-sm font-semibold', TEXT[tone], className)}
      data-testid="missions-left"
      data-tone={tone}
      data-count={count ?? ''}
    >
      <Gauge className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {count === null ? t('title') : t('missionsLeft', { count: autonomy.needsResupply ? 0 : count })}
      </span>
      {isFull(autonomy) ? (
        <span className="text-subtle shrink-0 text-xs font-normal">{t('fullAutonomy')}</span>
      ) : null}
    </p>
  );
}

/** Compact fleet indicator: a jerrycan + "~N missioni" / "Da rifornire", tinted; the long form for screen readers. */
export function AutonomyChip({ autonomy, className }: { autonomy: VehicleAutonomyDto; className?: string }) {
  const t = useTranslations('autonomy');
  const tone = autonomyTone(autonomy);
  const count = autonomy.needsResupply ? 0 : autonomy.missionsLeftEstimate;
  if (count === null) return null;
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap',
        CHIP[tone],
        className,
      )}
      data-testid="autonomy-chip"
      data-tone={tone}
      title={t('missionsLeft', { count })}
    >
      <Fuel className="size-3" aria-hidden />
      <span aria-hidden>{t('missionsShort', { count })}</span>
      <span className="sr-only">{t('missionsLeft', { count })}</span>
    </span>
  );
}
