'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Building2, Crown, Pencil, Plus, Users } from 'lucide-react';
import type { PersonnelDto, VehicleDto } from '@/contracts';
import { personnelApi } from '@/lib/api/depth';
import { track } from '@/lib/analytics';
import { toast } from '@/stores/toast';
import { useServerNow } from '@/hooks/use-server-now';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Card, EmptyState, ProgressBar, SectionTitle, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/switch';
import { WarningNextAction } from '@/features/coaching/warning-next-action';
import { useCareerId, useSnapshot } from '@/features/game/hooks';
import { FatigueBandLabel } from './fatigue-gauge';
import { bandOf, fatigueAt } from './fatigue';
import { LockedFeature } from './locked-feature';
import { PersonnelStatusChip, TeamStatusChip } from './status';
import {
  useCommandError,
  useDepartments,
  useFeature,
  useInvalidatePersonnel,
  usePersonnel,
  useTeams,
  type Department,
  type Team,
} from './queries';

export const TEAM_MAX_MEMBERS = 12;
const NONE = 'NONE';

/** `CODE` or `CODE:ARG` (see the contract notes): ARG is a role / qualification code resolved from the catalog. */
export function useTeamWarning(): (warning: string) => string {
  const t = useTranslations('personnel.teams.warning');
  const name = useCatalogName();
  return React.useCallback(
    (warning) => {
      const [code = '', arg = ''] = warning.split(':');
      if (code === 'MISSING_ROLE') return t('MISSING_ROLE', { role: name('role', arg) });
      if (code === 'MISSING_QUALIFICATION')
        return t('MISSING_QUALIFICATION', { qualification: name('qualification', arg) });
      return t.has(code as never) ? t(code as never) : warning;
    },
    [t, name],
  );
}

