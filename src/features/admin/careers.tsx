'use client';
import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Coins, Power, Search, Siren } from 'lucide-react';
import type { FacilityDto, LedgerEntryDto, NotificationDto, VehicleDto } from '@/contracts';
import type { z } from 'zod';
import {
  adminApi,
  type AdminCareerDetail,
  type AdminCareerRow,
  type AdminIncidentRow,
  type AdminPersonnelRow,
} from '@/lib/api/admin';
import { qk } from '@/lib/api/query-keys';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { compareAmount, formatPercent } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { CreditAmount } from '@/components/ui/credit-amount';
import type { Column } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Card, EmptyState, ProgressBar, SectionTitle, Stat } from '@/components/ui/misc';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useReasonedAction } from './confirm-with-reason';
import { CreditAdjustmentDialog } from './credit-adjustment';
import { SpawnIncidentDialog } from './spawn-incident';
import {
  AdminTable,
  DateCell,
  DefinitionGrid,
  Heading,
  IdCode,
  NoPermission,
  QueryState,
  StateBadge,
  useCan,
  useDebounced,
} from './shared';

type Ledger = z.infer<typeof LedgerEntryDto>;
type Notification = z.infer<typeof NotificationDto>;

function Duty({ onDuty }: { onDuty: boolean }) {
  const t = useTranslations('admin.careers');
  return (
    <StateBadge
      tone={onDuty ? 'success' : 'neutral'}
      icon={Power}
      label={onDuty ? t('onDuty') : t('offDuty')}
    />
  );
}

export function AdminCareers() {
  const t = useTranslations('admin.careers');
  const tc = useTranslations('admin.common');
  const router = useRouter();
  const [value, search, setValue] = useDebounced();
  const q = useQuery({
    queryKey: qk.admin('careers', search),
    queryFn: () => adminApi.careers({ q: search || undefined }),
  });
  const columns: Column<AdminCareerRow>[] = [
    {
      id: 'director',
      header: t('director'),
      width: 'minmax(160px,1.5fr)',
      cell: (c) => <span className="font-semibold">{c.directorName}</span>,
      sortValue: (c) => c.directorName,
    },
    { id: 'location', header: t('location'), width: '140px', cell: (c) => c.locationName },
    {
      id: 'level',
      header: t('level'),
      width: '80px',
      align: 'right',
      cell: (c) => c.level,
      sortValue: (c) => c.level,
    },
    {
      id: 'credits',
      header: t('credits'),
      width: '120px',
      align: 'right',
      cell: (c) => <CreditAmount value={c.credits} label={t('credits')} size="sm" />,
      sortValue: (c) => BigInt(c.credits),
    },
    {
      id: 'facilities',
      header: t('facilities'),
      width: '80px',
      align: 'right',
      cell: (c) => c.facilities,
      sortValue: (c) => c.facilities,
    },
    {
      id: 'vehicles',
      header: t('vehicles'),
      width: '80px',
      align: 'right',
      cell: (c) => c.vehicles,
      sortValue: (c) => c.vehicles,
    },
    {
      id: 'incidents',
      header: t('incidents'),
      width: '100px',
      align: 'right',
      cell: (c) => c.activeIncidents,
      sortValue: (c) => c.activeIncidents,
    },
    { id: 'duty', header: t('duty'), width: '150px', cell: (c) => <Duty onDuty={c.onDuty} /> },
    {
      id: 'active',
      header: t('lastActive'),
      width: '160px',
      cell: (c) => <DateCell iso={c.lastActiveAt} />,
      sortValue: (c) => c.lastActiveAt ?? '',
    },
    { id: 'id', header: tc('id'), width: 'minmax(250px,1.5fr)', cell: (c) => <IdCode value={c.id} /> },
  ];
  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')}>
        <Input
          className="w-full text-base sm:w-72 lg:text-sm"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          leading={<Search className="size-4" />}
        />
      </Heading>
      <QueryState loading={q.isLoading} error={q.error}>
        <AdminTable
          caption={t('title')}
          columns={columns}
          rows={q.data ?? []}
          rowKey={(c) => c.id}
          titleColumn="director"
          cardTitle={(c) => c.directorName}
          onRowClick={(c) => router.push(`/admin/careers/${c.id}`)}
          rowHref={(c) => `/admin/careers/${c.id}`}
          empty={<EmptyState title={t('empty')} />}
        />
      </QueryState>
    </>
  );
}

const TABS = [
  'overview',
  'facilities',
  'vehicles',
  'personnel',
  'incidents',
  'ledger',
  'progression',
  'notifications',
] as const;

