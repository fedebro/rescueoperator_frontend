'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowRightLeft, Ban, BedDouble, CheckCircle2, Hammer, MapPin } from 'lucide-react';
import type { VehicleDto } from '@/contracts';
import { facilitiesApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { FamilyBadge } from '@/design/icons';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/switch';
import { useCareerId, usePatchSnapshot, useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import { useFeature, useInvalidatePersonnel, usePersonnel, useTeams } from '@/features/personnel/queries';
import { canTravel, teamTargets } from '@/features/personnel/team-actions';
import { useFixItToast } from './error-fix';
import { transferTargets } from './transfer-targets';

export { transferTargets, type TransferState, type TransferTarget } from './transfer-targets';

const STATE_ICON = {
  OK: CheckCircle2,
  CURRENT: MapPin,
  INCOMPATIBLE: Ban,
  NOT_OPERATIONAL: Hammer,
  FULL: Ban,
  NO_BEDS: BedDouble,
} as const;

/**
 * Re-base an AVAILABLE vehicle to another compatible facility with free capacity in its domain. The team bound to the vehicle
 * travels with it (one trip, one arrival) unless the player leaves it behind: then it stays, free, and the vehicle goes alone.
 */
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
  const tn = useTranslations('nautical.transfer');
  const tteam = useTranslations('personnel.teams');
  const td = useTranslations('game.facility');
  const tc = useTranslations('common');
  const fixItToast = useFixItToast();
  const patch = usePatchSnapshot();
  const invalidatePersonnel = useInvalidatePersonnel();
  const { facilities } = useSnapshot();
  const type = useVehicleTypeLookup()(vehicle.typeCode);
  const teams = useTeams(useFeature('TEAMS').unlocked).data;
  const people = usePersonnel().data;
  const team = teams?.find((x) => x.vehicleId === vehicle.id);
  const [open, setOpen] = React.useState(false);
  const [leaveTeam, setLeaveTeam] = React.useState(false);
  const withTeam = team !== undefined && !leaveTeam;
  const transfer = useMutation({
    mutationFn: (facilityId: string) =>
      facilitiesApi.transferVehicle(careerId, vehicle.id, facilityId, team ? withTeam : undefined),
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
      if (team) void invalidatePersonnel();
      setOpen(false);
    },
    // NEEDS_NAUTICAL_BASE, no free berth…: the refusal says where to go to fix it.
    onError: (e, facilityId) => fixItToast(e, { facilityId, family: vehicle.family }),
  });
  if (facilities.length < 2) return null;
  const boat = type?.domain === 'WATER';
  const available = vehicle.status === 'AVAILABLE';
  const travellers = (people ?? []).filter((p) => team?.memberIds.includes(p.id) && canTravel(p));
  // With its team the vehicle also needs beds at the destination for the operators that travel.
  const targets = withTeam
    ? teamTargets({ facilityId: vehicle.facilityId }, vehicle, type, facilities, travellers.length)
    : transferTargets(vehicle, type, facilities);
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
      {team ? tteam('transferWithTeam') : t('action')}
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
          {team ? (
            <div className="mb-3 flex flex-col gap-2" data-testid="transfer-team-option">
              <div className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  id={`bring-team-${vehicle.id}`}
                  checked={!leaveTeam}
                  onCheckedChange={(checked) => setLeaveTeam(checked !== true)}
                />
                <label htmlFor={`bring-team-${vehicle.id}`} className="min-w-0 flex-1 cursor-pointer">
                  {tteam('transferBringTeam', { name: team.name })}
                </label>
              </div>
              <p className="text-muted text-xs">
                {withTeam
                  ? tteam('transferTeamTogether', { count: travellers.length })
                  : tteam('transferTeamStays')}
              </p>
            </div>
          ) : null}
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
                      <span className="block truncate text-sm font-semibold" title={facility.name}>
                        {facility.name}
                      </span>
                      <span className="text-muted flex items-center gap-1 text-xs">
                        <Icon className="size-3 shrink-0" aria-hidden />
                        {state === 'OK'
                          ? t('state.OK', { free })
                          : state === 'INCOMPATIBLE' && boat
                            ? tn('boatOnly')
                            : state === 'NO_BEDS'
                              ? tteam('transfer.state.NO_BEDS', { free, count: travellers.length })
                              : t(`state.${state}`)}
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
