'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertOctagon,
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  CircleDashed,
  Gauge,
  Hourglass,
  Lock,
  PackageCheck,
  PackageX,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Truck,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { VehicleDto } from '@/contracts';
import type { MaintenanceStatus } from './api';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/misc';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
const TONE: Record<Tone, string> = {
  neutral: 'text-muted border-border-strong bg-surface-3',
  info: 'text-info border-info/40 bg-info/10',
  success: 'text-success border-success/40 bg-success/10',
  warning: 'text-warning border-warning/40 bg-warning/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
};

/** State chip of this area: ALWAYS icon + label, colour is only reinforcement (same look as `StatusChip`). */
export function StateChip({
  icon: Icon,
  tone,
  label,
  state,
  className,
  ...props
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  state: string;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap',
        TONE[tone],
        className,
      )}
      {...props}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

type Band = VehicleDto['healthBand'];
const BAND: Record<Band, { icon: LucideIcon; tone: Tone }> = {
  EXCELLENT: { icon: CheckCircle2, tone: 'success' },
  GOOD: { icon: CheckCircle2, tone: 'success' },
  WORN: { icon: Gauge, tone: 'warning' },
  HIGH_RISK: { icon: AlertTriangle, tone: 'warning' },
  CRITICAL: { icon: AlertOctagon, tone: 'danger' },
  INOPERABLE: { icon: XCircle, tone: 'danger' },
};
export function HealthBandChip({ band }: { band: Band }) {
  const t = useTranslations('status.health');
  return <StateChip {...BAND[band]} state={band} label={t(band)} data-testid="health-band" />;
}
export const healthTone = (band: Band): 'success' | 'warning' | 'brand' =>
  BAND[band].tone === 'success' ? 'success' : BAND[band].tone === 'warning' ? 'warning' : 'brand';

type Due = MaintenanceStatus['due'];
const DUE: Record<Due, { icon: LucideIcon; tone: Tone }> = {
  NOT_DUE: { icon: CalendarCheck, tone: 'neutral' },
  UPCOMING: { icon: CalendarClock, tone: 'info' },
  DUE: { icon: CalendarClock, tone: 'warning' },
  OVERDUE: { icon: CalendarX, tone: 'danger' },
};
export function DueChip({ due }: { due: Due }) {
  const t = useTranslations('logistics.due');
  return <StateChip {...DUE[due]} state={due} label={t(due)} data-testid="due-state" />;
}

type Risk = MaintenanceStatus['failureRisk'];
const RISK: Record<Risk, { icon: LucideIcon; tone: Tone }> = {
  LOW: { icon: ShieldCheck, tone: 'success' },
  MEDIUM: { icon: ShieldQuestion, tone: 'warning' },
  HIGH: { icon: ShieldAlert, tone: 'danger' },
};
export function RiskChip({ risk }: { risk: Risk }) {
  const t = useTranslations('logistics.risk');
  return <StateChip {...RISK[risk]} state={risk} label={t(risk)} data-testid="failure-risk" />;
}

const WORK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  QUEUED: { icon: Hourglass, tone: 'neutral' },
  IN_PROGRESS: { icon: Wrench, tone: 'info' },
  COMPLETED: { icon: CheckCircle2, tone: 'success' },
  CANCELLED: { icon: XCircle, tone: 'neutral' },
};
export function WorkStatusChip({ status }: { status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' }) {
  const t = useTranslations('logistics.workStatus');
  return (
    <StateChip
      {...(WORK[status] ?? { icon: CircleDashed, tone: 'neutral' })}
      state={status}
      label={t(status)}
      data-testid="work-status"
    />
  );
}

const ORDER: Record<string, { icon: LucideIcon; tone: Tone }> = {
  PLACED: { icon: CircleDashed, tone: 'neutral' },
  IN_DELIVERY: { icon: Truck, tone: 'info' },
  DELIVERED: { icon: PackageCheck, tone: 'success' },
  CANCELLED: { icon: XCircle, tone: 'neutral' },
};
export function OrderStatusChip({
  status,
}: {
  status: 'PLACED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED';
}) {
  const t = useTranslations('logistics.orderStatus');
  return (
    <StateChip
      {...(ORDER[status] ?? { icon: CircleDashed, tone: 'neutral' })}
      state={status}
      label={t(status)}
      data-testid="order-status"
    />
  );
}

export function StockChip({ low }: { low: boolean }) {
  const t = useTranslations('logistics.stock');
  return low ? (
    <StateChip icon={PackageX} tone="warning" state="LOW" label={t('low')} data-testid="stock-state" />
  ) : (
    <StateChip icon={PackageCheck} tone="success" state="OK" label={t('ok')} data-testid="stock-state" />
  );
}

/** Locked feature: never hidden, always says which level opens it. */
export function LockedFeature({ title, level }: { title: string; level: number }) {
  const tc = useTranslations('common');
  return (
    <div data-testid="feature-locked">
      <EmptyState
        icon={<Lock className="size-5" />}
        title={title}
        description={tc('requiresLevel', { level })}
      />
    </div>
  );
}