export function AdminCareerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('admin.careers');
  const q = useQuery({ queryKey: qk.admin('career', id), queryFn: () => adminApi.career(id) });
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {q.data ? <CareerInspector detail={q.data} /> : <EmptyState title={t('empty')} />}
    </QueryState>
  );
}

/** Read-only by design (Spec 18 §8): the only writes are audited tools — never "open as player" (no impersonation). */
function CareerInspector({ detail }: { detail: AdminCareerDetail }) {
  const t = useTranslations('admin.careers');
  const can = useCan();
  const { career } = detail;
  const [tab, setTab] = React.useState<string>('overview');
  const [adjusting, setAdjusting] = React.useState(false);
  const [spawning, setSpawning] = React.useState(false);
  const mayAdjust = can('careers.creditAdjustment') && detail.creditAdjustmentLimit !== '0';
  const duty = useReasonedAction<boolean, AdminCareerRow>({
    run: (onDuty, reason) => adminApi.setDuty(career.id, onDuty, reason),
    success: (row) => (row.onDuty ? t('dutyOnDone') : t('dutyOffDone')),
    invalidate: [qk.admin('career', career.id), qk.admin('careers')],
  });
  return (
    <>
      <Heading
        title={career.directorName}
        subtitle={`${career.locationName} · ${t('levelN', { level: career.level })}`}
      >
        <Duty onDuty={career.onDuty} />
        {mayAdjust ? (
          <Button onClick={() => setAdjusting(true)}>
            <Coins className="size-4" aria-hidden />
            {t('adjustCredits')}
          </Button>
        ) : null}
        {can('careers.spawnIncident') ? (
          <Button variant="secondary" onClick={() => setSpawning(true)}>
            <Siren className="size-4" aria-hidden />
            {t('spawnIncident')}
          </Button>
        ) : null}
        {can('careers.setDuty') ? (
          <Button
            variant="secondary"
            onClick={() =>
              duty.ask(!career.onDuty, {
                title: career.onDuty ? t('dutyOffTitle') : t('dutyOnTitle'),
                description: t('dutyBody'),
                targetId: career.id,
                confirmLabel: career.onDuty ? t('setOffDuty') : t('setOnDuty'),
                tone: 'primary',
              })
            }
          >
            <Power className="size-4" aria-hidden />
            {career.onDuty ? t('setOffDuty') : t('setOnDuty')}
          </Button>
        ) : null}
        {!mayAdjust && !can('careers.spawnIncident') ? <NoPermission /> : null}
      </Heading>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('tabsLabel')}>
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="pt-4">
          <TabsContent value="overview">
            <Overview detail={detail} />
          </TabsContent>
          <TabsContent value="facilities">
            <FacilitiesTab careerId={career.id} />
          </TabsContent>
          <TabsContent value="vehicles">
            <VehiclesTab careerId={career.id} />
          </TabsContent>
          <TabsContent value="personnel">
            <PersonnelTab careerId={career.id} />
          </TabsContent>
          <TabsContent value="incidents">
            <IncidentsTab careerId={career.id} />
          </TabsContent>
          <TabsContent value="ledger">
            <LedgerTab careerId={career.id} />
          </TabsContent>
          <TabsContent value="progression">
            <ProgressionTab careerId={career.id} />
          </TabsContent>
          <TabsContent value="notifications">
            <NotificationsTab careerId={career.id} />
          </TabsContent>
        </div>
      </Tabs>

      {adjusting ? (
        <CreditAdjustmentDialog
          open
          onOpenChange={setAdjusting}
          careerId={career.id}
          directorName={career.directorName}
          balance={career.credits}
          limit={detail.creditAdjustmentLimit}
        />
      ) : null}
      {spawning ? <SpawnIncidentDialog open onOpenChange={setSpawning} careerId={career.id} /> : null}
      {duty.dialog}
    </>
  );
}

function Overview({ detail }: { detail: AdminCareerDetail }) {
  const t = useTranslations('admin.careers');
  const tc = useTranslations('admin.common');
  const { career, stats } = detail;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <Stat
            label={t('credits')}
            value={
              <span data-testid="career-balance">
                <CreditAmount value={career.credits} label={t('credits')} />
              </span>
            }
          />
        </Card>
        <Card>
          <Stat
            label={t('earned')}
            value={<CreditAmount value={stats.creditsEarned} label={t('earned')} />}
          />
        </Card>
        <Card>
          <Stat label={t('spent')} value={<CreditAmount value={stats.creditsSpent} label={t('spent')} />} />
        </Card>
        <Card>
          <Stat label={t('resolvedFailed')} value={`${stats.incidentsResolved} / ${stats.incidentsFailed}`} />
        </Card>
      </div>
      <Card>
        <DefinitionGrid
          items={[
            [tc('id'), <IdCode key="id" value={career.id} />],
            [t('owner'), <IdCode key="user" value={detail.userId} href={`/admin/users/${detail.userId}`} />],
            [t('email'), detail.email || tc('none')],
            [t('location'), career.locationName],
            [t('facilities'), career.facilities],
            [t('vehicles'), career.vehicles],
            [t('incidents'), career.activeIncidents],
            [t('lastActive'), <DateCell key="active" iso={career.lastActiveAt} />],
          ]}
        />
      </Card>
    </div>
  );
}

