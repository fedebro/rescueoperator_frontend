'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowRightLeft, Ban, CheckCircle2, Hammer, MapPin } from 'lucide-react';
import type { FacilityDto, VehicleDto } from '@/contracts';
import { facilitiesApi } from '@/lib/api/depth';
import { useErrorMessage } from '@/lib/api/error-message';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { FamilyBadge } from '@/design/icons';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useCareerId, usePatchSnapshot, useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';

export type TransferState = 'OK' | 'CURRENT' | 'INCOMPATIBLE' | 'NOT_OPERATIONAL' | 'FULL';
export interface TransferTarget {
  facility: FacilityDto;
  state: TransferState;
  free: number;
}

/** Every facility as a transfer target with the reason when it cannot take the vehicle (valid ones first). */
export function transferTargets(
  vehicle: Pick<VehicleDto, 'facilityId'>,
  type: { compatibleFacilityTypes: string[]; domain: string; capacityPoints: number } | undefined,
  facilities: readonly FacilityDto[],
): TransferTarget[] {
  return facilities
    .map((facility) => {
      const c = facility.capacities.find((x) => x.domain === type?.domain);
      const free = c ? c.total - c.used : 0;
      const state: TransferState =
        facility.id === vehicle.facilityId
          ? 'CURRENT'
          : !type || !type.compatibleFacilityTypes.includes(facility.typeCode)
            ? 'INCOMPATIBLE'
            : facility.status !== 'OPERATIONAL'
              ? 'NOT_OPERATIONAL'
              : free < type.capacityPoints
                ? 'FULL'
                : 'OK';
      return { facility, state, free };
    })
    .sort((a, b) => Number(b.state === 'OK') - Number(a.state === 'OK'));
}

const STATE_ICON = {
  OK: CheckCircle2,
  CURRENT: MapPin,
  INCOMPATIBLE: Ban,
  NOT_OPERATIONAL: Hammer,
  FULL: Ban,
} as const;

/** Re-base an AVAILABLE vehicle to another compatible facility with free capacity in its domain. */
export function TransferVehicleButton({
  vehicle,
  compact,
  className,
}: {
  vehicle: VehicleDto;
  /** Icon-only trigger (fleet table rows / cards). */
  compact?: boolean;
  className?: string;
}) {
  const careerId = useCareerId();
  const t = useTranslations('facilities.transfer');
  const td = useTranslations('game.facility');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const patch = usePatchSnapshot();
  const { facilities } = useSnapshot();
  const type = useVehicleTypeLookup()(vehicle.typeCode);
  const [open, setOpen] = React.useState(false);
  const transfer = useMutation({
    mutationFn: (facilityId: string) => facilitiesApi.transferVehicle(careerId, vehicle.id, facilityId),
    onSuccess: (result, facilityId) => {
      track('vehicle_transferred', { type: vehicle.typeCode });
      patch((s) => ({
        ...s,
        vehicles: s.vehicles.map((v) => (v.id === result.vehicle.id ? result.vehicle : v)),
        facilities: s.facilities.map((f) => result.facilities.find((x) => x.id === f.id) ?? f),
      }));
      toast({
        tone: 'success',
        title: t('done', {
          callSign: vehicle.callSign,
          facility: facilities.find((f) => f.id === facilityId)?.name ?? '',
        }),
        description: t('doneHint'),
      });
      setOpen(false);
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  if (facilities.length < 2) return null;
  const available = vehicle.status === 'AVAILABLE';
  const targets = transferTargets(vehicle, type, facilities);
  const trigger = compact ? (
    <IconButton
      label={t('actionFor', { callSign: vehicle.callSign })}
      size="sm"
      variant="outline"
      disabled={!available}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(true);
      }}
      data-testid="transfer-vehicle"
    >
      <ArrowRightLeft className="size-4" aria-hidden />
    </IconButton>
  ) : (
    <Button
      variant="secondary"
      disabled={!available}
      className={cn('w-full', className)}
      onClick={() => setOpen(true)}
      data-testid="transfer-vehicle"
    >
      <ArrowRightLeft className="size-4" aria-hidden />
      {t('action')}
    </Button>
  );
  return (
    <>
      {trigger}
      {!available && !compact ? <p className="text-subtle -mt-3 text-xs">{t('onlyAvailable')}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t('title', { callSign: vehicle.callSign })}
          description={t('subtitle', {
            points: type?.capacityPoints ?? 0,
            domain: type ? td(`domain.${type.domain}`) : '',
          })}
          closeLabel={tc('close')}
          data-testid="transfer-dialog"
        >
          <ul className="flex flex-col gap-2">
            {targets.map(({ facility, state, free }) => {
              const Icon = STATE_ICON[state];
              return (
                <li key={facility.id}>
                  <button
                    type="button"
                    disabled={state !== 'OK' || transfer.isPending}
                    onClick={() => transfer.mutate(facility.id)}
                    className={cn(
                      'border-border bg-surface-2 flex w-full items-center gap-3 rounded-md border p-3 text-left',
                      state === 'OK' ? 'hover:bg-surface-3' : 'opacity-60',
                    )}
                    data-testid="transfer-target"
                    data-state={state}
                  >
                    <FamilyBadge family={facility.family} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{facility.name}</span>
                      <span className="text-muted flex items-center gap-1 text-xs">
                        <Icon className="size-3 shrink-0" aria-hidden />
                        {state === 'OK' ? t('state.OK', { free }) : t(`state.${state}`)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
