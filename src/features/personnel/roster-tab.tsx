'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search, SlidersHorizontal, Users } from 'lucide-react';
import type { PersonnelDto } from '@/contracts';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useServerNow } from '@/hooks/use-server-now';
import { useCatalogName } from '@/i18n/use-i18n-text';
import { FamilyBadge } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/countdown';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useSnapshot } from '@/features/game/hooks';
import { pickIdleSuggestion } from '@/features/coaching/idle-suggestion';
import { useIdleSuggestionCopy } from '@/features/coaching/idle-suggestion-copy';
import { FATIGUE_BANDS, bandOf, fatigueAt } from './fatigue';
import { FatigueGauge } from './fatigue-gauge';
import { PersonnelStatusChip } from './status';
import { usePersonnel, useTeams, useFeature, useCandidates } from './queries';

const ALL = 'ALL';
export interface RosterFilters {
  facility: string;
  family: string;
  role: string;
  status: string;
  band: string;
  qualification: string;
  search: string;
}
export const EMPTY_FILTERS: RosterFilters = {
  facility: ALL,
  family: ALL,
  role: ALL,
  status: ALL,
  band: ALL,
  qualification: ALL,
  search: '',
};

/** The select filters (everything but the free-text search). */
const FILTER_KEYS = ['facility', 'family', 'role', 'status', 'band', 'qualification'] as const;

/** Pure roster filter (unit-tested): every criterion is optional (`ALL`), the search matches first + last name. */
export function filterRoster(people: PersonnelDto[], f: RosterFilters, nowMs: number): PersonnelDto[] {
  const needle = f.search.trim().toLowerCase();
  return people.filter(
    (p) =>
      (f.facility === ALL || p.facilityId === f.facility) &&
      (f.family === ALL || p.family === f.family) &&
      (f.role === ALL || p.roleCode === f.role) &&
      (f.status === ALL || p.status === f.status) &&
      (f.band === ALL || bandOf(fatigueAt(p.fatigue, nowMs)) === f.band) &&
      (f.qualification === ALL || p.qualifications.some((q) => q.code === f.qualification)) &&
      (needle === '' || `${p.firstName} ${p.lastName}`.toLowerCase().includes(needle)),
  );
}