export function TeamsTab({ onSelect }: { onSelect: (id: string) => void }) {
  const t = useTranslations('personnel.teams');
  const name = useCatalogName();
  const teamsFeature = useFeature('TEAMS');
  const departmentsFeature = useFeature('DEPARTMENTS');
  const teams = useTeams(teamsFeature.unlocked);
  const departments = useDepartments(departmentsFeature.unlocked);
  const people = usePersonnel().data ?? [];
  const { facilities, vehicles } = useSnapshot();
  const [creating, setCreating] = React.useState(false);
  const [creatingDepartment, setCreatingDepartment] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);

  if (!teamsFeature.unlocked && teamsFeature.requiredLevel !== null)
    return (
      <div className="flex flex-col gap-3">
        <LockedFeature
          feature="TEAMS"
          requiredLevel={teamsFeature.requiredLevel}
          description={t('lockedHint')}
        />
        {departmentsFeature.requiredLevel !== null ? (
          <LockedFeature
            feature="DEPARTMENTS"
            requiredLevel={departmentsFeature.requiredLevel}
            description={t('departmentsLockedHint')}
          />
        ) : null}
      </div>
    );
  if (!teams.data) return <Skeleton className="h-60" />;

  const editingTeam = teams.data.find((x) => x.id === editing) ?? null;
  const groups: { key: string; department: Department | null; teams: Team[] }[] = [
    ...(departments.data ?? []).map((d) => ({
      key: d.id,
      department: d,
      teams: teams.data.filter((x) => x.departmentId === d.id),
    })),
    { key: NONE, department: null, teams: teams.data.filter((x) => !x.departmentId) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-sm">{t('subtitle')}</p>
        <div className="flex gap-2">
          {departmentsFeature.unlocked ? (
            <Button variant="secondary" onClick={() => setCreatingDepartment(true)}>
              <Building2 className="size-4" aria-hidden />
              {t('newDepartment')}
            </Button>
          ) : null}
          <Button onClick={() => setCreating(true)} data-testid="new-team">
            <Plus className="size-4" aria-hidden />
            {t('newTeam')}
          </Button>
        </div>
      </div>

      {teams.data.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={t('emptyTitle')}
          description={t('emptyHint')}
        />
      ) : (
        groups
          .filter((g) => g.department !== null || g.teams.length > 0)
          .map((g) => (
            <section key={g.key}>
              {departmentsFeature.unlocked ? (
                <SectionTitle>
                  {g.department ? (
                    <span className="inline-flex items-center gap-1.5">
                      <FamilyBadge
                        family={g.department.family}
                        size={16}
                        title={name('family', g.department.family)}
                      />
                      {g.department.name} ·{' '}
                      {facilities.find((f) => f.id === g.department?.facilityId)?.name ?? '—'}
                    </span>
                  ) : (
                    t('noDepartment')
                  )}
                </SectionTitle>
              ) : null}
              {g.teams.length === 0 ? (
                <p className="text-muted text-sm">{t('emptyDepartment')}</p>
              ) : (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {g.teams.map((team) => (
                    <li key={team.id}>
                      <TeamCard
                        team={team}
                        people={people}
                        vehicles={vehicles}
                        departments={departmentsFeature.unlocked ? (departments.data ?? []) : null}
                        onEdit={() => setEditing(team.id)}
                        onSelect={onSelect}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
      )}

      {!departmentsFeature.unlocked && departmentsFeature.requiredLevel !== null ? (
        <LockedFeature
          feature="DEPARTMENTS"
          requiredLevel={departmentsFeature.requiredLevel}
          description={t('departmentsLockedHint')}
        />
      ) : null}

      <CreateTeamDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => setEditing(id)}
      />
      <CreateDepartmentDialog open={creatingDepartment} onClose={() => setCreatingDepartment(false)} />
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

function TeamCard({
  team,
  people,
  vehicles,
  departments,
  onEdit,
  onSelect,
}: {
  team: Team;
  people: PersonnelDto[];
  vehicles: VehicleDto[];
  departments: Department[] | null;
  onEdit: () => void;
  onSelect: (id: string) => void;
}) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const warningText = useTeamWarning();
  const { facilities } = useSnapshot();
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const now = useServerNow(5000);
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(team.name);
  const members = team.memberIds.flatMap((id) => people.find((p) => p.id === id) ?? []);
  const candidates = vehicles.filter((v) => v.facilityId === team.facilityId);
  const local = (departments ?? []).filter((d) => d.facilityId === team.facilityId);

  const setVehicle = useMutation({
    mutationFn: (vehicleId: string | null) => personnelApi.setTeamVehicle(careerId, team.id, vehicleId),
    onSuccess: (_r, vehicleId) => {
      track('team_vehicle_assigned', { assigned: vehicleId !== null });
      void invalidate();
    },
    onError: (e) => onError(e),
  });
  const update = useMutation({
    mutationFn: (body: { name?: string; departmentId?: string | null }) =>
      personnelApi.updateTeam(careerId, team.id, body),
    onSuccess: () => {
      setRenaming(false);
      void invalidate();
    },
    onError: (e) => onError(e),
  });
  const pct = Math.round(team.readiness * 100);

  return (
    <Card className="flex h-full flex-col gap-3" data-testid="team-card" data-team-status={team.status}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold" title={team.name}>
            {team.name}
          </h3>
          <p
            className="text-muted truncate text-xs"
            title={facilities.find((f) => f.id === team.facilityId)?.name ?? '—'}
          >
            {facilities.find((f) => f.id === team.facilityId)?.name ?? '—'}
          </p>
        </div>
        <TeamStatusChip status={team.status} />
        <IconButton label={t('rename')} size="sm" onClick={() => setRenaming(true)}>
          <Pencil className="size-4" aria-hidden />
        </IconButton>
      </div>

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
            ...candidates.map((v) => ({
              value: v.id,
              label: `${v.callSign} · ${name('vehicle', v.typeCode)}`,
            })),
          ]}
        />
      </div>
      {departments && local.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-subtle text-xs font-semibold tracking-wide uppercase">{t('department')}</span>
          <Select
            label={t('department')}
            value={team.departmentId ?? NONE}
            onValueChange={(v) => update.mutate({ departmentId: v === NONE ? null : v })}
            options={[
              { value: NONE, label: t('noDepartment') },
              ...local.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </div>
      ) : null}

      <div>
        <SectionTitle
          action={
            <Button size="sm" variant="secondary" onClick={onEdit} data-testid="edit-members">
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

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent title={t('rename')} closeLabel={tc('close')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ name: draft.trim() });
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
              <Button type="submit" loading={update.isPending} disabled={draft.trim().length < 2}>
                {tc('confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CreateTeamDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const { facilities } = useSnapshot();
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const [name, setName] = React.useState('');
  const [facilityId, setFacilityId] = React.useState<string>();
  const facility = facilityId ?? facilities[0]?.id;
  const create = useMutation({
    mutationFn: (body: { name: string; facilityId: string }) => personnelApi.createTeam(careerId, body),
    onSuccess: (team) => {
      track('team_created');
      toast({ tone: 'success', title: t('created', { name: team.name }) });
      setName('');
      void invalidate();
      onClose();
      onCreated(team.id);
    },
    onError: (e) => onError(e),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent title={t('newTeam')} description={t('newTeamHint')} closeLabel={tc('close')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (facility) create.mutate({ name: name.trim(), facilityId: facility });
          }}
        >
          <Field label={t('name')} htmlFor="team-name">
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={40}
              required
              placeholder={t('namePlaceholder')}
              className="text-base"
            />
          </Field>
          <Field label={t('facility')} htmlFor="team-facility">
            <Select
              id="team-facility"
              label={t('facility')}
              value={facility}
              onValueChange={setFacilityId}
              options={facilities.map((f) => ({ value: f.id, label: f.name }))}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2 || !facility}>
              {t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateDepartmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const catalogName = useCatalogName();
  const { career, facilities } = useSnapshot();
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
  const [name, setName] = React.useState('');
  const [facilityId, setFacilityId] = React.useState<string>();
  const [familyCode, setFamilyCode] = React.useState<string>();
  const facility = facilityId ?? facilities[0]?.id;
  const family = familyCode ?? career.unlockedFamilies[0];
  const create = useMutation({
    mutationFn: (body: { name: string; family: string; facilityId: string }) =>
      personnelApi.createDepartment(careerId, body),
    onSuccess: () => {
      track('department_created');
      setName('');
      void invalidate();
      onClose();
    },
    onError: (e) => onError(e),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent title={t('newDepartment')} description={t('newDepartmentHint')} closeLabel={tc('close')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (facility && family) create.mutate({ name: name.trim(), family, facilityId: facility });
          }}
        >
          <Field label={t('name')} htmlFor="department-name">
            <Input
              id="department-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={40}
              required
              className="text-base"
            />
          </Field>
          <Field label={t('family')} htmlFor="department-family">
            <Select
              id="department-family"
              label={t('family')}
              value={family}
              onValueChange={setFamilyCode}
              options={career.unlockedFamilies.map((f) => ({ value: f, label: catalogName('family', f) }))}
            />
          </Field>
          <Field label={t('facility')} htmlFor="department-facility">
            <Select
              id="department-facility"
              label={t('facility')}
              value={facility}
              onValueChange={setFacilityId}
              options={facilities.map((f) => ({ value: f.id, label: f.name }))}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>
              {t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Members (max 12, operators of the team's facility) + leader, saved in one PUT. */
function MembersForm({ team, people, onClose }: { team: Team; people: PersonnelDto[]; onClose: () => void }) {
  const careerId = useCareerId();
  const t = useTranslations('personnel.teams');
  const tc = useTranslations('common');
  const name = useCatalogName();
  const invalidate = useInvalidatePersonnel();
  const onError = useCommandError();
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
            { value: NONE, label: t('noLeader') },
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
