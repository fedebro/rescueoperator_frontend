'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Ban, BedDouble, CheckCircle2, Crown, Hammer, MapPin, UserPlus } from 'lucide-react';
import type { FacilityDto, PersonnelDto, VehicleDto } from '@/contracts';
import { personnelApi } from '@/lib/api/depth';
import { isApiError } from '@/lib/api/errors';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { useFixItToast } from '@/features/facilities/error-fix';
import { transferTargets } from '@/features/facilities/transfer-targets';
import { useCareerId, usePatchSnapshot, useSnapshot, useVehicleTypeLookup } from '@/features/game/hooks';
import { FatigueBandLabel } from './fatigue-gauge';
import { useCommandError, useInvalidatePersonnel, usePersonnel, useTeamProposal, type Team } from './queries';

/** Operators who can leave on a trip right now (the backend's rule: AVAILABLE or ASSIGNED). */
export const canTravel = (p: Pick<PersonnelDto, 'status'>): boolean =>
  p.status === 'AVAILABLE' || p.status === 'ASSIGNED';

const detailsOf = (error: unknown): { reason?: string; domain?: string } | null =>
  isApiError(error) && error.details && typeof error.details === 'object'
    ? (error.details as { reason?: string; domain?: string })
    : null;

/**
 * The refusals of the team commands, said plainly: the reason first (`details.reason` of the backend), then the beds of the
 * destination, then whatever the vehicle transfer says (no room, wrong kind of facility…) with its way to fix it.
 */
export function useTeamError(): (error: unknown, context?: { facilityId?: string; family?: string }) => void {
  const t = useTranslations('personnel.teams.errors');
  const onError = useCommandError();
  const fixItToast = useFixItToast();
  return React.useCallback(
    (error, context) => {
      const details = detailsOf(error);
      const reason =
        details?.reason ??
        (isApiError(error, 'CAPACITY_EXCEEDED') && details?.domain === 'PERSONNEL' ? 'NO_BEDS' : undefined);
      if (reason && t.has(reason as never)) {
        toast({ tone: 'danger', title: t(reason as never) });
        return;
      }
      if (isApiError(error, 'CREW_INSUFFICIENT')) {
        toast({ tone: 'danger', title: t('NO_FREE_OPERATORS') });
        return;
      }
      if (isApiError(error, 'CAPACITY_EXCEEDED') || isApiError(error, 'NEEDS_NAUTICAL_BASE')) {
        fixItToast(error, context);
        return;
      }
      onError(error);
    },
    [t, onError, fixItToast],
  );
}

/* ───────────── form the team of a vehicle ───────────── */

/**
 * The guided path: the game proposes the crew of a vehicle (free operators of its facility, the same rules as a dispatch),
 * the player confirms with one tap and can change anything afterwards. Opens while `vehicle` is set.
 */