export function RosterTab({
  onSelect,
  selectedId,
  initialFacility,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
  initialFacility?: string | null;
}) {
  const t = useTranslations('personnel.roster');
  const ts = useTranslations('status.personnel');
  const name = useCatalogName();
  const desktop = useIsDesktop();
  const { facilities } = useSnapshot();
  const people = usePersonnel();
  const teams = useTeams(useFeature('TEAMS').unlocked).data;
  const candidates = useCandidates();
  // Bands move with time: re-evaluate the band filter every few seconds, not on every frame.
  const now = useServerNow(5000);
  const [filters, setFilters] = React.useState<RosterFilters>({
    ...EMPTY_FILTERS,
    facility: initialFacility ?? ALL,
  });
  const set = (key: keyof RosterFilters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const selectsId = React.useId();

  const all = React.useMemo(() => people.data ?? [], [people.data]);
  const rows = React.useMemo(() => filterRoster(all, filters, now), [all, filters, now]);
  const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? '—';
  const teamName = (id: string | null) => teams?.find((x) => x.id === id)?.name ?? '—';
  const unique = (values: string[]) => [...new Set(values)].sort();
  const option = (value: string, label: string) => ({ value, label });

  // Below 1024 px the six selects stay behind one "Filtri (n)" button: they used to fill the whole first screen
  // before a single operator was visible (03 §2.6).
  const activeFilters = FILTER_KEYS.filter((k) => filters[k] !== ALL).length;
  const showSelects = desktop || filtersOpen;
  const filterBar = (
    <div className="flex flex-wrap gap-2" data-testid="roster-filters">
      <Input
        type="search"
        value={filters.search}
        onChange={(e) => set('search')(e.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
        leading={<Search className="size-4" />}
        className="h-11 w-full text-base sm:w-56 lg:h-10 lg:text-sm"
      />
      {desktop ? null : (
        <Button
          variant="secondary"
          className="h-11"
          aria-expanded={filtersOpen}
          aria-controls={selectsId}
          onClick={() => setFiltersOpen((o) => !o)}
          data-testid="roster-filters-toggle"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {t('filters', { count: activeFilters })}
        </Button>
      )}
      {showSelects ? (
        <div id={selectsId} className="flex w-full flex-wrap gap-2 lg:contents">
          <Select
            label={t('filter.facility')}
            value={filters.facility}
            onValueChange={set('facility')}
            options={[option(ALL, t('all.facility')), ...facilities.map((f) => option(f.id, f.name))]}
          />
          <Select
            label={t('filter.family')}
            value={filters.family}
            onValueChange={set('family')}
            options={[
              option(ALL, t('all.family')),
              ...unique(all.map((p) => p.family)).map((c) => option(c, name('family', c))),
            ]}
          />
          <Select
            label={t('filter.role')}
            value={filters.role}
            onValueChange={set('role')}
            options={[
              option(ALL, t('all.role')),
              ...unique(all.map((p) => p.roleCode)).map((c) => option(c, name('role', c))),
            ]}
          />
          <Select
            label={t('filter.status')}
            value={filters.status}
            onValueChange={set('status')}
            options={[
              option(ALL, t('all.status')),
              ...unique(all.map((p) => p.status)).map((c) => option(c, ts(c as PersonnelDto['status']))),
            ]}
          />
          <Select
            label={t('filter.band')}
            value={filters.band}
            onValueChange={set('band')}
            options={[
              option(ALL, t('all.band')),
              ...FATIGUE_BANDS.map((b) => option(b, name('fatigueBand', b))),
            ]}
          />
          <Select
            label={t('filter.qualification')}
            value={filters.qualification}
            onValueChange={set('qualification')}
            options={[
              option(ALL, t('all.qualification')),
              ...unique(all.flatMap((p) => p.qualifications.map((q) => q.code))).map((c) =>
                option(c, name('qualification', c)),
              ),
            ]}
          />
        </div>
      ) : null}
    </div>
  );

  const columns: Column<PersonnelDto>[] = [
    {
      id: 'name',
      header: t('col.name'),
      width: 'minmax(180px,2fr)',
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2">
          <FamilyBadge family={p.family} size={18} title={name('family', p.family)} />
          <span className="truncate font-semibold" title={`${p.firstName} ${p.lastName}`}>
            {p.firstName} {p.lastName}
          </span>
        </span>
      ),
      sortValue: (p) => `${p.lastName} ${p.firstName}`,
    },
    {
      id: 'role',
      header: t('col.role'),
      width: 'minmax(130px,1.4fr)',
      cell: (p) => (
        <span className="text-muted truncate" title={name('role', p.roleCode)}>
          {name('role', p.roleCode)}
        </span>
      ),
      sortValue: (p) => p.roleCode,
    },
    {
      id: 'facility',
      header: t('col.facility'),
      width: 'minmax(130px,1.4fr)',
      cell: (p) => (
        <span className="truncate" title={facilityName(p.facilityId)}>
          {facilityName(p.facilityId)}
        </span>
      ),
      sortValue: (p) => facilityName(p.facilityId),
    },
    {
      id: 'team',
      header: t('col.team'),
      width: 'minmax(100px,1fr)',
      cell: (p) => (
        <span className="text-muted truncate" title={teamName(p.teamId)}>
          {teamName(p.teamId)}
        </span>
      ),
      sortValue: (p) => teamName(p.teamId),
    },
    {
      id: 'status',
      header: t('col.status'),
      width: '190px',
      cell: (p) => (
        <span className="flex items-center gap-1.5">
          <PersonnelStatusChip status={p.status} />
          {p.busyUntil ? <Countdown to={p.busyUntil} className="text-muted text-xs" /> : null}
        </span>
      ),
      sortValue: (p) => p.status,
    },
    {
      id: 'fatigue',
      header: t('col.fatigue'),
      width: '130px',
      cell: (p) => <FatigueGauge fatigue={p.fatigue} compact />,
      sortValue: (p) => fatigueAt(p.fatigue, now),
    },
    {
      id: 'competence',
      header: t('col.competence'),
      width: '90px',
      align: 'right',
      cell: (p) => <span className="tabular">{p.competence}</span>,
      sortValue: (p) => p.competence,
    },
    {
      id: 'missions',
      header: t('col.missions'),
      width: '90px',
      align: 'right',
      cell: (p) => <span className="tabular">{p.missions}</span>,
      sortValue: (p) => p.missions,
    },
  ];

  // No one hired at all: point at a candidate about to expire when there is one, instead of generic copy.
  const idleSuggestion =
    all.length === 0
      ? pickIdleSuggestion({ candidates: candidates.data?.candidates, credits: '0', level: 1 })
      : null;
  const idleCopy = useIdleSuggestionCopy(idleSuggestion);
  const empty = (
    <EmptyState
      icon={<Users className="size-5" />}
      title={t('emptyTitle')}
      description={idleCopy?.text ?? t('emptyHint')}
      action={
        idleCopy ? (
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="h-11 lg:h-8"
            data-testid="idle-suggestion-action"
          >
            <Link href={idleCopy.href}>{idleCopy.label}</Link>
          </Button>
        ) : undefined
      }
    />
  );
  return (
    <div className="flex flex-col gap-3">
      {filterBar}
      <p className="text-subtle text-xs" role="status" data-testid="roster-count">
        {t('count', { shown: rows.length, total: all.length })}
      </p>
      {people.isLoading ? (
        <Skeleton className="h-48" />
      ) : desktop ? (
        <DataTable
          caption={t('caption')}
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          onRowClick={(p) => onSelect(p.id)}
          selectedKey={selectedId}
          empty={empty}
          maxHeight="60vh"
        />
      ) : rows.length === 0 ? (
        empty
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className="panel hover:border-border-strong flex w-full flex-col gap-2 p-3 text-left"
                data-testid="operator-card"
              >
                <span className="flex items-center gap-2.5">
                  <FamilyBadge family={p.family} size={32} title={name('family', p.family)} />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-sm font-semibold"
                      title={`${p.firstName} ${p.lastName}`}
                    >
                      {p.firstName} {p.lastName}
                    </span>
                    <span
                      className="text-muted block truncate text-xs"
                      title={`${name('role', p.roleCode)} · ${facilityName(p.facilityId)}`}
                    >
                      {name('role', p.roleCode)} · {facilityName(p.facilityId)}
                    </span>
                  </span>
                  <PersonnelStatusChip status={p.status} />
                </span>
                <FatigueGauge fatigue={p.fatigue} compact />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