function FacilitiesTab({ careerId }: { careerId: string }) {
  const t = useTranslations('admin.careers');
  const ts = useTranslations('status.facility');
  const name = useCatalogName();
  const q = useQuery({
    queryKey: qk.admin('careerFacilities', careerId),
    queryFn: () => adminApi.careerFacilities(careerId),
  });
  const columns: Column<FacilityDto>[] = [
    { id: 'name', header: t('name'), width: 'minmax(180px,2fr)', cell: (f) => f.name },
    { id: 'type', header: t('type'), width: 'minmax(180px,2fr)', cell: (f) => name('facility', f.typeCode) },
    {
      id: 'status',
      header: t('status'),
      width: '180px',
      cell: (f) => <StatusChip status={f.status} label={ts.has(f.status) ? ts(f.status) : f.status} />,
    },
    {
      id: 'capacity',
      header: t('capacity'),
      width: 'minmax(200px,2fr)',
      cell: (f) => (
        <span className="tabular text-muted text-xs">
          {f.capacities
            .filter((c) => c.total > 0)
            .map((c) => `${c.domain} ${c.used}/${c.total}`)
            .join(' · ')}
        </span>
      ),
    },
    { id: 'id', header: 'ID', width: 'minmax(250px,1.5fr)', cell: (f) => <IdCode value={f.id} /> },
  ];
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      <AdminTable
        caption={t('tabs.facilities')}
        columns={columns}
        rows={q.data ?? []}
        rowKey={(f) => f.id}
        titleColumn="name"
        cardTitle={(f) => f.name}
        empty={<EmptyState title={t('emptyTab')} />}
      />
    </QueryState>
  );
}

function VehiclesTab({ careerId }: { careerId: string }) {
  const t = useTranslations('admin.careers');
  const ts = useTranslations('status.vehicle');
  const name = useCatalogName();
  const q = useQuery({
    queryKey: qk.admin('careerVehicles', careerId),
    queryFn: () => adminApi.careerVehicles(careerId),
  });
  const columns: Column<VehicleDto>[] = [
    {
      id: 'callSign',
      header: t('callSign'),
      width: '130px',
      cell: (v) => <span className="font-semibold">{v.callSign}</span>,
      sortValue: (v) => v.callSign,
    },
    { id: 'type', header: t('type'), width: 'minmax(180px,2fr)', cell: (v) => name('vehicle', v.typeCode) },
    {
      id: 'status',
      header: t('status'),
      width: '180px',
      cell: (v) => <StatusChip status={v.status} label={ts.has(v.status) ? ts(v.status) : v.status} />,
      sortValue: (v) => v.status,
    },
    {
      id: 'health',
      header: t('health'),
      width: '90px',
      align: 'right',
      cell: (v) => `${Math.round(v.health)}%`,
      sortValue: (v) => v.health,
    },
    {
      id: 'crew',
      header: t('crew'),
      width: '90px',
      align: 'right',
      cell: (v) => `${v.crew.assigned}/${v.crew.optimal}`,
    },
    {
      id: 'incident',
      header: t('incident'),
      width: 'minmax(250px,1.5fr)',
      cell: (v) =>
        v.incidentId ? <IdCode value={v.incidentId} href={`/admin/incidents/${v.incidentId}`} /> : '—',
    },
    { id: 'id', header: 'ID', width: 'minmax(250px,1.5fr)', cell: (v) => <IdCode value={v.id} /> },
  ];
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      <AdminTable
        caption={t('tabs.vehicles')}
        columns={columns}
        rows={q.data ?? []}
        rowKey={(v) => v.id}
        titleColumn="callSign"
        cardTitle={(v) => v.callSign}
        empty={<EmptyState title={t('emptyTab')} />}
      />
    </QueryState>
  );
}

