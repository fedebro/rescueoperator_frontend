'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BedDouble, Gauge, UserPlus, Users } from 'lucide-react';
import type { FacilityDto, VehicleDto } from '@/contracts';
import type { DispatchOptionsResult } from '@/lib/api/types';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { useCatalog, useSnapshot } from '@/features/game/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, ProgressBar, SectionTitle } from '@/components/ui/misc';
import { FatigueBandLabel } from './fatigue-gauge';
import { PersonnelStatusChip, TeamStatusChip } from './status';
import { useFeature, usePersonnel, useTeams } from './queries';
import { useTeamWarning } from './teams-tab';

type DispatchOptionRow = DispatchOptionsResult['options'][number];
const CREW_BLOCKS = ['CREW_INSUFFICIENT', 'CREW_UNQUALIFIED', 'CREW_EXHAUSTED'] as const;
type CrewBlock = (typeof CREW_BLOCKS)[number];
export const crewBlockOf = (option: DispatchOptionRow): CrewBlock | null =>
  CREW_BLOCKS.find((code) => code === option.blockedReason) ?? null;

/** `missingQualifications` may carry required ROLE codes too: resolve each against the right catalog namespace. */
function useRequirementName(): (code: string) => string {
  const catalog = useCatalog();
  const name = useCatalogName();
  return React.useCallback(
    (code) => name(catalog?.roles?.some((r) => r.code === code) ? 'role' : 'qualification', code),
    [catalog, name],
  );
}