export function FormTeamDialog({ vehicle, onClose }: { vehicle: VehicleDto | null; onClose: () => void }) {
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const careerId = useCareerId();
  const invalidate = useInvalidatePersonnel();
  const onError = useTeamError();
  const { facilities, vehicles } = useSnapshot();
  const people = usePersonnel().data ?? [];
  const proposal = useTeamProposal(vehicle?.id ?? null);
  const [draft, setDraft] = React.useState<string | null>(null);
  const defaultName = vehicle ? t('defaultName', { callSign: vehicle.callSign }) : '';
  const teamName = (draft ?? defaultName).trim();

  const form = useMutation({
    mutationFn: () =>
      personnelApi.formTeam(careerId, {
        vehicleId: vehicle!.id,
        name: teamName.length >= 2 ? teamName : undefined,
      }),
    onSuccess: (team) => {
      track('team_formed', { members: team.memberIds.length });
      toast({ tone: 'success', title: t('formed', { name: team.name, count: team.memberIds.length }) });
      void invalidate();
      setDraft(null);
      onClose();
    },
    onError: (e) => onError(e),
  });

  const data = proposal.data;
  const members = (data?.memberIds ?? []).flatMap((id) => people.find((p) => p.id === id) ?? []);
  const facility = facilities.find((f) => f.id === vehicle?.facilityId);
  // The other vehicles of this facility and service that still need an automatic crew.
  const needy = vehicles
    .filter(
      (v) =>
        v.id !== vehicle?.id &&
        v.facilityId === vehicle?.facilityId &&
        v.family === vehicle?.family &&
        v.crew.min > (data?.remainingFree ?? 0),
    )
    .filter(() => data !== undefined && data.teamId === null);
  const worst = needy.reduce<VehicleDto | null>(
    (a, v) => (a === null || v.crew.min > a.crew.min ? v : a),
    null,
  );
  const empty = data !== undefined && data.memberIds.length === 0;

  return (
    <Dialog open={vehicle !== null} onOpenChange={(open) => !open && onClose()}>
      {vehicle ? (
        <DialogContent
          title={t('formTitle', { callSign: vehicle.callSign })}
          description={t('formHint')}
          closeLabel={tc('close')}
          data-testid="form-team-dialog"
        >
          {proposal.isLoading || !data ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="flex flex-col gap-4">
              {empty ? (
                <div
                  className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3"
                  data-testid="no-free-operators"
                >
                  <p className="text-sm font-semibold">{t('noFreeTitle')}</p>
                  <p className="text-muted text-sm">{t('noFreeHint', { facility: facility?.name ?? '—' })}</p>
                  <Button asChild size="sm" variant="secondary" className="self-start">
                    <Link href="/game/personnel?tab=recruitment">
                      <UserPlus className="size-4" aria-hidden />
                      {t('goHire')}
                    </Link>
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold" data-testid="proposal-summary">
                    {t('proposalSummary', { count: members.length, optimal: data.optimal, min: data.min })}
                  </p>
                  <ul className="flex flex-col gap-1.5" data-testid="proposal-members">
                    {members.map((p) => (
                      <li
                        key={p.id}
                        className="bg-surface-2 border-border flex items-center gap-2 rounded-md border p-2 text-sm"
                      >
                        {data.leaderId === p.id ? (
                          <Crown className="text-credits size-3.5 shrink-0" aria-label={t('leader')} />
                        ) : (
                          <span className="size-3.5 shrink-0" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {p.firstName} {p.lastName}
                          <span className="text-muted"> · {name('role', p.roleCode)}</span>
                        </span>
                        <FatigueBandLabel band={p.fatigue.band} />
                      </li>
                    ))}
                  </ul>
                  {members.length < data.min ? <Note>{t('proposalBelowMin', { min: data.min })}</Note> : null}
                  {data.missingQualifications.map((code) => (
                    <Note key={code}>
                      {t('proposalMissingQualification', { qualification: name('qualification', code) })}
                    </Note>
                  ))}
                  {data.missingRoles.map((code) => (
                    <Note key={code}>{t('proposalMissingRole', { role: name('role', code) })}</Note>
                  ))}
                  {worst ? (
                    <Note testId="proposal-others">
                      {t('proposalOthers', {
                        left: data.remainingFree,
                        facility: facility?.name ?? '—',
                        callSign: worst.callSign,
                        min: worst.crew.min,
                      })}
                    </Note>
                  ) : null}
                  <Field label={t('name')} htmlFor="form-team-name">
                    <Input
                      id="form-team-name"
                      value={draft ?? defaultName}
                      onChange={(e) => setDraft(e.target.value)}
                      minLength={2}
                      maxLength={40}
                      className="text-base"
                    />
                  </Field>
                </>
              )}
              <DialogFooter className="mt-1">
                <Button variant="ghost" onClick={onClose}>
                  {tc('cancel')}
                </Button>
                <Button
                  onClick={() => form.mutate()}
                  loading={form.isPending}
                  disabled={empty || teamName.length < 2}
                  data-testid="confirm-form-team"
                >
                  {t('formConfirm')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Note({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p className="text-warning flex items-start gap-1.5 text-xs" data-testid={testId}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/* ───────────── dissolve ───────────── */

/** Dissolving is always allowed: it says what happens to the operators and the vehicle before the player confirms. */
export function DisbandTeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const invalidate = useInvalidatePersonnel();
  const onError = useTeamError();
  const { vehicles } = useSnapshot();
  const people = usePersonnel().data ?? [];
  const vehicle = vehicles.find((v) => v.id === team?.vehicleId);
  const onMission = people.filter((p) => team?.memberIds.includes(p.id) && p.status === 'ON_MISSION').length;
  const disband = useMutation({
    mutationFn: () => personnelApi.disbandTeam(careerId, team!.id),
    onSuccess: () => {
      track('team_disbanded');
      toast({ tone: 'success', title: t('disbanded', { name: team!.name }) });
      void invalidate();
      onClose();
    },
    onError: (e) => onError(e),
  });
  return (
    <Dialog open={team !== null} onOpenChange={(open) => !open && onClose()}>
      {team ? (
        <DialogContent
          title={t('disbandTitle', { name: team.name })}
          description={t('disbandHint')}
          closeLabel={tc('close')}
          data-testid="disband-dialog"
        >
          <ul className="text-muted flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>{t('disbandMembers', { count: team.memberIds.length })}</li>
            {vehicle ? <li>{t('disbandVehicle', { callSign: vehicle.callSign })}</li> : null}
            {onMission > 0 ? <li>{t('disbandOnMission', { count: onMission })}</li> : null}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => disband.mutate()}
              loading={disband.isPending}
              data-testid="confirm-disband"
            >
              {t('disbandConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/* ───────────── move to another facility ───────────── */

type TargetState = 'OK' | 'CURRENT' | 'INCOMPATIBLE' | 'NOT_OPERATIONAL' | 'FULL' | 'NO_BEDS';
const STATE_ICON = {
  OK: CheckCircle2,
  CURRENT: MapPin,
  INCOMPATIBLE: Ban,
  NOT_OPERATIONAL: Hammer,
  FULL: Ban,
  NO_BEDS: BedDouble,
} as const;

/**
 * Every facility as a destination for a team, with the reason when it cannot take it: the vehicle needs a compatible facility
 * with room in its domain, the travelling operators need free beds. Valid ones first.
 */
export function teamTargets(
  team: Pick<Team, 'facilityId'>,
  vehicle: VehicleDto | undefined,
  type: Parameters<typeof transferTargets>[1],
  facilities: readonly FacilityDto[],
  travellers: number,
): { facility: FacilityDto; state: TargetState; free: number }[] {
  const byVehicle = vehicle ? transferTargets(vehicle, type, facilities) : null;
  return facilities
    .map((facility) => {
      const beds = facility.capacities.find((c) => c.domain === 'PERSONNEL');
      const freeBeds = beds ? beds.total - beds.used : 0;
      const vehicleState = byVehicle?.find((x) => x.facility.id === facility.id);
      const state: TargetState =
        facility.id === team.facilityId
          ? 'CURRENT'
          : vehicleState && vehicleState.state !== 'OK'
            ? (vehicleState.state as TargetState)
            : facility.status !== 'OPERATIONAL'
              ? 'NOT_OPERATIONAL'
              : freeBeds < travellers
                ? 'NO_BEDS'
                : 'OK';
      return { facility, state, free: state === 'NO_BEDS' ? freeBeds : (vehicleState?.free ?? freeBeds) };
    })
    .sort((a, b) => Number(b.state === 'OK') - Number(a.state === 'OK'));
}

/** The team travels with its vehicle: one trip, one arrival. Whoever cannot leave now is named before the player decides. */
export function TransferTeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const t = useTranslations('personnel.teams.transfer');
  const tc = useTranslations('common');
  const careerId = useCareerId();
  const invalidate = useInvalidatePersonnel();
  const onError = useTeamError();
  const patch = usePatchSnapshot();
  const { facilities, vehicles } = useSnapshot();
  const lookup = useVehicleTypeLookup();
  const people = usePersonnel().data ?? [];
  const vehicle = vehicles.find((v) => v.id === team?.vehicleId);
  const members = people.filter((p) => team?.memberIds.includes(p.id));
  const travellers = members.filter(canTravel);
  const staying = members.filter((p) => !canTravel(p));
  const targets = team
    ? teamTargets(
        team,
        vehicle,
        vehicle ? lookup(vehicle.typeCode) : undefined,
        facilities,
        travellers.length,
      )
    : [];

  const move = useMutation({
    mutationFn: (facilityId: string) => personnelApi.transferTeam(careerId, team!.id, facilityId),
    onSuccess: (result, facilityId) => {
      track('team_transferred', { withVehicle: result.vehicle !== null });
      patch((s) => ({
        ...s,
        vehicles: result.vehicle
          ? s.vehicles.map((v) => (v.id === result.vehicle!.id ? result.vehicle! : v))
          : s.vehicles,
        facilities: s.facilities.map((f) => result.facilities.find((x) => x.id === f.id) ?? f),
      }));
      toast({
        tone: 'success',
        title: t('done', {
          name: team!.name,
          facility: facilities.find((f) => f.id === facilityId)?.name ?? '',
        }),
        description: t('doneHint'),
      });
      void invalidate();
      onClose();
    },
    onError: (e, facilityId) => onError(e, { facilityId, family: vehicle?.family }),
  });

  return (
    <Dialog open={team !== null} onOpenChange={(open) => !open && onClose()}>
      {team ? (
        <DialogContent
          title={t('title', { name: team.name })}
          description={vehicle ? t('withVehicle', { callSign: vehicle.callSign }) : t('alone')}
          closeLabel={tc('close')}
          data-testid="transfer-team-dialog"
        >
          {staying.length > 0 ? (
            <p className="text-warning mb-3 flex items-start gap-1.5 text-xs" data-testid="team-staying">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t('staying', {
                count: staying.length,
                names: staying.map((p) => `${p.firstName} ${p.lastName}`).join(', '),
              })}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {targets.map(({ facility, state, free }) => {
              const Icon = STATE_ICON[state];
              return (
                <li key={facility.id}>
                  <button
                    type="button"
                    disabled={state !== 'OK' || move.isPending}
                    onClick={() => move.mutate(facility.id)}
                    className={cn(
                      'border-border bg-surface-2 flex min-h-11 w-full items-center gap-3 rounded-md border p-3 text-left',
                      state === 'OK' ? 'hover:bg-surface-3' : 'opacity-60',
                    )}
                    data-testid="team-transfer-target"
                    data-state={state}
                  >
                    <FamilyBadge family={facility.family} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold" title={facility.name}>
                        {facility.name}
                      </span>
                      <span className="text-muted flex items-center gap-1 text-xs">
                        <Icon className="size-3 shrink-0" aria-hidden />
                        {t(`state.${state}`, { free, count: travellers.length })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