function PersonnelTab({ careerId }: { careerId: string }) {
  const t = useTranslations('admin.careers');
  const name = useCatalogName();
  const q = useQuery({
    queryKey: qk.admin('careerPersonnel', careerId),
    queryFn: () => adminApi.careerPersonnel(careerId),
  });
  const columns: Column<AdminPersonnelRow>[] = [
    {
      id: 'name',
      header: t('name'),
      width: 'minmax(180px,2fr)',
      cell: (p) => p.name,
      sortValue: (p) => p.name,
    },
    {
      id: 'role',
      header: t('role'),
      width: 'minmax(160px,1.5fr)',
      cell: (p) => (p.roleCode ? name('role', p.roleCode) : '—'),
    },
    {
      id: 'status',
      header: t('status'),
      width: '160px',
      cell: (p) => <code className="text-xs">{p.status}</code>,
    },
    {
      id: 'facility',
      header: t('facility'),
      width: 'minmax(250px,1.5fr)',
      cell: (p) => (p.facilityId ? <IdCode value={p.facilityId} /> : '—'),
    },
    { id: 'id', header: 'ID', width: 'minmax(250px,1.5fr)', cell: (p) => <IdCode value={p.id} /> },
  ];
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      <AdminTable
        caption={t('tabs.personnel')}
        columns={columns}
        rows={q.data ?? []}
        rowKey={(p) => p.id}
        titleColumn="name"
        cardTitle={(p) => p.name}
        empty={<EmptyState title={t('emptyTab')} />}
      />
    </QueryState>
  );
}

function IncidentsTab({ careerId }: { careerId: string }) {
  const t = useTranslations('admin.careers');
  const q = useQuery({
    queryKey: qk.admin('careerIncidents', careerId),
    queryFn: () => adminApi.incidents({ careerId }),
  });
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      <IncidentRowsTable caption={t('tabs.incidents')} rows={q.data ?? []} showCareer={false} />
    </QueryState>
  );
}

/** Shared by the career inspector and the live incident inspector. */
export function IncidentRowsTable({
  caption,
  rows,
  showCareer,
}: {
  caption: string;
  rows: AdminIncidentRow[];
  showCareer: boolean;
}) {
  const t = useTranslations('admin.incidents');
  const ts = useTranslations('status.incident');
  const name = useCatalogName();
  const router = useRouter();
  const columns: Column<AdminIncidentRow>[] = [
    {
      id: 'sev',
      header: t('severity'),
      width: '90px',
      cell: (i) => <SeverityBadge severity={i.severity} label={t('severity')} size="sm" />,
      sortValue: (i) => i.severity,
    },
    {
      id: 'template',
      header: t('template'),
      width: 'minmax(220px,2fr)',
      cell: (i) => (
        <span title={i.templateCode}>
          {name('incident', i.templateCode, 'title')}{' '}
          <code className="text-subtle text-[11px]">{i.templateCode}</code>
        </span>
      ),
      sortValue: (i) => i.templateCode,
    },
    {
      id: 'status',
      header: t('status'),
      width: '170px',
      cell: (i) => <StatusChip status={i.status} label={ts.has(i.status) ? ts(i.status) : i.status} />,
      sortValue: (i) => i.status,
    },
    {
      id: 'address',
      header: t('address'),
      width: 'minmax(180px,2fr)',
      cell: (i) => <span className="text-muted">{i.address}</span>,
    },
    ...(showCareer
      ? [
          {
            id: 'career',
            header: t('career'),
            width: 'minmax(160px,1.5fr)',
            cell: (i: AdminIncidentRow) => i.directorName,
            sortValue: (i: AdminIncidentRow) => i.directorName,
          } satisfies Column<AdminIncidentRow>,
        ]
      : []),
    {
      id: 'created',
      header: t('created'),
      width: '160px',
      cell: (i) => <DateCell iso={i.createdAt} />,
      sortValue: (i) => i.createdAt,
    },
  ];
  return (
    <AdminTable
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(i) => i.id}
      cardTitle={(i) => name('incident', i.templateCode, 'title')}
      onRowClick={(i) => router.push(`/admin/incidents/${i.id}`)}
      rowHref={(i) => `/admin/incidents/${i.id}`}
      empty={<EmptyState title={t('empty')} />}
    />
  );
}

