'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Fuel, Hammer, Lock, MapPin, MapPinPlus, Truck } from 'lucide-react';
import type { FacilityFamily, IncidentDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { facilitiesApi } from '@/lib/api/depth';
import { qk } from '@/lib/api/query-keys';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { compareAmount, formatClock, formatTime } from '@/lib/format';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useIsDesktop, useOperationsLayout } from '@/hooks/use-media-query';
import { movementPoint } from '@/lib/geo';
import { incidentScene } from '@/features/water/water';
import { WaterBodyBadge, useIncidentPlace } from '@/features/water/incident-water';
import { LegacyBoatChip, NauticalFacilityCard } from '@/features/water/nautical';
import { serverNow } from '@/lib/clock';
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
import { AlliedSupportLine } from '@/features/alliance/aid-incident';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SpeedupButton } from '@/features/monetization/speedup-button';
import { FacilityPersonnelSection } from '@/features/personnel/slots';
import { FacilityStockSection } from '@/features/logistics/slots';
import { SEVERITY_ORDER, useCareerId, useSnapshot, useVehicleTypeLookup } from './hooks';
import { FacilitySummary } from './inspectors';
import { requestCredits } from '@/features/monetization/insufficient-credits';
import { ConstructionBanner, PromotionCard } from '@/features/facilities/facility-extras';
import { NEW_FACILITY_ANCHOR, NewFacilitySection } from '@/features/facilities/new-facility-section';
import { TransferVehicleButton } from '@/features/facilities/transfer-vehicle';
import { useFamilyLabel } from '@/features/facilities/site-details';
import { IncidentFamilies } from '@/features/families/family-chips';
import { SectionHelpButton, SectionPrimer } from '@/features/coaching/section-primer';
import { isAutonomyTracked, needsResupply } from '@/features/autonomy/autonomy';
import { AutonomyChip } from '@/features/autonomy/gauge';
import { PageBody } from './shell';

/* ───────────────────────────── incidents ───────────────────────────── */
/**
 * "Tutte le emergenze". Desktop: the full sortable table (reached from the queue column's header). Phones and tablets
 * have no separate page any more (D-34): the address still works — shortcuts, notifications, old links — and opens
 * the map with the list itself expanded (full-height sheet on phones, the side panel on tablets).
 */
export function IncidentsScreen() {
  const layout = useOperationsLayout();
  const router = useRouter();
  React.useEffect(() => {
    if (layout === 'desktop') return;
    useUiStore.getState().showQueue(layout === 'phone' ? 'full' : 'peek');
    router.replace('/game');
  }, [layout, router]);
  return layout === 'desktop' ? <IncidentsTable /> : null;
}

