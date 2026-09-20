'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Activity,
  HeartPulse,
  OctagonAlert,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Minus,
} from 'lucide-react';
import type { PatientDto } from '@/contracts';
import { useServerNow } from '@/hooks/use-server-now';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { stabilityBand, stabilityNow, stabilityTrend, type StabilityBand } from './visuals';

const BAND: Record<StabilityBand, { icon: typeof Activity; text: string; bar: string }> = {
  stable: { icon: HeartPulse, text: 'text-success', bar: 'bg-success' },
  watch: { icon: Activity, text: 'text-warning', bar: 'bg-warning' },
  unstable: { icon: TriangleAlert, text: 'text-[var(--rc-sev-7)]', bar: 'bg-[var(--rc-sev-7)]' },
  critical: { icon: OctagonAlert, text: 'text-danger', bar: 'bg-danger' },
};
const TREND = { improving: TrendingUp, worsening: TrendingDown, steady: Minus } as const;

/**
 * Stability gauge animated from the server anchor `{value, ratePerSecond, anchorAt}` with the server clock — no polling.
 * Band (icon + label) and trend (icon + label) are always spelled out; the bar colour only reinforces them.
 */
export function StabilityGauge({ stability }: { stability: NonNullable<PatientDto['stability']> }) {
  const t = useTranslations('medical.stability');
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const moving = Math.abs(stability.ratePerSecond) > 1e-6;
  const now = useServerNow(reducedMotion ? 5000 : 1000, moving);
  const value = stabilityNow(stability, now);
  const band = stabilityBand(value);
  const trend = stabilityTrend(stability.ratePerSecond, value);
  const BandIcon = BAND[band].icon;
  const TrendIcon = TREND[trend];
  const rounded = Math.round(value);
  return (
    <div className="flex flex-col gap-1" data-testid="stability-gauge" data-band={band} data-trend={trend}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn('inline-flex items-center gap-1 font-semibold', BAND[band].text)}>
          <BandIcon className="size-3.5" aria-hidden />
          {t(`band.${band}`)}
        </span>
        <span className="text-muted inline-flex items-center gap-1">
          <TrendIcon className="size-3.5" aria-hidden />
          {t(`trend.${trend}`)}
          <span className="tabular text-fg ml-1 font-semibold">{rounded}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={t('label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${t('value', { value: rounded })} — ${t(`band.${band}`)}, ${t(`trend.${trend}`)}`}
        className="bg-surface-3 relative h-2 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            'h-full rounded-full',
            BAND[band].bar,
            reducedMotion ? '' : 'transition-[width] duration-1000 ease-linear motion-reduce:transition-none',
          )}
          style={{ width: `${rounded}%` }}
        />
        {/* band thresholds (critical / unstable / watch) as ticks, so the bands can be read without colour */}
        {[20, 45, 70].map((mark) => (
          <span
            key={mark}
            aria-hidden
            className="bg-surface-1/80 absolute top-0 h-full w-px"
            style={{ left: `${mark}%` }}
          />
        ))}
      </div>
    </div>
  );
}
