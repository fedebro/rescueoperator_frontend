import * as React from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Hammer,
  Handshake,
  Hourglass,
  Navigation,
  PackageCheck,
  Radio,
  RotateCcw,
  Siren,
  Truck,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';
const TONE: Record<Tone, string> = {
  neutral: 'text-muted border-border-strong bg-surface-3',
  info: 'text-info border-info/40 bg-info/10',
  success: 'text-success border-success/40 bg-success/10',
  warning: 'text-warning border-warning/40 bg-warning/10',
  danger: 'text-danger border-danger/40 bg-danger/10',
  brand: 'text-brand-hover border-brand/40 bg-brand-soft',
};

/** Every status has an icon AND a text label; colour is only reinforcement. */
export const STATUS_VISUALS: Record<string, { icon: LucideIcon; tone: Tone }> = {
  // incidents
  CREATED: { icon: CircleDashed, tone: 'neutral' },
  PENDING_RESPONSE: { icon: Siren, tone: 'danger' },
  RESPONDING: { icon: Navigation, tone: 'warning' },
  ON_SCENE: { icon: Hammer, tone: 'info' },
  RESOLVING: { icon: Hourglass, tone: 'info' },
  RESOLVED: { icon: CheckCircle2, tone: 'success' },
  FAILED: { icon: XCircle, tone: 'danger' },
  CANCELLED: { icon: Ban, tone: 'neutral' },
  EXPIRED: { icon: Clock, tone: 'neutral' },
  // vehicles
  IN_DELIVERY: { icon: PackageCheck, tone: 'neutral' },
  AVAILABLE: { icon: CheckCircle2, tone: 'success' },
  PREPARING: { icon: Radio, tone: 'warning' },
  EN_ROUTE: { icon: Navigation, tone: 'warning' },
  TRANSPORTING: { icon: Truck, tone: 'info' },
  AT_HOSPITAL: { icon: Hourglass, tone: 'info' },
  RETURNING: { icon: RotateCcw, tone: 'neutral' },
  RESTOCKING: { icon: PackageCheck, tone: 'neutral' },
  MAINTENANCE: { icon: Wrench, tone: 'neutral' },
  BROKEN_DOWN: { icon: AlertTriangle, tone: 'danger' },
  BEING_RECOVERED: { icon: Truck, tone: 'warning' },
  OUT_OF_SERVICE: { icon: Ban, tone: 'neutral' },
  // alliances (D-102): lent to an ally as part of an allied column — "In supporto alleato"
  ALLIED_SUPPORT: { icon: Handshake, tone: 'info' },
  // facilities
  OPERATIONAL: { icon: CheckCircle2, tone: 'success' },
  UNDER_CONSTRUCTION: { icon: Hammer, tone: 'warning' },
  OFFLINE: { icon: Ban, tone: 'neutral' },
};

export function StatusChip({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  const visual = STATUS_VISUALS[status] ?? { icon: CircleDashed, tone: 'neutral' as Tone };
  const Icon = visual.icon;
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap',
        TONE[visual.tone],
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}
