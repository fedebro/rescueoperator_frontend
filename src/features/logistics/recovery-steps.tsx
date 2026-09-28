'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, CheckCircle2, Truck, Wrench, type LucideIcon } from 'lucide-react';
import type { VehicleDto } from '@/contracts';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { Countdown, Eta } from '@/components/ui/countdown';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import type { WorkOrderDto } from './maintenance';

export type RecoveryStep = 'BROKEN_DOWN' | 'BEING_RECOVERED' | 'REPAIR' | 'AVAILABLE';
const STEPS: { key: RecoveryStep; icon: LucideIcon }[] = [
  { key: 'BROKEN_DOWN', icon: AlertTriangle },
  { key: 'BEING_RECOVERED', icon: Truck },
  { key: 'REPAIR', icon: Wrench },
  { key: 'AVAILABLE', icon: CheckCircle2 },
];

/** Which step of "breakdown → recovery → repair → available" the vehicle is in (null = not in that story). */
export function recoveryStepOf(
  vehicle: Pick<VehicleDto, 'status'>,
  order: Pick<WorkOrderDto, 'kind'> | null | undefined,
): RecoveryStep | null {
  if (vehicle.status === 'BROKEN_DOWN') return 'BROKEN_DOWN';
  if (vehicle.status === 'BEING_RECOVERED') return 'BEING_RECOVERED';
  if (vehicle.status === 'MAINTENANCE' && order && order.kind !== 'SERVICE') return 'REPAIR';
  return null;
}

/**
 * Breakdown and AUTOMATIC recovery as a step indicator: the player never has to do anything, but always sees where the
 * vehicle is and how long each step takes. Towing is an operational time: no speed-up. The repair is managerial: speed-up.
 */
export function RecoverySteps({ vehicle, order }: { vehicle: VehicleDto; order: WorkOrderDto | null }) {
  const t = useTranslations('logistics.recovery');
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const current = recoveryStepOf(vehicle, order);
  if (!current) return null;
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <div
      className="border-warning/40 bg-warning/5 rounded-md border p-3"
      data-testid="recovery-steps"
      data-step={current}
    >
      <p className="text-sm font-semibold">{t(`headline.${current}`)}</p>
      <p className="text-muted mt-0.5 text-xs">{t('automatic')}</p>
      <ol className="mt-3 flex flex-col gap-2.5" aria-label={t('title')}>
        {STEPS.map((step, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'pending';
          const Icon = state === 'done' ? Check : step.icon;
          return (
            <li
              key={step.key}
              className="flex items-center gap-2.5"
              aria-current={state === 'current' ? 'step' : undefined}
              data-step-state={state}
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border-2',
                  state === 'done' && 'border-success text-success',
                  state === 'current' && 'border-warning text-warning',
                  state === 'current' && !reducedMotion && 'motion-safe:animate-pulse',
                  state === 'pending' && 'border-border-strong text-subtle',
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', state === 'pending' ? 'text-subtle' : 'font-semibold')}>
                  {t(`step.${step.key}`)}
                </span>
                <span className="text-muted block text-xs">{t(`state.${state}`)}</span>
              </span>
              {state === 'current' && step.key === 'BROKEN_DOWN' ? (
                <Eta
                  arriveAt={vehicle.busyUntil}
                  label={t('towEta')}
                  doneLabel={t('arriving')}
                  className="text-sm"
                />
              ) : null}
              {state === 'current' && step.key === 'BEING_RECOVERED' ? (
                <Eta
                  arriveAt={vehicle.movement?.arriveAt ?? vehicle.busyUntil}
                  label={t('homeEta')}
                  doneLabel={t('arriving')}
                  className="text-sm"
                />
              ) : null}
              {state === 'current' && step.key === 'REPAIR' && order ? (
                order.status === 'IN_PROGRESS' && order.endsAt ? (
                  <span className="flex items-center gap-2">
                    <Countdown to={order.endsAt} doneLabel={t('arriving')} className="text-sm" />
                    <SpeedupButton target="MAINTENANCE" targetId={order.id} endsAt={order.endsAt} size="sm" />
                  </span>
                ) : (
                  <span className="text-subtle text-xs">{t('queued')}</span>
                )
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