function IncidentsTable() {
  const t = useTranslations('game.incidentsPage');
  const ti = useTranslations('game.incident');
  const tfam = useTranslations('families.queue');
  const ts = useTranslations('status.incident');
  const tx = useI18nText();
  const placeOf = useIncidentPlace();
  const locale = useLocale();
  const router = useRouter();
  const { incidents, career } = useSnapshot();
  const select = useUiStore((s) => s.select);
  const open = (i: IncidentDto) => {
    select({ kind: 'incident', id: i.id }, { focus: incidentScene(i) });
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
        <span className="text-muted flex min-w-0 items-center gap-1.5" title={placeOf(i)}>
          <WaterBodyBadge incident={i} compact />
          <span className="truncate">{placeOf(i)}</span>
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
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={rows}
        rowKey={(i) => i.id}
        onRowClick={open}
        maxHeight="calc(100dvh - 220px)"
        empty={<EmptyState title={t('empty')} />}
      />
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
  const ta = useTranslations('autonomy.fleet');
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
  // "Da rifornire" (D-22 §3.4): a toggle on top of the status tabs (it is another axis), shown only once the onboard
  // stock or the fuel is unlocked for this career.
  const [resupplyOnly, setResupplyOnly] = React.useState(false);
  const autonomyOn = vehicles.some((v) => isAutonomyTracked(v.autonomy));
  const toResupply = vehicles.filter(needsResupply).length;
  const rows = vehicles.filter(
    (v) =>
      (filter === 'all' || (filter === 'available' ? v.status === 'AVAILABLE' : v.status !== 'AVAILABLE')) &&
      (!resupplyOnly || !autonomyOn || needsResupply(v)),
  );
  const open = (v: VehicleDto) => {
    // A moving vehicle is centred where it IS now, not on its last stored position (03 §3 #4).
    const position = v.movement ? movementPoint(v.movement, serverNow()).position : v.position;
    select({ kind: 'vehicle', id: v.id }, { focus: position });
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
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-muted truncate" title={typeName(v)}>
            {typeName(v)}
          </span>
          <LegacyBoatChip vehicle={v} className="shrink-0" />
        </span>
      ),
      sortValue: typeName,
    },
    {
      id: 'status',
      header: t('col.status'),
      width: '170px',
      cell: (v) => (
        <span className="flex flex-col gap-0.5">
          <StatusChip status={v.status} label={ts(v.status)} />
          <AlliedSupportLine vehicle={v} />
        </span>
      ),
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
    ...(autonomyOn
      ? [
          {
            id: 'autonomy',
            header: ta('column'),
            width: '150px',
            cell: (v: VehicleDto) =>
              isAutonomyTracked(v.autonomy) ? <AutonomyChip autonomy={v.autonomy} /> : '—',
            sortValue: (v: VehicleDto) =>
              v.autonomy?.needsResupply ? -1 : (v.autonomy?.missionsLeftEstimate ?? Number.MAX_SAFE_INTEGER),
          } satisfies Column<VehicleDto>,
        ]
      : []),
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
      help={
        <SectionHelpButton content={fleetContent} label={tco('help.buttonLabel')} closeLabel={tc('close')} />
      }
      actions={
        <>
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
      {autonomyOn ? (
        <div>
          <button
            type="button"
            aria-pressed={resupplyOnly}
            onClick={() => setResupplyOnly((on) => !on)}
            className={cn(
              'flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold lg:h-9',
              resupplyOnly
                ? 'border-focus bg-surface-3 text-fg'
                : 'border-border text-muted hover:bg-surface-3',
            )}
            data-testid="fleet-filter-resupply"
            data-count={toResupply}
          >
            <Fuel className="size-4" aria-hidden />
            {ta('filter')}
            <span
              className={cn(
                'tabular grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs',
                toResupply > 0 ? 'bg-warning/20 text-warning' : 'bg-surface-3 text-muted',
              )}
            >
              {toResupply}
            </span>
          </button>
        </div>
      ) : null}
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
                  <LegacyBoatChip vehicle={v} className="mt-1" />
                  {isAutonomyTracked(v.autonomy) ? (
                    <AutonomyChip autonomy={v.autonomy} className="mt-1" />
                  ) : null}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <StatusChip status={v.status} label={ts(v.status)} />
                  <AlliedSupportLine vehicle={v} className="justify-end text-right" />
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
  const tmap = useTranslations('facilities.map');
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
      help={
        <SectionHelpButton
          content={facilitiesContent}
          label={tco('help.buttonLabel')}
          closeLabel={tc('close')}
        />
      }
      actions={
        <>
          {/* Acquiring a facility is a management action: its entry point lives here now, not on the map (03 §2.2). */}
          <Button
            variant="secondary"
            className="h-11 lg:h-10"
            onClick={() =>
              document
                .getElementById(NEW_FACILITY_ANCHOR)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            data-testid="new-facility-jump"
          >
            <MapPinPlus className="size-4" aria-hidden />
            {tmap('newFacility')}
          </Button>
        </>
      }
    >
      <SectionPrimer content={facilitiesContent} />
      {/* minmax(0, …): a single implicit column sized to its content pushed the detail card past a phone's edge. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
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
                    'flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold lg:h-9',
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
  const router = useRouter();
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
        <div className="flex items-start gap-3">
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
            {/* Under the name, not beside it: beside it the chip was cut off on phones (03 §2.6). */}
            <StatusChip status={live.status} label={ts(live.status)} className="mt-1.5" />
          </div>
        </div>
        {/* Back to this facility on the map (03 §3 #5): selected, centred, its inspector open. */}
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 h-11 lg:h-9"
          onClick={() => {
            useUiStore.getState().select({ kind: 'facility', id: live.id }, { focus: live.position });
            router.push('/game');
          }}
          data-testid="facility-show-on-map"
        >
          <MapPin className="size-4" aria-hidden />
          {tfa('showOnMap')}
        </Button>
        <ConstructionBanner facility={live} className="mt-4" />
        <div className="mt-4">
          <FacilitySummary facility={live} />
        </div>
        {/* A Base nautica (D-23): its water, its berths and how its boats reach the incidents. */}
        <div className="mt-4 empty:hidden">
          <NauticalFacilityCard facility={live} />
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
                      className="h-11 justify-between lg:h-8"
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
