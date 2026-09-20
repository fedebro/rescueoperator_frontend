'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Clock, HeartPulse, LifeBuoy, Wrench, type LucideIcon } from 'lucide-react';
import type { VehicleDto } from '@/contracts';
import { logisticsApi } from '@/lib/api/depth';
import type { MaintenanceOverview } from '@/lib/api/assumed';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { qk } from '@/lib/api/query-keys';
import { track } from '@/lib/analytics';
import { formatClock } from '@/lib/format';
import { toast } from '@/stores/toast';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { ProgressBar, Stat } from '@/components/ui/misc';
import { useCareerId } from '@/features/game/hooks';
import type { MaintenanceStatus } from './api';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import { DueChip, HealthBandChip, RiskChip, WorkStatusChip, healthTone } from './visuals';

export type Quote = MaintenanceStatus['quotes'][number];
export type WorkOrderDto = MaintenanceOverview['orders'][number];

const QUOTE_ICON: Record<Quote['kind'], LucideIcon> = {
  SERVICE: Wrench,
  REPAIR: HeartPulse,
  FREE_EMERGENCY_REPAIR: LifeBuoy,
};

/** One-tap start of a service / repair; short of credits → the global "not enough credits" dialog. */
export function useStartWork(vehicle: Pick<VehicleDto, 'id' | 'callSign'>, onStarted?: () => void) {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const t = useTranslations('logistics.workshop');
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (quote: Quote) =>
      quote.kind === 'SERVICE'
        ? logisticsApi.startMaintenance(careerId, vehicle.id, 'SERVICE')
        : logisticsApi.startRepair(careerId, vehicle.id, quote.kind),
    onSuccess: (_order, quote) => {
      track('maintenance_started', { kind: quote.kind });
      toast({ tone: 'success', title: t('started', { callSign: vehicle.callSign }) });
      void qc.invalidateQueries({ queryKey: qk.maintenance(careerId) });
      // Hook-level callback: the quote list may already be unmounted by the realtime update when the response lands.
      onStarted?.();
    },
    onError: (e, quote) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS')) requestCredits(quote.cost);
      else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
}

/** Quotes SERVICE / REPAIR / FREE_EMERGENCY_REPAIR with cost, duration and the health they restore to. */
export function QuoteList({
  vehicle,
  quotes,
  onStarted,
}: {
  vehicle: Pick<VehicleDto, 'id' | 'callSign'>;
  quotes: Quote[];
  onStarted?: () => void;
}) {
  const t = useTranslations('logistics.workshop');
  const tc = useTranslations('common');
  const start = useStartWork(vehicle, onStarted);
  if (quotes.length === 0) return <p className="text-subtle text-xs">{t('noQuotes')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {quotes.map((q) => {
        const Icon = QUOTE_ICON[q.kind];
        return (
          <li
            key={q.kind}
            className="border-border bg-surface-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-3"
            data-testid="maintenance-quote"
            data-kind={q.kind}
          >
            <Icon className="text-muted size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t(`kind.${q.kind}`)}</p>
              <p className="text-muted flex flex-wrap items-center gap-x-2 text-xs">
                <span className="tabular inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden />
                  {formatClock(q.durationSeconds)}
                </span>
                <span>{t('restoresTo', { health: Math.round(q.restoresTo) })}</span>
              </p>
            </div>
            <Button
              size="md"
              variant={q.kind === 'FREE_EMERGENCY_REPAIR' ? 'secondary' : 'primary'}
              loading={start.isPending && start.variables?.kind === q.kind}
              disabled={start.isPending}
              onClick={() => start.mutate(q)}
              data-testid={`start-${q.kind}`}
            >
              {t(`start.${q.kind}`)}
              {q.cost === '0' ? (
                <span className="text-xs font-bold uppercase">{t('free')}</span>
              ) : (
                <CreditAmount value={q.cost} label={tc('credits')} tone="plain" className="text-white" />
              )}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** Health gauge + band + wear / km / missions + due state + failure risk. */
export function CareSummary({ status }: { status: MaintenanceStatus }) {
  const t = useTranslations('logistics.workshop');
  const locale = useLocale();
  const number = React.useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          className="tabular text-2xl leading-none font-bold"
          data-testid="health-value"
          aria-label={t('healthValue', { health: Math.round(status.health) })}
        >
          {Math.round(status.health)}%
        </span>
        <div className="min-w-0 flex-1">
          <ProgressBar value={status.health / 100} label={t('health')} tone={healthTone(status.healthBand)} />
        </div>
        <HealthBandChip band={status.healthBand} />
      </div>
      <div className="flex flex-wrap gap-2">
        <DueChip due={status.due} />
        <RiskChip risk={status.failureRisk} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t('wear')} value={`${Math.round(status.wear)}%`} />
        <Stat label={t('km')} value={t('kmValue', { km: number.format(status.km) })} />
        <Stat label={t('missions')} value={status.missions} />
      </div>
    </div>
  );
}

/** Running / queued workshop order with its countdown and speed-up. */
export function WorkOrderRow({ order, label }: { order: WorkOrderDto; label?: string }) {
  const t = useTranslations('logistics.workshop');
  return (
    <div
      className="border-border bg-surface-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-3"
      data-testid="work-order"
      data-kind={order.kind}
      data-work-status={order.status}
    >
      <div className="min-w-0 flex-1">
        {label ? <p className="truncate text-sm font-semibold">{label}</p> : null}
        <p className={label ? 'text-muted text-xs' : 'text-sm font-semibold'}>{t(`kind.${order.kind}`)}</p>
      </div>
      <WorkStatusChip status={order.status} />
      {order.status === 'IN_PROGRESS' && order.endsAt ? (
        <span className="flex items-center gap-2">
          <Countdown to={order.endsAt} doneLabel={t('finishing')} className="text-sm" />
          <SpeedupButton target="MAINTENANCE" targetId={order.id} endsAt={order.endsAt} size="sm" />
        </span>
      ) : order.status === 'QUEUED' ? (
        <span className="text-subtle text-xs">{t('waitingSlot')}</span>
      ) : null}
    </div>
  );
}
