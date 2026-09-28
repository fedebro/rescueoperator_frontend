'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Fuel, Plane } from 'lucide-react';
import type { DispatchOptionsResult } from '@/lib/api/types';
import { formatAmount, formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { autonomyFlagOf, flagTone, reloadBeforeDeparture } from './autonomy';

type Option = DispatchOptionsResult['options'][number];
type FuelStop = NonNullable<NonNullable<Option['chain']>['fuelStop']>;

/**
 * The one discreet autonomy flag of a dispatch option (study §3.4): "Ultima missione prima del rifornimento" (warning),
 * "Riserva" / "Autonomia insufficiente" (danger — those vehicles are never recommended, still selectable). The long
 * explanation is in the title and for screen readers.
 */
export function DispatchAutonomyFlag({ option }: { option: Option }) {
  const t = useTranslations('autonomy');
  const flag = autonomyFlagOf(option);
  if (!flag) return null;
  const tone = flagTone(flag);
  // An aircraft counts minutes of flight: its "not enough" means there + back + a few minutes over the scene.
  const flight = isFlight(option);
  const help =
    flight && flag !== 'LAST_MISSION_BEFORE_RESUPPLY' ? t(`flagHelpFlight.${flag}`) : t(`flagHelp.${flag}`);
  const Icon = flight ? Plane : Fuel;
  return (
    <Badge
      tone={tone === 'danger' ? 'danger' : 'warning'}
      title={help}
      data-testid="dispatch-autonomy-flag"
      data-flag={flag}
    >
      <Icon className="size-3" aria-hidden />
      {t(`flag.${flag}`)}
      <span className="sr-only">: {help}</span>
    </Badge>
  );
}

/** The option is an aircraft's: its autonomy is in minutes of flight (phase 3, air-endurance.md). */
export const isFlight = (option: Pick<Option, 'autonomy'>): boolean => option.autonomy?.fuelUnit === 'MIN';

/**
 * Flight endurance of an aircraft option (air-endurance §1): the minutes this trip needs (there + back + a few minutes over
 * the scene + the reserve) against those on board, and — the line that matters — how long it can stay over the scene before
 * it turns back to refuel ("può restare sul posto circa N min"). Nothing for a ground vehicle.
 */
export function DispatchFlightNote({ option, className }: { option: Option; className?: string }) {
  const t = useTranslations('autonomy.flightNote');
  const a = option.autonomy;
  if (!a || !isFlight(option)) return null;
  // Grounded for this call by nature (it does not ask for an aircraft, or not this kind of place): minutes of flight would
  // only be noise under the reason line.
  if (option.blockedReason === 'AIR_SUPPORT_NOT_NEEDED' || option.blockedReason === 'VEHICLE_DOMAIN_MISMATCH')
    return null;
  const onScene = a.onSceneMinutes ?? null;
  const blocked = option.blockedReason === 'ENDURANCE_INSUFFICIENT';
  return (
    <div
      className={cn('flex flex-col gap-0.5 text-xs', className)}
      data-testid="dispatch-flight-note"
      data-on-scene={onScene ?? ''}
    >
      {a.fuelNeededKm !== null && a.fuelKm !== null ? (
        <p className="text-muted flex items-start gap-1">
          <Plane className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('needs', { needed: Math.ceil(a.fuelNeededKm), onBoard: Math.floor(a.fuelKm) })}
        </p>
      ) : null}
      {!blocked && onScene !== null ? (
        <p
          className={cn('pl-[18px] font-semibold', onScene < 3 ? 'text-warning' : 'text-info')}
          data-testid="dispatch-on-scene-minutes"
        >
          {t('onScene', { count: Math.max(0, Math.floor(onScene)) })}
        </p>
      ) : null}
    </div>
  );
}

/** "Rifornisce prima di partire: +0:35, già nel tempo d'arrivo" — the reload before departure is already in the ETA. */
export function DispatchReloadNote({ option, className }: { option: Option; className?: string }) {
  const t = useTranslations('autonomy');
  const seconds = reloadBeforeDeparture(option);
  if (seconds === null) return null;
  return (
    <p
      className={cn('text-info flex items-start gap-1 text-xs', className)}
      data-testid="dispatch-reload-note"
      data-seconds={seconds}
    >
      <Fuel className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {t('reloadBeforeDeparture', { time: formatClock(seconds) })}
    </p>
  );
}

/** A redirect in reserve goes through a filling station first (phase 2): the extra time and the small premium. */
export function ChainFuelStop({ fuelStop, className }: { fuelStop: FuelStop; className?: string }) {
  const t = useTranslations('autonomy');
  const locale = useLocale();
  return (
    <span
      className={cn('text-warning flex items-center gap-1 text-right text-xs', className)}
      data-testid="chain-fuel-stop"
    >
      <Fuel className="size-3 shrink-0" aria-hidden />
      {t('fuelStop', {
        time: formatClock(fuelStop.extraSeconds),
        credits: formatAmount(fuelStop.premium, locale),
      })}
    </span>
  );
}
