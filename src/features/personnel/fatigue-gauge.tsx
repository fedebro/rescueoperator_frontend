'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, type LucideIcon } from 'lucide-react';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { FATIGUE_THRESHOLDS, useFatigue, type FatigueAnchor, type FatigueBand } from './fatigue';

const BAND_VISUALS: Record<FatigueBand, { icon: LucideIcon; text: string; bar: string }> = {
  RESTED: { icon: BatteryFull, text: 'text-success', bar: 'bg-success' },
  TIRED: { icon: BatteryMedium, text: 'text-info', bar: 'bg-info' },
  FATIGUED: { icon: BatteryLow, text: 'text-warning', bar: 'bg-warning' },
  REST_REQUIRED: { icon: BatteryWarning, text: 'text-danger', bar: 'bg-danger' },
};

/** Band name from the catalog bundle (`fatigueBand.*`) with its icon — never colour alone. */
export function FatigueBandLabel({ band, className }: { band: FatigueBand; className?: string }) {
  const name = useCatalogName();
  const visual = BAND_VISUALS[band];
  const Icon = visual.icon;
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs font-semibold', visual.text, className)}
      data-band={band}
    >
      <Icon className="size-3.5" aria-hidden />
      {name('fatigueBand', band)}
    </span>
  );
}

/**
 * Fatigue meter animated from the anchor `{value, ratePerSecond, anchorAt}` against the server clock.
 * `compact` = table cell (bar + number); full = operator sheet (band label, threshold ticks, trend).
 */
export function FatigueGauge({ fatigue, compact }: { fatigue: FatigueAnchor; compact?: boolean }) {
  const t = useTranslations('personnel.fatigue');
  const name = useCatalogName();
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const { value, band } = useFatigue(fatigue, compact ? 5000 : 1000);
  const visual = BAND_VISUALS[band];
  const rounded = Math.round(value);
  const bar = (
    <div
      role="meter"
      aria-label={t('label')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
      aria-valuetext={`${rounded}/100 · ${name('fatigueBand', band)}`}
      className={cn(
        'bg-surface-3 relative min-w-0 flex-1 overflow-hidden rounded-full',
        compact ? 'h-1.5' : 'h-3',
      )}
      data-testid="fatigue-gauge"
      data-band={band}
    >
      <div
        className={cn(
          'h-full rounded-full',
          visual.bar,
          !reducedMotion && 'transition-[width] duration-1000 ease-linear',
        )}
        style={{ width: `${value}%` }}
      />
      {compact
        ? null
        : Object.values(FATIGUE_THRESHOLDS).map((threshold) => (
            <span
              key={threshold}
              aria-hidden
              className="bg-fg/60 absolute inset-y-0 w-px"
              style={{ left: `${threshold}%` }}
            />
          ))}
    </div>
  );
  if (compact)
    return (
      <span className="flex w-full items-center gap-2">
        {bar}
        <span className={cn('tabular w-7 text-right text-xs font-semibold', visual.text)}>{rounded}</span>
      </span>
    );
  const trend =
    value <= 0 || fatigue.ratePerSecond === 0 ? 'stable' : fatigue.ratePerSecond < 0 ? 'down' : 'up';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <FatigueBandLabel band={band} className="text-sm" />
        <span className="tabular text-fg text-sm font-semibold">{rounded}/100</span>
      </div>
      {bar}
      <p className="text-subtle text-xs">{t(`trend.${trend}`)}</p>
    </div>
  );
}
