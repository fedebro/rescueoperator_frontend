'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Hammer, Lock, Truck } from 'lucide-react';
import type { IncidentDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { compareAmount, formatClock, formatTime } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useI18nText } from '@/i18n/use-i18n-text';
import { FamilyBadge, TopdownGlyph, isVehicleClass } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SEVERITY_ORDER, useCareerId, useSnapshot, useVehicleTypeLookup } from './hooks';
import { IncidentQueue } from './incident-queue';
import { FacilitySummary } from './inspectors';
import { InsufficientCreditsDialog } from './shop-screen';
import { PageBody } from './shell';

/* ───────────────────────────── incidents ───────────────────────────── */
export function IncidentsScreen() {
  const t = useTranslations('game.incidentsPage');
  const ti = useTranslations('game.incident');
  const ts = useTranslations('status.incident');
  const tx = useI18nText();
  const locale = useLocale();
  const desktop = useIsDesktop();
  const router = useRouter();
  const { incidents, career } = useSnapshot();
  const select = useUiStore((s) => s.select);
  const open = (i: IncidentDto) => {
    select({ kind: 'incident', id: i.id }, { focus: i.position });
    router.push('/game');
  };
  const rows = React.useMemo(() => [...incidents].sort(SEVERITY_ORDER), [incidents]);
  const columns: Column<IncidentDto>[] = [
    {
      id: 'sev',
      header: ti('severity'),
      width: '92px',
      cell: (i) => (
        <SeverityBadge severity={i.severity} label={ti('severity')} escalating={i.escalating} size="sm" />
      ),
      sortValue: (i) => i.severity,
    },
    {
      id: 'title',
      header: t('col.title'),
      width: 'minmax(180px,2fr)',
      cell: (i) => <span className="font-semibold">{tx(i.title)}</span>,
      sortValue: (i) => tx(i.title),
    },
    {
      id: 'address',
      header: t('col.address'),
      width: 'minmax(180px,2fr)',
      cell: (i) => <span className="text-muted">{i.address}</span>,
    },
    {
      id: 'status',
      header: t('col.status'),
      width: '170px',
      cell: (i) => <StatusChip status={i.status} label={ts(i.status)} />,
      sortValue: (i) => i.status,
    },
    {
      id: 'vehicles',
      header: t('col.vehicles'),
      width: '80px',
      align: 'right',
      cell: (i) => i.assignedVehicleIds.length,
      sortValue: (i) => i.assignedVehicleIds.length,
    },
    {
      id: 'coverage',
      header: t('col.coverage'),
      width: '96px',
      align: 'right',
      cell: (i) => `${Math.round(i.coverageRatio * 100)}%`,
      sortValue: (i) => i.coverageRatio,
    },
    {
      id: 'received',
      header: t('col.received'),
      width: '90px',
      align: 'right',
      cell: (i) => formatTime(i.createdAt, locale, career.timezone),
      sortValue: (i) => i.createdAt,
    },
    {
      id: 'timer',
      header: t('col.timer'),
      width: '90px',
      align: 'right',
      cell: (i) =>
        i.expiresAt ? (
          <Countdown to={i.expiresAt} urgentBelowSeconds={120} />
        ) : i.work.estimatedEndAt ? (
          <Countdown to={i.work.estimatedEndAt} doneLabel="…" />
        ) : (
          '—'
        ),
    },
  ];
  return (
    <PageBody title={t('title')} subtitle={t('subtitle', { count: incidents.length })}>
      {desktop ? (
        <DataTable
          caption={t('title')}
          columns={columns}
          rows={rows}
          rowKey={(i) => i.id}
          onRowClick={open}
          maxHeight="calc(100dvh - 220px)"
          empty={<EmptyState title={t('empty')} />}
        />
      ) : (
        <IncidentQueue onSelected={() => router.push('/game')} />
      )}
    </PageBody>
  );
}

