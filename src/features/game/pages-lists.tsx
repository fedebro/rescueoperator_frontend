'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Hammer, Lock, Truck } from 'lucide-react';
import type { FacilityFamily, IncidentDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { facilitiesApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { compareAmount, formatClock, formatTime } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { cn } from '@/lib/utils';
import { FamilyBadge, TopdownGlyph, vehicleClassOf } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import { FacilityPersonnelSection } from '@/features/personnel/slots';
import { FacilityStockSection } from '@/features/logistics/slots';
import { SEVERITY_ORDER, useCareerId, useSnapshot, useVehicleTypeLookup } from './hooks';
import { IncidentQueue } from './incident-queue';
import { FacilitySummary } from './inspectors';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { ConstructionBanner, PromotionCard } from '@/features/facilities/facility-extras';
import { NewFacilitySection } from '@/features/facilities/new-facility-section';
import { TransferVehicleButton } from '@/features/facilities/transfer-vehicle';
import { useFamilyLabel } from '@/features/facilities/site-details';
import { IncidentFamilies } from '@/features/families/family-chips';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { PageBody } from './shell';

/* ───────────────────────────── incidents ───────────────────────────── */
export function IncidentsScreen() {
  const t = useTranslations('game.incidentsPage');
  const ti = useTranslations('game.incident');
  const tfam = useTranslations('families.queue');
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
      cell: (i) => (
        <span className="font-semibold" title={tx(i.title)}>
          {tx(i.title)}
        </span>
      ),
      sortValue: (i) => tx(i.title),
    },
    {
      id: 'families',
      header: tfam('column'),
      width: '104px',
      cell: (i) => <IncidentFamilies incident={i} size={18} />,
    },
    {
      id: 'address',
      header: t('col.address'),
      width: 'minmax(180px,2fr)',
      cell: (i) => (
        <span className="text-muted" title={i.address}>
          {i.address}
        </span>
      ),
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
  const ttr = useTranslations('facilities.transfer');
  const tf = useTranslations('coaching.sections.fleet');
  const tco = useTranslations('coaching');
  const tx = useI18nText();
  const desktop = useIsDesktop();
  const router = useRouter();
  const { vehicles, facilities } = useSnapshot();
  const fleetContent = {
    sectionKey: 'fleet',
    title: tf('title'),
    body: tf('body'),
    tips: [tf('tip1'), tf('tip2')],
  };
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
  const typeName = (v: VehicleDto) => {
    const ty = typeOf(v.typeCode);
    return ty ? tx(ty.name) : v.typeCode;
  };
  const glyph = (v: VehicleDto) => {
    const ty = typeOf(v.typeCode);
    return (
      <TopdownGlyph vehicleClass={vehicleClassOf(ty?.icon)} family={v.family} size={24} title={typeName(v)} />
    );
  };
  const columns: Column<VehicleDto>[] = [
    {
      id: 'callSign',
      header: t('col.callSign'),
      width: 'minmax(150px,1.2fr)',
      cell: (v) => (
        <span className="flex items-center gap-2 font-semibold">
          {glyph(v)}
          <span className="truncate" title={v.callSign}>
            {v.callSign}
          </span>
        </span>
      ),
      sortValue: (v) => v.callSign,
    },
    {
      id: 'type',
      header: t('col.type'),
      width: 'minmax(170px,2fr)',
      cell: (v) => (
        <span className="text-muted truncate" title={typeName(v)}>
          {typeName(v)}
        </span>
      ),
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
      cell: (v) => {
        const facilityName = facilities.find((f) => f.id === v.facilityId)?.name ?? '—';
        return (
          <span className="block truncate" title={facilityName}>
            {facilityName}
          </span>
        );
      },
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
    {
      id: 'transfer',
      header: ttr('column'),
      width: '76px',
      align: 'right',
      cell: (v) => <TransferVehicleButton vehicle={v} compact />,
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
        <>
          <SectionHelpButton
            content={fleetContent}
            label={tco('help.buttonLabel')}
            closeLabel={tc('close')}
          />
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
        </>
      }
    >
      <SectionPrimer content={fleetContent} />
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
            <li key={v.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => open(v)}
                className="border-border bg-surface-2 flex min-w-0 flex-1 items-center gap-3 rounded-md border p-3 text-left"
                data-testid="vehicle-card"
              >
                {glyph(v)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold" title={v.callSign}>
                    {v.callSign}
                  </span>
                  <span className="text-muted block truncate text-xs" title={typeName(v)}>
                    {typeName(v)}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <StatusChip status={v.status} label={ts(v.status)} />
                  {v.movement ? (
                    <Countdown to={v.movement.arriveAt} doneLabel="…" className="text-muted text-xs" />
                  ) : v.busyUntil ? (
                    <Countdown to={v.busyUntil} doneLabel="…" className="text-muted text-xs" />
                  ) : null}
                </span>
              </button>
              <TransferVehicleButton vehicle={v} compact className="size-11" />
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}

/* ───────────────────────────── facilities ───────────────────────────── */
type FamilyFilter = 'ALL' | FacilityFamily;

export function FacilitiesScreen() {
  const t = useTranslations('game.facilitiesPage');
  const ts = useTranslations('status.facility');
  const tc = useTranslations('common');
  const tfac = useTranslations('coaching.sections.facilities');
  const tco = useTranslations('coaching');
  const name = useCatalogName();
  const familyLabel = useFamilyLabel();
  const { facilities } = useSnapshot();
  const params = useSearchParams();
  const router = useRouter();
  const [familyFilter, setFamilyFilter] = React.useState<FamilyFilter>('ALL');
  const families = React.useMemo(() => [...new Set(facilities.map((f) => f.family))], [facilities]);
  const visibleFacilities = facilities.filter((f) => familyFilter === 'ALL' || f.family === familyFilter);
  const selectedId = params.get('id') ?? facilities[0]?.id ?? null;
  const selected = facilities.find((f) => f.id === selectedId) ?? null;
  const facilitiesContent = {
    sectionKey: 'facilities',
    title: tfac('title'),
    body: tfac('body'),
    tips: [tfac('tip1'), tfac('tip2')],
  };
  return (
    <PageBody
      title={t('title')}
      subtitle={t('subtitle', { count: facilities.length })}
      actions={
        <SectionHelpButton
          content={facilitiesContent}
          label={tco('help.buttonLabel')}
          closeLabel={tc('close')}
        />
      }
    >
      <SectionPrimer content={facilitiesContent} />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-2">
          {families.length > 1 ? (
            <div
              role="group"
              aria-label={t('filterByFamily')}
              className="flex gap-1.5 overflow-x-auto pb-1"
              data-testid="facilities-family-filter"
            >
              {(['ALL', ...families] as FamilyFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={familyFilter === f}
                  onClick={() => setFamilyFilter(f)}
                  className={cn(
                    'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold',
                    familyFilter === f
                      ? 'border-focus bg-surface-3 text-fg'
                      : 'border-border text-muted hover:bg-surface-3',
                  )}
                  data-testid="facilities-family-chip"
                  data-family={f}
                >
                  {f === 'ALL' ? null : <FamilyBadge family={f} size={18} />}
                  {f === 'ALL' ? t('allFamilies') : familyLabel(f)}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label={t('title')}>
            {visibleFacilities.map((f) => (
              <li key={f.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  aria-pressed={f.id === selectedId}
                  onClick={() => router.replace(`/game/facilities?id=${f.id}`)}
                  className={`bg-surface-2 flex w-64 items-center gap-3 rounded-md border p-3 text-left lg:w-full ${f.id === selectedId ? 'border-focus' : 'border-border'}`}
                >
                  <FamilyBadge family={f.family} size={36} title={name('facility', f.typeCode)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold" title={f.name}>
                      {f.name}
                    </span>
                    <span className="text-muted block truncate text-xs" title={name('facility', f.typeCode)}>
                      {name('facility', f.typeCode)}
                    </span>
                    {f.status !== 'OPERATIONAL' ? (
                      <span className="mt-1 flex items-center gap-2">
                        <StatusChip status={f.status} label={ts(f.status)} />
                        {f.operationalAt ? (
                          <Countdown to={f.operationalAt} doneLabel="…" className="text-muted text-xs" />
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selected ? (
          <FacilityDetail key={selected.id} facilityId={selected.id} />
        ) : (
          <EmptyState icon={<Building2 className="size-5" />} title={t('empty')} />
        )}
      </div>
      <NewFacilitySection initialFamily={params.get('new')} />
    </PageBody>
  );
}

function FacilityDetail({ facilityId }: { facilityId: string }) {
  const careerId = useCareerId();
  const t = useTranslations('game.facilitiesPage');
  const tc = useTranslations('common');
  const ts = useTranslations('status.facility');
  const tf = useTranslations('game.facility');
  const tfa = useTranslations('facilities.detail');
  const tx = useI18nText();
  const name = useCatalogName();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const snapshot = useSnapshot();
  const live = snapshot.facilities.find((f) => f.id === facilityId);
  const detail = useQuery({
    queryKey: [
      ...qk.facility(careerId, facilityId),
      JSON.stringify(live?.upgrades ?? []),
      snapshot.career.level,
      // promotion offer + upgrade caps follow the status and the type of the facility
      live?.status,
      live?.typeCode,
      live?.promotion?.completeAt ?? null,
    ],
    // FacilityDetailV2Dto = FacilityDetailDto + `promotionOffer`
    queryFn: () => facilitiesApi.detail(careerId, facilityId),
  });
  const buy = useMutation({
    mutationFn: (code: string) => gameApi.buyUpgrade(careerId, facilityId, code),
    onSuccess: () => {
      toast({ tone: 'success', title: t('upgradeStarted') });
      void qc.invalidateQueries({ queryKey: qk.facility(careerId, facilityId) });
    },
    onError: (e, code) => {
      if (isApiError(e, 'INSUFFICIENT_CREDITS'))
        requestCredits(detail.data?.availableUpgrades.find((u) => u.code === code)?.price ?? '0');
      else toast({ tone: 'danger', title: errorMessage(e) });
    },
  });
  if (!live) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="facility-detail">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <FamilyBadge family={live.family} size={44} title={name('facility', live.typeCode)} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display truncate text-xl font-bold" title={live.name}>
              {live.name}
            </h2>
            <p
              className="text-muted truncate text-sm"
              title={`${name('facility', live.typeCode)}${detail.data?.address ? ` · ${detail.data.address}` : ''}`}
            >
              {name('facility', live.typeCode)}
              {detail.data?.address ? ` · ${detail.data.address}` : ''}
            </p>
          </div>
          <StatusChip status={live.status} label={ts(live.status)} />
        </div>
        <ConstructionBanner facility={live} className="mt-4" />
        <div className="mt-4">
          <FacilitySummary facility={live} />
        </div>
      </Card>
      <Card>
        <SectionTitle>{t('upgrades')}</SectionTitle>
        <p className="text-muted -mt-1 mb-3 text-xs">
          {live.status === 'UNDER_CONSTRUCTION'
            ? tfa('upgradesAfterConstruction')
            : tfa('capsHint', { type: name('facility', live.typeCode) })}
        </p>
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
                  {/* An upgrade with no capacity domain (TRAINING_ROOM) sends delta 0: its value is in the
                      description above, so the "+0 <domain>" line would only be misleading. */}
                  {u.effect.delta !== 0 ? (
                    <p className="text-info text-xs">
                      +{u.effect.delta} {tf(`domain.${u.effect.domain}` as never)}
                    </p>
                  ) : null}
                  {building ? (
                    <p className="text-warning flex items-center gap-2 text-xs">
                      <Hammer className="size-3.5" aria-hidden />
                      {t('building')} <Countdown to={building} doneLabel="…" />
                      <SpeedupButton
                        target="FACILITY_UPGRADE"
                        targetId={`${facilityId}:${u.code}`}
                        endsAt={building}
                        size="sm"
                        className="ml-auto"
                      />
                    </p>
                  ) : u.lockedReason === 'LEVEL_TOO_LOW' ? (
                    <p className="text-subtle flex items-center gap-1.5 text-xs">
                      <Lock className="size-3.5" aria-hidden />
                      {tc('requiresLevel', { level: u.requiredLevel })}
                    </p>
                  ) : u.lockedReason === 'MAX_LEVEL' ? (
                    <p className="text-subtle text-xs">{t('maxLevel')}</p>
                  ) : u.lockedReason === 'FACILITY_NOT_OPERATIONAL' ? (
                    <p className="text-subtle flex items-center gap-1.5 text-xs">
                      <Lock className="size-3.5" aria-hidden />
                      {tfa('notOperational')}
                    </p>
                  ) : (
                    <Button
                      variant={tooPoor ? 'outline' : 'secondary'}
                      size="sm"
                      className="justify-between"
                      loading={buy.isPending && buy.variables === u.code}
                      onClick={() => (tooPoor ? requestCredits(u.price) : buy.mutate(u.code))}
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
      <PromotionCard facility={live} offer={detail.data?.promotionOffer} />
      <FacilityPersonnelSection facility={live} />
      <FacilityStockSection facility={live} />
    </div>
  );
}
