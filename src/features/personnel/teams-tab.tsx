'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRightLeft, Crown, Pencil, Trash2, Users, UsersRound } from 'lucide-react';
import type { PersonnelDto, VehicleDto } from '@/contracts';
import { personnelApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { useServerNow } from '@/hooks/use-server-now';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Card, ProgressBar, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/switch';
import { WarningNextAction } from '@/features/coaching/warning-next-action';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { FatigueBandLabel } from './fatigue-gauge';
import { bandOf, fatigueAt } from './fatigue';
import { LockedFeature } from './locked-feature';
import { PersonnelStatusChip, TeamStatusChip } from './status';
import { DisbandTeamDialog, FormTeamDialog, TransferTeamDialog, useTeamError } from './team-actions';
import { useFeature, useInvalidatePersonnel, usePersonnel, useTeams, type Team } from './queries';

export const TEAM_MAX_MEMBERS = 12;
const NONE = 'NONE';

/** `CODE` or `CODE:ARG` (see the contract notes): ARG is a qualification code resolved from the catalog. */
export function useTeamWarning(): (warning: string) => string {
  const t = useTranslations('personnel.teams.warning');
  const name = useCatalogName();
  return React.useCallback(
    (warning) => {
      const [code = '', arg = ''] = warning.split(':');
      if (code === 'MISSING_QUALIFICATION')
        return t('MISSING_QUALIFICATION', { qualification: name('qualification', arg) });
      return t.has(code as never) ? t(code as never) : warning;
    },
    [t, name],
  );
}

/**
 * Squadre. A team is the FIXED CREW of one vehicle: the screen starts from the vehicles — each one either has a team or shows
 * "Forma squadra" — and from the teams, with what can be done to each one (change members, move with the vehicle, dissolve).
 */
export function TeamsTab({
  onSelect,
  focusTeam,
}: {
  onSelect: (id: string) => void;
  focusTeam?: string | null;
}) {
  const t = useTranslations('personnel.teams');
  const teamsFeature = useFeature('TEAMS');
  const teams = useTeams(teamsFeature.unlocked);
  const people = usePersonnel().data ?? [];
  const { facilities, vehicles } = useSnapshot();
  const [forming, setForming] = React.useState<VehicleDto | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [disbanding, setDisbanding] = React.useState<Team | null>(null);
  const [transferring, setTransferring] = React.useState<Team | null>(null);

  if (!teamsFeature.unlocked && teamsFeature.requiredLevel !== null)
    return (
      <LockedFeature
        feature="TEAMS"
        requiredLevel={teamsFeature.requiredLevel}
        description={t('lockedHint')}
      />
    );
  if (!teams.data) return <Skeleton className="h-60" />;

  const editingTeam = teams.data.find((x) => x.id === editing) ?? null;
  const withTeam = new Set(teams.data.flatMap((x) => (x.vehicleId ? [x.vehicleId] : [])));
  const bare = vehicles.filter(
    (v) =>
      !withTeam.has(v.id) &&
      v.crew.optimal > 0 &&
      v.status !== 'OUT_OF_SERVICE' &&
      v.status !== 'ALLIED_SUPPORT',
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted text-sm" data-testid="teams-intro">
        {t('subtitle')}
      </p>

      {teams.data.length === 0 ? (
        // Compact on purpose: on a phone the vehicles below (the way to form a team) must stay on the first screen.
        <Card className="flex items-start gap-3" data-testid="teams-empty">
          <span
            className="bg-surface-3 text-subtle grid size-10 shrink-0 place-items-center rounded-full"
            aria-hidden
          >
            <UsersRound className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('emptyTitle')}</p>
            <p className="text-muted mt-0.5 text-sm">{t('emptyHint')}</p>
          </div>
        </Card>
      ) : (
        <section>
          <SectionTitle>{t('teamsTitle', { count: teams.data.length })}</SectionTitle>
          <ul className="grid gap-3 lg:grid-cols-2">
            {teams.data.map((team) => (
              <li key={team.id}>
                <TeamCard
                  team={team}
                  people={people}
                  vehicles={vehicles}
                  teams={teams.data}
                  focused={focusTeam === team.id}
                  onEdit={() => setEditing(team.id)}
                  onDisband={() => setDisbanding(team)}
                  onTransfer={() => setTransferring(team)}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {bare.length > 0 ? (
        <section data-testid="team-less-vehicles">
          <SectionTitle>{t('vehiclesTitle')}</SectionTitle>
          <ul className="flex flex-col gap-2">
            {bare.map((vehicle) => (
              <VehicleRow
                key={vehicle.id}
                vehicle={vehicle}
                facilityName={facilities.find((f) => f.id === vehicle.facilityId)?.name ?? '—'}
                onForm={() => setForming(vehicle)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <FormTeamDialog vehicle={forming} onClose={() => setForming(null)} />
      <DisbandTeamDialog team={disbanding} onClose={() => setDisbanding(null)} />
      <TransferTeamDialog team={transferring} onClose={() => setTransferring(null)} />
      <Dialog open={editingTeam !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editingTeam ? (
          <MembersForm
            key={editingTeam.id}
            team={editingTeam}
            people={people}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

/** A vehicle without a team: its crew is drawn automatically; one tap proposes a fixed one. */
function VehicleRow({
  vehicle,
  facilityName,
  onForm,
}: {
  vehicle: VehicleDto;
  facilityName: string;
  onForm: () => void;
}) {
  const t = useTranslations('personnel.teams');
  const name = useCatalogName();
  return (
    <li
      className="border-border bg-surface-2 flex items-center gap-3 rounded-md border p-3"
      data-testid="team-less-vehicle"
      data-vehicle-id={vehicle.id}
    >
      <FamilyBadge family={vehicle.family} size={32} />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-semibold"
          title={`${vehicle.callSign} · ${name('vehicle', vehicle.typeCode)}`}
        >
          {vehicle.callSign}
          <span className="text-muted font-normal"> · {name('vehicle', vehicle.typeCode)}</span>
        </p>
        <p className="text-muted truncate text-xs" title={facilityName}>
          {facilityName} · {t('autoCrew')}
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={onForm} data-testid="form-team">
        <Users className="size-4" aria-hidden />
        {t('formTeam')}
      </Button>
    </li>
  );
}

function TeamCard({
  team,
  people,
  vehicles,
  teams,
  focused,
  onEdit,
  onDisband,
  onTransfer,
  onSelect,
}: {
  team: Team;
  people: PersonnelDto[];
  vehicles: VehicleDto[];
  teams: Team[];
  focused: boolean;
  onEdit: () => void;
  onDisband: () => void;
  onTransfer: () => void;
  onSelect: (id: string) => void;
}) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const warningText = useTeamWarning();
  const { facilities } = useSnapshot();
  const invalidate = useInvalidatePersonnel();
  const onError = useTeamError();
  const now = useServerNow(5000);
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(team.name);
  const members = team.memberIds.flatMap((id) => people.find((p) => p.id === id) ?? []);
  const vehicle = vehicles.find((v) => v.id === team.vehicleId);
  const candidates = vehicles.filter((v) => v.facilityId === team.facilityId);
  const facilityName = facilities.find((f) => f.id === team.facilityId)?.name ?? '—';
  const travelling = !!team.transferUntil;

  const setVehicle = useMutation({
    mutationFn: (vehicleId: string | null) => personnelApi.setTeamVehicle(careerId, team.id, vehicleId),
    onSuccess: (_r, vehicleId) => {
      track('team_vehicle_assigned', { assigned: vehicleId !== null });
      void invalidate();
    },
    onError: (e) => onError(e),
  });
  const rename = useMutation({
    mutationFn: (value: string) => personnelApi.updateTeam(careerId, team.id, { name: value }),
    onSuccess: () => {
      setRenaming(false);
      void invalidate();
    },
    onError: (e) => onError(e),
  });
  const pct = Math.round(team.readiness * 100);

  return (
    <Card
      className={`flex h-full flex-col gap-3 ${focused ? 'ring-focus ring-2' : ''}`}
      data-testid="team-card"
      data-team-id={team.id}
      data-team-status={team.status}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold" title={team.name}>
            {team.name}
          </h3>
          <p className="text-muted truncate text-xs" title={facilityName}>
            {facilityName}
          </p>
        </div>
        <TeamStatusChip status={team.status} />
        <IconButton label={t('rename')} size="sm" onClick={() => setRenaming(true)}>
          <Pencil className="size-4" aria-hidden />
        </IconButton>
      </div>

      {travelling ? (
        <p
          className="bg-surface-2 border-border text-muted flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs"
          data-testid="team-travelling"
        >
          <ArrowRightLeft className="size-3.5 shrink-0" aria-hidden />
          {t('travelling')}
          <Countdown to={team.transferUntil} doneLabel={t('arriving')} className="text-fg font-semibold" />
        </p>
      ) : null}

      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-subtle font-semibold tracking-wide uppercase">{t('readiness')}</span>
          <span className="tabular font-semibold" data-testid="team-readiness">
            {pct}%
          </span>
        </div>
        <ProgressBar
          value={team.readiness}
          label={t('readiness')}
          tone={pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'brand'}
          className="mt-1"
        />
      </div>

      {team.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="team-warnings">
          {team.warnings.map((w) => (
            <li key={w} className="text-warning flex flex-wrap items-start gap-x-1.5 gap-y-0.5 text-xs">
              <span className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {warningText(w)}
              </span>
              <WarningNextAction
                code={w}
                className="text-skyline ml-5 inline-flex items-center gap-1 font-semibold hover:underline"
              />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-subtle text-xs font-semibold tracking-wide uppercase">{t('vehicle')}</span>
        <Select
          label={t('vehicle')}
          value={team.vehicleId ?? NONE}
          onValueChange={(v) => setVehicle.mutate(v === NONE ? null : v)}
          options={[
            { value: NONE, label: t('noVehicle') },
            ...candidates.map((v) => {
              const holder = teams.find((x) => x.vehicleId === v.id && x.id !== team.id);
              return {
                value: v.id,
                label: `${v.callSign} · ${name('vehicle', v.typeCode)}${holder ? ` — ${holder.name}` : ''}`,
                disabled: travelling,
              };
            }),
          ]}
        />
      </div>

      <div>
        <SectionTitle
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={onEdit}
              disabled={travelling}
              data-testid="edit-members"
            >
              <Users className="size-4" aria-hidden />
              {t('editMembers')}
            </Button>
          }
        >
          {t('members', { count: members.length, max: TEAM_MAX_MEMBERS })}
        </SectionTitle>
        <ul className="flex flex-col gap-1">
          {members.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              {team.leaderId === p.id ? (
                <span className="shrink-0" title={t('leader')}>
                  <Crown className="text-credits size-3.5" aria-label={t('leader')} />
                </span>
              ) : (
                <span className="size-3.5 shrink-0" aria-hidden />
              )}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left hover:underline"
                onClick={() => onSelect(p.id)}
                title={`${p.firstName} ${p.lastName} · ${name('role', p.roleCode)}`}
              >
                {p.firstName} {p.lastName}
                <span className="text-muted"> · {name('role', p.roleCode)}</span>
              </button>
              <FatigueBandLabel band={bandOf(fatigueAt(p.fatigue, now))} />
              <PersonnelStatusChip status={p.status} className="max-sm:hidden" />
            </li>
          ))}
        </ul>
      </div>

      <div className="border-border mt-auto flex flex-wrap gap-2 border-t pt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={onTransfer}
          disabled={travelling || (vehicle !== undefined && vehicle.status !== 'AVAILABLE')}
          data-testid="team-transfer"
        >
          <ArrowRightLeft className="size-4" aria-hidden />
          {vehicle ? t('transferWithVehicle') : t('transferAction')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDisband} data-testid="team-disband">
          <Trash2 className="size-4" aria-hidden />
          {t('disband')}
        </Button>
      </div>
      {vehicle !== undefined && vehicle.status !== 'AVAILABLE' && !travelling ? (
        <p className="text-subtle -mt-1 text-xs">
          {t('transferOnlyAvailable', { callSign: vehicle.callSign })}
        </p>
      ) : null}

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent title={t('rename')} closeLabel={tc('close')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate(draft.trim());
            }}
          >
            <Field label={t('name')} htmlFor={`rename-${team.id}`}>
              <Input
                id={`rename-${team.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                minLength={2}
                maxLength={40}
                required
                className="text-base"
              />
            </Field>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRenaming(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={rename.isPending} disabled={draft.trim().length < 2}>
                {tc('confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Members (max 12, operators of the team's facility) + leader, saved in one PUT. The leader is automatic unless chosen. */
function MembersForm({ team, people, onClose }: { team: Team; people: PersonnelDto[]; onClose: () => void }) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const invalidate = useInvalidatePersonnel();
  const onError = useTeamError();
  const [picked, setPicked] = React.useState<Set<string>>(new Set(team.memberIds));
  const [leaderId, setLeaderId] = React.useState<string | null>(team.leaderId);
  const pool = people.filter((p) => p.facilityId === team.facilityId && p.status !== 'TRANSFERRING');
  const save = useMutation({
    mutationFn: () =>
      personnelApi.setTeamMembers(careerId, team.id, {
        memberIds: [...picked],
        leaderId: leaderId && picked.has(leaderId) ? leaderId : null,
      }),
    onSuccess: (saved) => {
      track('team_members_set', { count: saved.memberIds.length });
      toast({ tone: 'success', title: t('saved') });
      void invalidate();
      onClose();
    },
    onError: (e) => onError(e),
  });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < TEAM_MAX_MEMBERS) next.add(id);
      return next;
    });
  const chosen = pool.filter((p) => picked.has(p.id));

  return (
    <DialogContent
      title={t('membersOf', { name: team.name })}
      description={t('membersHint', { max: TEAM_MAX_MEMBERS })}
      closeLabel={tc('close')}
    >
      <ul className="flex flex-col gap-1.5" data-testid="member-list">
        {pool.map((p) => {
          const id = `member-${p.id}`;
          const elsewhere = p.teamId !== null && p.teamId !== team.id;
          return (
            <li
              key={p.id}
              className="bg-surface-2 border-border flex items-center gap-2.5 rounded-md border p-2.5"
            >
              <Checkbox
                id={id}
                checked={picked.has(p.id)}
                onCheckedChange={() => toggle(p.id)}
                disabled={!picked.has(p.id) && picked.size >= TEAM_MAX_MEMBERS}
                aria-label={`${p.firstName} ${p.lastName}`}
              />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm">
                <span className="block truncate font-semibold" title={`${p.firstName} ${p.lastName}`}>
                  {p.firstName} {p.lastName}
                </span>
                <span className="text-muted block truncate text-xs" title={name('role', p.roleCode)}>
                  {name('role', p.roleCode)}
                </span>
              </label>
              {elsewhere ? <Badge tone="warning">{t('inOtherTeam')}</Badge> : null}
              <PersonnelStatusChip status={p.status} className="max-sm:hidden" />
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-muted text-xs font-semibold tracking-wide uppercase">{t('leader')}</span>
        <Select
          label={t('leader')}
          value={leaderId && picked.has(leaderId) ? leaderId : NONE}
          onValueChange={(v) => setLeaderId(v === NONE ? null : v)}
          options={[
            { value: NONE, label: t('leaderAuto') },
            ...chosen.map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName}` })),
          ]}
        />
      </div>
      <DialogFooter className="items-center">
        <span className="text-muted flex-1 text-sm" data-testid="member-count">
          {t('members', { count: picked.size, max: TEAM_MAX_MEMBERS })}
        </span>
        <Button variant="ghost" onClick={onClose}>
          {tc('cancel')}
        </Button>
        <Button onClick={() => save.mutate()} loading={save.isPending} data-testid="save-members">
          {t('save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