/** SLOT — crew of a vehicle (numbers, assigned team with readiness and members) in the vehicle inspector. */
export function VehicleCrewSection({ vehicle }: { vehicle: VehicleDto }) {
  const t = useTranslations('personnel.crew');
  const name = useCatalogName();
  const warningText = useTeamWarning();
  const teams = useTeams(useFeature('TEAMS').unlocked).data;
  const people = usePersonnel().data;
  const team = teams?.find((x) => x.vehicleId === vehicle.id);
  const members = team ? (people ?? []).filter((p) => team.memberIds.includes(p.id)) : [];
  const { min, optimal, assigned } = vehicle.crew;
  const tone = assigned < min ? 'brand' : assigned < optimal ? 'warning' : 'success';
  return (
    <div data-testid="vehicle-crew">
      <SectionTitle
        action={
          <Link href="/game/personnel" className="text-skyline text-xs hover:underline">
            {t('manage')}
          </Link>
        }
      >
        {t('title')}
      </SectionTitle>
      <div className="flex items-center gap-2">
        <Users className="text-muted size-4 shrink-0" aria-hidden />
        <ProgressBar
          value={assigned / Math.max(1, optimal)}
          label={t('title')}
          tone={tone}
          className="flex-1"
        />
        <span className="tabular text-sm font-semibold">{t('count', { assigned, optimal })}</span>
      </div>
      <p className={`mt-1 text-xs ${assigned < min ? 'text-danger' : 'text-subtle'}`}>
        {assigned < min ? t('belowMin', { min }) : t('minimum', { min })}
      </p>
      {team ? (
        <div className="border-border bg-surface-2 mt-2 flex flex-col gap-1.5 rounded-md border p-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{team.name}</span>
            <span className="tabular text-muted text-xs">{Math.round(team.readiness * 100)}%</span>
            <TeamStatusChip status={team.status} />
          </div>
          {team.warnings.map((w) => (
            <p key={w} className="text-warning flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {warningText(w)}
            </p>
          ))}
          <ul className="flex flex-col gap-1">
            {members.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {p.firstName} {p.lastName}
                  <span className="text-muted"> · {name('role', p.roleCode)}</span>
                </span>
                <FatigueBandLabel band={p.fatigue.band} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-subtle mt-1 text-xs">{t('autoCrew')}</p>
      )}
    </div>
  );
}

/** SLOT — crew preview + blocking reason (with the way to fix it) on a dispatch option row. */
export function DispatchCrewPreview({ option }: { option: DispatchOptionRow }) {
  const t = useTranslations('personnel.crew');
  const requirementName = useRequirementName();
  const crew = option.crew;
  if (!crew) return null;
  const block = crewBlockOf(option);
  return (
    <div
      className="mt-2 flex flex-col gap-1.5 pl-[30px]"
      data-testid="crew-preview"
      data-blocked={block ?? ''}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          tone={crew.available < crew.min ? 'danger' : crew.available < crew.optimal ? 'warning' : 'neutral'}
        >
          <Users className="size-3" aria-hidden />
          {t('preview', { available: crew.available, optimal: crew.optimal, min: crew.min })}
        </Badge>
        {crew.available > 0 ? (
          <>
            <Badge tone="neutral">
              <Gauge className="size-3" aria-hidden />
              {t('efficiency', { pct: Math.round(crew.efficiency * 100) })}
            </Badge>
            <FatigueBandLabel band={crew.maxFatigueBand} className="text-[11px]" />
          </>
        ) : null}
        {crew.missingQualifications.map((code) => (
          <Badge key={code} tone="danger">
            <AlertTriangle className="size-3" aria-hidden />
            {t('missing', { name: requirementName(code) })}
          </Badge>
        ))}
      </div>
      {block ? (
        <p className="text-danger flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" role="status">
          <span className="flex items-center gap-1 font-semibold">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t(`blocked.${block}`)}
          </span>
          <Link
            href={
              block === 'CREW_EXHAUSTED' ? '/game/personnel?tab=roster' : '/game/personnel?tab=recruitment'
            }
            className="text-skyline inline-flex items-center gap-1 font-semibold hover:underline"
            data-testid="crew-fix-link"
          >
            {block === 'CREW_EXHAUSTED' ? (
              <BedDouble className="size-3.5" aria-hidden />
            ) : (
              <UserPlus className="size-3.5" aria-hidden />
            )}
            {t(`fix.${block}`)}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Shown by the dispatch panel when NO vehicle can leave: the ones that are only missing a crew are listed with their
 * reason and the link to fix it (otherwise the panel would just say "no vehicle available").
 */
export function DispatchCrewBlocked({ options }: { options: DispatchOptionRow[] }) {
  const t = useTranslations('personnel.crew');
  const { vehicles } = useSnapshot();
  const blocked = options.filter((o) => crewBlockOf(o) !== null);
  if (blocked.length === 0) return null;
  return (
    <div data-testid="crew-blocked-list">
      <SectionTitle>{t('blockedTitle')}</SectionTitle>
      <ul className="flex flex-col gap-1.5">
        {blocked.map((o) => (
          <li key={o.vehicleId} className="bg-surface-2 border-border rounded-md border p-2.5">
            <p className="text-sm font-semibold">
              {vehicles.find((v) => v.id === o.vehicleId)?.callSign ?? o.vehicleId}
            </p>
            <div className="-ml-[30px]">
              <DispatchCrewPreview option={o} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** SLOT — operators and teams based at a facility (facility page). */
export function FacilityPersonnelSection({ facility }: { facility: FacilityDto }) {
  const t = useTranslations('personnel.facility');
  const people = (usePersonnel().data ?? []).filter((p) => p.facilityId === facility.id);
  const teams = (useTeams(useFeature('TEAMS').unlocked).data ?? []).filter(
    (x) => x.facilityId === facility.id,
  );
  const beds = facility.capacities.find((c) => c.domain === 'PERSONNEL');
  const byStatus = new Map<(typeof people)[number]['status'], number>();
  for (const p of people) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  return (
    <Card data-testid="facility-personnel">
      <SectionTitle
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href={`/game/personnel?facility=${facility.id}`}>{t('manage')}</Link>
          </Button>
        }
      >
        {t('title')}
      </SectionTitle>
      <div className="flex items-center gap-2">
        <Users className="text-muted size-4 shrink-0" aria-hidden />
        <ProgressBar
          value={beds && beds.total > 0 ? beds.used / beds.total : 0}
          label={t('beds')}
          tone="info"
          className="flex-1"
        />
        <span className="tabular text-sm font-semibold">
          {t('bedsCount', { used: beds?.used ?? people.length, total: beds?.total ?? 0 })}
        </span>
      </div>
      {people.length === 0 ? (
        <p className="text-muted mt-2 text-sm">{t('empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {[...byStatus.entries()].map(([status, count]) => (
            <li key={status} className="flex items-center gap-1">
              <PersonnelStatusChip status={status} />
              <span className="tabular text-xs font-semibold">×{count}</span>
            </li>
          ))}
        </ul>
      )}
      {teams.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold">{team.name}</span>
              <span className="tabular text-muted text-xs">{Math.round(team.readiness * 100)}%</span>
              <TeamStatusChip status={team.status} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