/* ───────────────────────────── fleet ───────────────────────────── */
export function FleetScreen() {
  const t = useTranslations('game.fleetPage');
  const ts = useTranslations('status.vehicle');
  const th = useTranslations('status.health');
  const tc = useTranslations('common');
  const tx = useI18nText();
  const desktop = useIsDesktop();
  const router = useRouter();
  const { vehicles, facilities } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const select = useUiStore((s) => s.select);
  const [filter, setFilter] = React.useState<'all' | 'available' | 'busy'>('all');
  const rows = vehicles.filter(
    (v) => filter === 'all' || (filter === 'available' ? v.status === 'AVAILABLE' : v.status !== 'AVAILABLE'),
  );
  const open = (v: VehicleDto) => {
    select({ kind: 'vehicle', id: v.id }, { focus: v.position });
    router.push('/game');
  };
  const glyph = (v: VehicleDto) => {
    const ty = typeOf(v.typeCode);
    return (
      <TopdownGlyph
        vehicleClass={ty && isVehicleClass(ty.icon) ? ty.icon : 'truck'}
        family={v.family}
        size={24}
      />
    );
  };
  const typeName = (v: VehicleDto) => {
    const ty = typeOf(v.typeCode);
    return ty ? tx(ty.name) : v.typeCode;
  };
  const columns: Column<VehicleDto>[] = [
    {
      id: 'callSign',
      header: t('col.callSign'),
      width: 'minmax(150px,1.2fr)',
      cell: (v) => (
        <span className="flex items-center gap-2 font-semibold">
          {glyph(v)}
          {v.callSign}
        </span>
      ),
      sortValue: (v) => v.callSign,
    },
    {
      id: 'type',
      header: t('col.type'),
      width: 'minmax(170px,2fr)',
      cell: (v) => <span className="text-muted">{typeName(v)}</span>,
      sortValue: typeName,
    },
    {
      id: 'status',
      header: t('col.status'),
      width: '170px',
      cell: (v) => <StatusChip status={v.status} label={ts(v.status)} />,
      sortValue: (v) => v.status,
    },
    {
      id: 'facility',
      header: t('col.facility'),
      width: 'minmax(160px,1.6fr)',
      cell: (v) => facilities.find((f) => f.id === v.facilityId)?.name ?? '—',
    },
    {
      id: 'crew',
      header: t('col.crew'),
      width: '76px',
      align: 'right',
      cell: (v) => `${v.crew.assigned}/${v.crew.optimal}`,
    },
    {
      id: 'health',
      header: t('col.health'),
      width: '130px',
      cell: (v) => (
        <span className="tabular">
          {Math.round(v.health)}% <span className="text-subtle font-sans">{th(v.healthBand)}</span>
        </span>
      ),
      sortValue: (v) => v.health,
    },
    {
      id: 'eta',
      header: tc('eta'),
      width: '84px',
      align: 'right',
      cell: (v) =>
        v.movement ? (
          <Countdown to={v.movement.arriveAt} doneLabel="…" />
        ) : v.busyUntil ? (
          <Countdown to={v.busyUntil} doneLabel="…" />
        ) : (
          '—'
        ),
    },
  ];
  return (
    <PageBody
      title={t('title')}
      subtitle={t('subtitle', {
        count: vehicles.length,
        available: vehicles.filter((v) => v.status === 'AVAILABLE').length,
      })}
      actions={
        <Button asChild variant="secondary">
          <a
            href="/game/shop"
            onClick={(e) => {
              e.preventDefault();
              router.push('/game/shop');
            }}
          >
            {t('buy')}
          </a>
        </Button>
      }
    >
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          <TabsTrigger value="all">{t('filter.all')}</TabsTrigger>
          <TabsTrigger value="available">{t('filter.available')}</TabsTrigger>
          <TabsTrigger value="busy">{t('filter.busy')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {desktop ? (
        <DataTable
          caption={t('title')}
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          onRowClick={open}
          maxHeight="calc(100dvh - 270px)"
          empty={<EmptyState icon={<Truck className="size-5" />} title={t('empty')} />}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Truck className="size-5" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => open(v)}
                className="border-border bg-surface-2 flex w-full items-center gap-3 rounded-md border p-3 text-left"
                data-testid="vehicle-card"
              >
                {glyph(v)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{v.callSign}</span>
                  <span className="text-muted block truncate text-xs">{typeName(v)}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <StatusChip status={v.status} label={ts(v.status)} />
                  {v.movement ? (
                    <Countdown to={v.movement.arriveAt} doneLabel="…" className="text-muted text-xs" />
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}

/* ───────────────────────────── facilities ───────────────────────────── */
export function FacilitiesScreen() {
  const t = useTranslations('game.facilitiesPage');
  const ts = useTranslations('status.facility');
  const tx = useI18nText();
  const { facilities } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = params.get('id') ?? facilities[0]?.id ?? null;
  const selected = facilities.find((f) => f.id === selectedId) ?? null;
  return (
    <PageBody title={t('title')} subtitle={t('subtitle', { count: facilities.length })}>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label={t('title')}>
          {facilities.map((f) => (
            <li key={f.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                aria-pressed={f.id === selectedId}
                onClick={() => router.replace(`/game/facilities?id=${f.id}`)}
                className={`bg-surface-2 flex w-64 items-center gap-3 rounded-md border p-3 text-left lg:w-full ${f.id === selectedId ? 'border-focus' : 'border-border'}`}
              >
                <FamilyBadge family={f.family} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{f.name}</span>
                  <span className="text-muted block truncate text-xs">
                    {tx({ key: `catalog.facility.${f.typeCode}.name` })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <FacilityDetail key={selected.id} facilityId={selected.id} />
        ) : (
          <EmptyState icon={<Building2 className="size-5" />} title={t('empty')} />
        )}
      </div>
      <span className="sr-only">{ts('OPERATIONAL')}</span>
    </PageBody>
  );
}

function FacilityDetail({ facilityId }: { facilityId: string }) {
  const careerId = useCareerId();
  const t = useTranslations('game.facilitiesPage');
  const tc = useTranslations('common');
  const ts = useTranslations('status.facility');
  const tf = useTranslations('game.facility');
  const tx = useI18nText();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const snapshot = useSnapshot();
  const live = snapshot.facilities.find((f) => f.id === facilityId);
  const detail = useQuery({
    queryKey: [
      ...qk.facility(careerId, facilityId),
      JSON.stringify(live?.upgrades ?? []),
      snapshot.career.level,
    ],
    queryFn: () => gameApi.facility(careerId, facilityId),
  });
  const [missing, setMissing] = React.useState<string | null>(null);
  const buy = useMutation({
    mutationFn: (code: string) => gameApi.buyUpgrade(careerId, facilityId, code),
    onSuccess: () => {
      toast({ tone: 'success', title: t('upgradeStarted') });
      void qc.invalidateQueries({ queryKey: qk.facility(careerId, facilityId) });
    },
    onError: (e, code) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS'))
        setMissing(detail.data?.availableUpgrades.find((u) => u.code === code)?.price ?? '0');
      else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  if (!live) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="facility-detail">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <FamilyBadge family={live.family} size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display truncate text-xl font-bold">{live.name}</h2>
            <p className="text-muted truncate text-sm">
              {detail.data?.address ?? tx({ key: `catalog.facility.${live.typeCode}.name` })}
            </p>
          </div>
          <StatusChip status={live.status} label={ts(live.status)} />
        </div>
        <div className="mt-4">
          <FacilitySummary facility={live} />
        </div>
      </Card>
      <Card>
        <SectionTitle>{t('upgrades')}</SectionTitle>
        {!detail.data ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {detail.data.availableUpgrades.map((u) => {
              const building = live.upgrades.find((x) => x.code === u.code)?.buildingUntil ?? null;
              const tooPoor = compareAmount(snapshot.career.credits, u.price) < 0;
              return (
                <li
                  key={u.code}
                  className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3"
                  data-testid="upgrade-offer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{tx(u.name)}</p>
                      <p className="text-muted text-xs">{tx(u.description)}</p>
                    </div>
                    <Badge>{t('upgradeLevel', { level: u.currentLevel, max: u.maxLevel })}</Badge>
                  </div>
                  <p className="text-info text-xs">
                    +{u.effect.delta} {tf(`domain.${u.effect.domain}` as never)}
                  </p>
                  {building ? (
                    <p className="text-warning flex items-center gap-2 text-xs">
                      <Hammer className="size-3.5" aria-hidden />
                      {t('building')} <Countdown to={building} doneLabel="…" />
                    </p>
                  ) : u.lockedReason === 'LEVEL_TOO_LOW' ? (
                    <p className="text-subtle flex items-center gap-1.5 text-xs">
                      <Lock className="size-3.5" aria-hidden />
                      {tc('requiresLevel', { level: u.requiredLevel })}
                    </p>
                  ) : u.lockedReason === 'MAX_LEVEL' ? (
                    <p className="text-subtle text-xs">{t('maxLevel')}</p>
                  ) : (
                    <Button
                      variant={tooPoor ? 'outline' : 'secondary'}
                      size="sm"
                      className="justify-between"
                      loading={buy.isPending && buy.variables === u.code}
                      onClick={() => (tooPoor ? setMissing(u.price) : buy.mutate(u.code))}
                    >
                      <span>
                        {t('buyUpgrade')} · {formatClock(u.buildSeconds)}
                      </span>
                      <CreditAmount value={u.price} label={tc('credits')} size="sm" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <InsufficientCreditsDialog price={missing} onClose={() => setMissing(null)} />
    </div>
  );
}
