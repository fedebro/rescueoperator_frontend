'use client';
import { useTranslations } from 'next-intl';
import { CheckCircle2, CircleDashed, CreditCard, RotateCcw, XCircle, type LucideIcon } from 'lucide-react';
import type { z } from 'zod';
import type { PurchaseDto } from '@/contracts';
import { cn } from '@/lib/utils';

export type PurchaseStatus = z.infer<typeof PurchaseDto>['status'];

const VISUAL: Record<PurchaseStatus, { icon: LucideIcon; className: string }> = {
  CREATED: { icon: CircleDashed, className: 'text-muted border-border-strong bg-surface-3' },
  PAID: { icon: CreditCard, className: 'text-info border-info/40 bg-info/10' },
  CREDITED: { icon: CheckCircle2, className: 'text-success border-success/40 bg-success/10' },
  FAILED: { icon: XCircle, className: 'text-danger border-danger/40 bg-danger/10' },
  REFUNDED: { icon: RotateCcw, className: 'text-warning border-warning/40 bg-warning/10' },
};

/** Purchase state: icon + label (colour only reinforces). */
export function PurchaseStatusChip({ status }: { status: PurchaseStatus }) {
  const t = useTranslations('monetization.purchaseStatus');
  const { icon: Icon, className } = VISUAL[status];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(status)}
    </span>
  );
}