function LedgerTab({ careerId }: { careerId: string }) {
  const t = useTranslations('admin.careers');
  const tc = useTranslations('admin.common');
  const tx = useI18nText();
  const q = useInfiniteQuery({
    queryKey: qk.admin('careerLedger', careerId),
    queryFn: ({ pageParam }) => adminApi.careerLedger(careerId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? null) : null),
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const columns: Column<Ledger>[] = [
    { id: 'time', header: t('time'), width: '170px', cell: (l) => <DateCell iso={l.createdAt} /> },
    {
      id: 'type',
      header: t('type'),
      width: '190px',
      cell: (l) => <code className="text-xs">{l.entryType}</code>,
    },
    {
      id: 'description',
      header: t('description'),
      width: 'minmax(200px,2fr)',
      cell: (l) => tx(l.description),
    },
    {
      id: 'amount',
      header: t('amount'),
      width: '130px',
      align: 'right',
      cell: (l) => (
        <span className={compareAmount(l.amount, '0') < 0 ? 'text-danger' : 'text-success'}>
          <CreditAmount value={l.amount} sign tone="plain" label={t('amount')} size="sm" />
        </span>
      ),
    },
    {
      id: 'balance',
      header: t('balanceAfter'),
      width: '130px',
      align: 'right',
      cell: (l) => <CreditAmount value={l.balanceAfter} label={t('balanceAfter')} size="sm" />,
    },
  ];
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      <p className="text-subtle mb-2 text-xs">{t('ledgerHint')}</p>
      <AdminTable
        caption={t('tabs.ledger')}
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        titleColumn="description"
        cardTitle={(l) => tx(l.description)}
        maxHeight="calc(100dvh - 380px)"
        empty={<EmptyState title={t('emptyTab')} />}
      />
      {q.hasNextPage ? (
        <Button
          className="mt-3 self-start"
          variant="secondary"
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
        >
          {tc('loadMore')}
        </Button>
      ) : null}
    </QueryState>
  );
}

function ProgressionTab({ careerId }: { careerId: string }) {
  const t = useTranslations('admin.careers');
  const tc = useTranslations('admin.common');
  const locale = useLocale();
  const name = useCatalogName();
  const q = useQuery({
    queryKey: qk.admin('careerProgression', careerId),
    queryFn: () => adminApi.careerProgression(careerId),
  });
  const p = q.data;
  const span = p ? BigInt(p.xpForNextLevel) - BigInt(p.xpForCurrentLevel) : 0n;
  const ratio =
    p && span > 0n ? Number(((BigInt(p.xp) - BigInt(p.xpForCurrentLevel)) * 1000n) / span) / 1000 : 1;
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      {p ? (
        <Card className="flex flex-col gap-4">
          <div>
            <SectionTitle>{t('levelN', { level: p.level })}</SectionTitle>
            <ProgressBar value={ratio} label={t('xp')} tone="xp" showValue />
            <p className="text-subtle tabular mt-1 text-xs">
              {t('xpOf', {
                xp: BigInt(p.xp).toLocaleString(locale),
                next: BigInt(p.xpForNextLevel).toLocaleString(locale),
              })}
            </p>
          </div>
          <DefinitionGrid
            items={[
              [t('reputation'), formatPercent(p.reputation / 100, locale)],
              [t('resolvedFailed'), `${p.incidentsResolved} / ${p.incidentsFailed}`],
              [t('families'), p.unlockedFamilies.map((f) => name('family', f)).join(', ') || tc('none')],
              [t('tutorial'), p.tutorialCompleted ? t('tutorialDone') : (p.tutorialStep ?? tc('none'))],
            ]}
          />
        </Card>
      ) : null}
    </QueryState>
  );
}

function NotificationsTab({ careerId }: { careerId: string }) {
  const t = useTranslations('admin.careers');
  const tx = useI18nText();
  const q = useQuery({
    queryKey: qk.admin('careerNotifications', careerId),
    queryFn: () => adminApi.careerNotifications(careerId),
  });
  const columns: Column<Notification>[] = [
    { id: 'time', header: t('time'), width: '170px', cell: (n) => <DateCell iso={n.createdAt} /> },
    {
      id: 'category',
      header: t('category'),
      width: '140px',
      cell: (n) => <code className="text-xs">{n.category}</code>,
    },
    {
      id: 'priority',
      header: t('priority'),
      width: '120px',
      cell: (n) => <code className="text-xs">{n.priority}</code>,
    },
    { id: 'title', header: t('title2'), width: 'minmax(260px,3fr)', cell: (n) => tx(n.title) },
    {
      id: 'read',
      header: t('read'),
      width: '170px',
      cell: (n) => (n.readAt ? <DateCell iso={n.readAt} /> : <StateBadge tone="info" label={t('unread')} />),
    },
  ];
  return (
    <QueryState loading={q.isLoading} error={q.error}>
      <AdminTable
        caption={t('tabs.notifications')}
        columns={columns}
        rows={q.data ?? []}
        rowKey={(n) => n.id}
        titleColumn="title"
        cardTitle={(n) => tx(n.title)}
        empty={<EmptyState title={t('emptyTab')} />}
      />
    </QueryState>
  );
}
