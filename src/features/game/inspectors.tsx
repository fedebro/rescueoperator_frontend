'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Anchor,
  Crosshair,
  Hammer,
  Info,
  MapPin,
  Package,
  Plane,
  Radar,
  Radio,
  Truck,
  Undo2,
  Users,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react';
import type { FacilityDto, IncidentDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { formatDistance, formatTime } from '@/lib/format';
import { movementProgress, pointAlong } from '@/lib/geo';
import { serverNow } from '@/lib/clock';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import {
  FamilyBadge,
  GameIcon,
  TopdownGlyph,
  capabilityIconName,
  categoryIconName,
  vehicleClassOf,
} from '@/design/icons';
import { Button, IconButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Countdown, Eta } from '@/components/ui/countdown';
import { CreditAmount } from '@/components/ui/credit-amount';
import { ProgressBar, SectionTitle, Skeleton, Stat, EmptyState } from '@/components/ui/misc';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { StatusChip } from '@/components/ui/status-chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Timeline } from '@/components/ui/timeline';
import { Tooltip } from '@/components/ui/tooltip';
import { useServerNow } from '@/hooks/use-server-now';
import { useCareerId, useSnapshot, useVehicleTypeLookup } from './hooks';
import { DispatchPanel, RequirementBars } from './dispatch-panel';
import { IncidentExternalSupport } from '@/features/families/external-support';
import { IncidentFamilies } from '@/features/families/family-chips';
import { RequirementAttribution } from '@/features/families/requirement-attribution';
import { ConstructionBanner } from '@/features/facilities/facility-extras';
import { TransferVehicleButton } from '@/features/facilities/transfer-vehicle';
import { SiteInspector } from '@/features/facilities/map-overlay';
import { IncidentPatients } from '@/features/medical/incident-patients';
import { WaterSourcePanel } from '@/features/water/water-source-panel';
import { HospitalInspector } from '@/features/medical/map-overlay';
import { VehicleCrewSection } from '@/features/personnel/slots';
import { VehicleMaintenanceSection } from '@/features/logistics/slots';
import { SpeedupButton } from '@/features/monetization/speedup-button';

function InspectorHeader({
  icon,
  title,
  subtitle,
  badges,
  onFocus,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  onFocus?: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations('game.inspector');
  const clear = useUiStore((s) => s.clearSelection);
  return (
    <header className="border-border shrink-0 border-b px-4 pt-1 pb-3 lg:pt-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2
            className="font-display truncate text-lg leading-tight font-bold"
            data-testid="inspector-title"
            title={title}
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="text-muted mt-0.5 flex items-center gap-1 truncate text-xs" title={subtitle}>
              <MapPin className="size-3 shrink-0" aria-hidden />
              {subtitle}
            </p>
          ) : null}
        </div>
        {onFocus ? (
          <IconButton label={t('centerOnMap')} size="sm" onClick={onFocus}>
            <Crosshair className="size-4" aria-hidden />
          </IconButton>
        ) : null}
        <IconButton label={t('close')} size="sm" onClick={clear} data-testid="inspector-close">
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
      {badges ? <div className="mt-2 flex flex-wrap items-center gap-2">{badges}</div> : null}
      {children}
    </header>
  );
}

function WorkProgress({ incident }: { incident: IncidentDto }) {
  const t = useTranslations('game.incident');
  const now = useServerNow(1000, incident.work.ratePerSecond > 0);
  const elapsed = Math.max(0, (now - Date.parse(incident.work.anchorAt)) / 1000);
  // Anchored work model: remaining = max(0, remaining − rate × (now − anchor)). When an end time is known it is the better source.
  const end = incident.work.estimatedEndAt ? Date.parse(incident.work.estimatedEndAt) : null;
  const anchor = Date.parse(incident.work.anchorAt);
  const remaining =
    end && end > anchor
      ? incident.work.remaining * Math.max(0, 1 - (now - anchor) / (end - anchor))
      : Math.max(0, incident.work.remaining - incident.work.ratePerSecond * elapsed);
  const done = incident.work.total > 0 ? 1 - remaining / incident.work.total : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted font-semibold">{t('work')}</span>
        {incident.work.estimatedEndAt ? (
          <Eta arriveAt={incident.work.estimatedEndAt} label={t('endsIn')} doneLabel={t('closing')} />
        ) : (
          <span className="text-subtle">{t('workWaiting')}</span>
        )}
      </div>
      <ProgressBar value={done} label={t('work')} tone="info" showValue />
    </div>
  );
}

export function IncidentInspector({ incident }: { incident: IncidentDto }) {
  const careerId = useCareerId();
  const t = useTranslations('game.incident');
  const tc = useTranslations('common');
  const ts = useTranslations('status.incident');
  const tsv = useTranslations('status.vehicle');
  const tf = useTranslations('families');
  const tx = useI18nText();
  const locale = useLocale();
  const { vehicles, career } = useSnapshot();
  const focusOn = useUiStore((s) => s.focusOn);
  const select = useUiStore((s) => s.select);
  const [tab, setTab] = React.useState('dispatch');
  const assigned = vehicles.filter(
    (v) => incident.assignedVehicleIds.includes(v.id) || v.incidentId === incident.id,
  );
  const timeline = useQuery({
    queryKey: [...qk.timeline(careerId, incident.id), incident.status, assigned.map((v) => v.status).join()],
    queryFn: () => gameApi.timeline(careerId, incident.id),
    enabled: tab === 'timeline',
  });

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="incident-inspector"
      data-incident-status={incident.status}
    >
      <InspectorHeader
        icon={
          <span className="bg-surface-3 grid size-10 place-items-center rounded-md">
            <GameIcon name={categoryIconName(incident.category, incident.icon)} size={22} />
          </span>
        }
        title={tx(incident.title)}
        subtitle={incident.address}
        onFocus={() => focusOn(incident.position, 15)}
        badges={
          <>
            <SeverityBadge
              severity={incident.severity}
              label={t('severity')}
              escalating={incident.escalating}
            />
            <StatusChip status={incident.status} label={ts(incident.status)} />
            <IncidentFamilies incident={incident} />
            {incident.isTutorial ? <Badge tone="info">{t('tutorial')}</Badge> : null}
            {incident.status === 'PENDING_RESPONSE' && incident.expiresAt ? (
              <Countdown
                to={incident.expiresAt}
                urgentBelowSeconds={120}
                className="text-muted ml-auto text-xs"
                prefix={<span>{t('expiresIn')}</span>}
              />
            ) : (
              <Countdown
                to={incident.createdAt}
                elapsed
                className="text-subtle ml-auto text-xs"
                prefix={<span>{t('elapsed')}</span>}
              />
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="dispatch">{t('tabs.dispatch')}</TabsTrigger>
          <TabsTrigger value="details">{t('tabs.details')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('tabs.timeline')}</TabsTrigger>
        </TabsList>
        <div className="scroll-y min-h-0 flex-1">
          <TabsContent value="dispatch">
            {assigned.length > 0 ? (
              <div className="border-border flex flex-col gap-3 border-b p-4">
                {incident.status === 'ON_SCENE' || incident.work.ratePerSecond > 0 ? (
                  <WorkProgress incident={incident} />
                ) : null}
                <div>
                  <SectionTitle>{t('assigned')}</SectionTitle>
                  <ul className="flex flex-col gap-1.5">
                    {assigned.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          className="border-border bg-surface-2 hover:bg-surface-3 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left"
                          onClick={() => select({ kind: 'vehicle', id: v.id })}
                          data-testid="assigned-vehicle"
                          data-vehicle-status={v.status}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={v.callSign}>
                            {v.callSign}
                          </span>
                          <StatusChip status={v.status} label={tsv(v.status)} />
                          {v.movement ? (
                            <Eta
                              arriveAt={v.movement.arriveAt}
                              label={tc('eta')}
                              doneLabel={tc('arriving')}
                              className="text-sm"
                            />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
            <IncidentExternalSupport incident={incident} />
            <WaterSourcePanel incident={incident} />
            <IncidentPatients incident={incident} />
            {incident.status === 'RESOLVING' ? null : <DispatchPanel incident={incident} />}
          </TabsContent>
          <TabsContent value="details" className="flex flex-col gap-5 p-4">
            <div>
              <SectionTitle>{t('report')}</SectionTitle>
              {incident.summary ? (
                <p className="text-muted mb-2 text-sm" data-testid="incident-summary">
                  {tx(incident.summary)}
                </p>
              ) : null}
              <p
                className="border-border bg-surface-2 text-fg rounded-md border p-3 text-sm leading-relaxed"
                data-testid="incident-report"
              >
                “{tx(incident.report)}”
              </p>
              {incident.radio ? (
                <p
                  className="border-border text-muted mt-2 flex items-start gap-2 rounded-md border border-dashed p-3 font-mono text-xs leading-relaxed"
                  data-testid="incident-radio"
                >
                  <Radio className="text-info mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    <span className="sr-only">{tf('radio')}: </span>
                    {tx(incident.radio)}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t('received')} value={formatTime(incident.createdAt, locale, career.timezone)} />
              <Stat label={t('patients')} value={incident.patientCount} />
              <div className="col-span-2 flex flex-col">
                <span className="text-subtle text-[11px] font-semibold tracking-wide uppercase">
                  {t('estimatedReward')}
                </span>
                <span className="flex items-center gap-1.5">
                  <CreditAmount value={incident.estimatedReward.min} label={tc('credits')} />
                  <span className="text-subtle">–</span>
                  <CreditAmount value={incident.estimatedReward.max} label={tc('credits')} />
                </span>
              </div>
            </div>
            <div>
              <SectionTitle>{t('requirements')}</SectionTitle>
              <RequirementBars incident={incident} />
            </div>
            <div>
              <SectionTitle>{tf('attribution.title')}</SectionTitle>
              <RequirementAttribution incident={incident} />
            </div>
          </TabsContent>
          <TabsContent value="timeline" className="p-4">
            {timeline.isLoading ? (
              <Skeleton className="h-24" />
            ) : (timeline.data ?? []).length === 0 ? (
              <EmptyState title={t('timelineEmpty')} />
            ) : (
              <Timeline
                label={t('tabs.timeline')}
                items={(timeline.data ?? []).map((e) => ({
                  id: e.id,
                  time: formatTime(e.at, locale, career.timezone),
                  title: tx(e.text),
                  tone: e.type.includes('arrived')
                    ? 'info'
                    : e.type.includes('resolved')
                      ? 'success'
                      : e.type.includes('escalated')
                        ? 'warning'
                        : 'neutral',
                }))}
              />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/** The owner's three (analisi/note-agenti/police-patrol.md): presence assets, never a call-out-only unit. */
const PATROL_TYPE_CODES = new Set(['POL_PATROL', 'POL_MOTO', 'POL_TRAFFIC']);

export function VehicleInspector({ vehicle }: { vehicle: VehicleDto }) {
  const careerId = useCareerId();
  const t = useTranslations('game.vehicle');
  const tc = useTranslations('common');
  const ts = useTranslations('status.vehicle');
  const th = useTranslations('status.health');
  const tx = useI18nText();
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const { facilities, incidents, featureFlags } = useSnapshot();
  const type = useVehicleTypeLookup()(vehicle.typeCode);
  const focusOn = useUiStore((s) => s.focusOn);
  const select = useUiStore((s) => s.select);
  const facility = facilities.find((f) => f.id === vehicle.facilityId);
  const incident = incidents.find((i) => i.id === vehicle.incidentId);
  const recallable = ['PREPARING', 'EN_ROUTE', 'ON_SCENE'].includes(vehicle.status);
  const recall = useMutation({
    mutationFn: () => gameApi.recallVehicle(careerId, vehicle.id),
    onSuccess: () => toast({ tone: 'info', title: t('recalled', { callSign: vehicle.callSign }) }),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const patrolling = vehicle.movement?.purpose === 'PATROLLING';
  // Still a plain AVAILABLE vehicle underneath (Option B: no state-machine change) — the toggle only offers to START
  // when nothing else is going on, and offers to STOP whenever the vehicle is actually out patrolling.
  const patrolEligible =
    featureFlags.police_patrol === true &&
    PATROL_TYPE_CODES.has(vehicle.typeCode) &&
    (vehicle.status === 'AVAILABLE' || patrolling);
  const startPatrol = useMutation({
    mutationFn: () => gameApi.startPatrol(careerId, vehicle.id),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const stopPatrol = useMutation({
    mutationFn: () => gameApi.stopPatrol(careerId, vehicle.id),
    onSuccess: () => toast({ tone: 'info', title: t('patrol.stopping', { callSign: vehicle.callSign }) }),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
  });
  const currentPosition = () =>
    vehicle.movement
      ? pointAlong(vehicle.movement.path, movementProgress(vehicle.movement, serverNow())).position
      : vehicle.position;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="vehicle-inspector"
      data-vehicle-status={vehicle.status}
    >
      <InspectorHeader
        icon={
          <TopdownGlyph
            vehicleClass={vehicleClassOf(type?.icon)}
            family={vehicle.family}
            size={40}
            title={type ? tx(type.name) : vehicle.typeCode}
          />
        }
        title={vehicle.callSign}
        subtitle={facility?.name}
        onFocus={() => focusOn(currentPosition(), 15)}
        badges={
          <>
            <StatusChip
              status={vehicle.status}
              label={patrolling ? t('patrol.onPatrol') : ts(vehicle.status)}
            />
            <Badge>{type ? tx(type.name) : vehicle.typeCode}</Badge>
            {vehicle.movement ? (
              <Eta
                arriveAt={vehicle.movement.arriveAt}
                label={tc('eta')}
                doneLabel={tc('arriving')}
                className="ml-auto text-sm"
              />
            ) : vehicle.status === 'IN_DELIVERY' && vehicle.busyUntil ? (
              <span className="ml-auto flex items-center gap-2 text-sm">
                <Countdown to={vehicle.busyUntil} doneLabel="…" />
                <SpeedupButton
                  target="VEHICLE_DELIVERY"
                  targetId={vehicle.id}
                  endsAt={vehicle.busyUntil}
                  size="sm"
                />
              </span>
            ) : null}
          </>
        }
      />
      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-5 p-4">
        {type?.description ? (
          <p className="text-muted text-sm" data-testid="vehicle-description">
            {tx(type.description)}
          </p>
        ) : null}
        {recallable ? (
          <Button
            variant="danger"
            size="lg"
            className="w-full"
            onClick={() => recall.mutate()}
            loading={recall.isPending}
            data-testid="recall-vehicle"
          >
            <Undo2 className="size-4" aria-hidden />
            {t('recall')}
          </Button>
        ) : null}
        {patrolEligible ? (
          <Button
            variant={patrolling ? 'secondary' : 'primary'}
            size="lg"
            className="w-full"
            onClick={() => (patrolling ? stopPatrol.mutate() : startPatrol.mutate())}
            loading={patrolling ? stopPatrol.isPending : startPatrol.isPending}
            data-testid="toggle-patrol"
          >
            <Radar className="size-4" aria-hidden />
            {patrolling ? t('patrol.stop') : t('patrol.start')}
          </Button>
        ) : null}
        {vehicle.movement ? (
          <div>
            <SectionTitle>{t('movement')}</SectionTitle>
            <div className="border-border bg-surface-2 grid grid-cols-2 gap-3 rounded-md border p-3">
              <Stat
                label={t('purpose')}
                value={<span className="font-sans text-sm">{t(`purposes.${vehicle.movement.purpose}`)}</span>}
              />
              <Stat label={t('distance')} value={formatDistance(vehicle.movement.distanceMeters, locale)} />
              <MovementProgress vehicle={vehicle} />
            </div>
          </div>
        ) : null}
        {incident ? (
          <Button
            variant="secondary"
            onClick={() => select({ kind: 'incident', id: incident.id }, { focus: incident.position })}
          >
            {t('openIncident')}: {tx(incident.title)}
          </Button>
        ) : null}
        <div>
          <SectionTitle>{t('capabilities')}</SectionTitle>
          <ul className="flex flex-col gap-2">
            {vehicle.capabilities.map((c) => {
              const capabilityName = tx({ key: `catalog.capability.${c.code}` });
              return (
                <li key={c.code} className="flex items-center gap-2 text-xs">
                  <GameIcon name={capabilityIconName(c.code)} size={16} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate" title={capabilityName}>
                    {capabilityName}
                  </span>
                  <Tooltip content={tx({ key: `catalog.capabilityHelp.${c.code}` })}>
                    <button
                      type="button"
                      className="text-subtle hover:text-fg shrink-0"
                      aria-label={t('capabilityInfo', { capability: capabilityName })}
                      data-testid="capability-info"
                    >
                      <Info className="size-3.5" aria-hidden />
                    </button>
                  </Tooltip>
                  <ProgressBar value={c.value / 100} label={capabilityName} tone="info" className="w-24" />
                  <span className="tabular text-muted w-7 text-right">{c.value}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <VehicleCrewSection vehicle={vehicle} />
        <VehicleMaintenanceSection vehicle={vehicle} />
        <TransferVehicleButton vehicle={vehicle} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <SectionTitle>{t('health')}</SectionTitle>
            <div className="flex items-center gap-2">
              <Wrench className="text-muted size-4" aria-hidden />
              <span className="text-sm font-semibold">{th(vehicle.healthBand)}</span>
            </div>
            <ProgressBar
              value={vehicle.health / 100}
              label={t('health')}
              tone={vehicle.health > 60 ? 'success' : 'warning'}
              className="mt-1.5"
              showValue
            />
          </div>
          <div>
            <SectionTitle>{t('crew')}</SectionTitle>
            <div className="flex items-center gap-2">
              <Users className="text-muted size-4" aria-hidden />
              <span className="tabular text-sm font-semibold">
                {vehicle.crew.assigned}/{vehicle.crew.optimal}
              </span>
            </div>
            <p className="text-subtle mt-1 text-xs">{t('crewMin', { min: vehicle.crew.min })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MovementProgress({ vehicle }: { vehicle: VehicleDto }) {
  const t = useTranslations('game.vehicle');
  const now = useServerNow(1000);
  if (!vehicle.movement) return null;
  return (
    <div className="col-span-2">
      <ProgressBar value={movementProgress(vehicle.movement, now)} label={t('movement')} tone="warning" />
    </div>
  );
}

const DOMAIN_ICONS = {
  GROUND: Truck,
  AIR: Plane,
  WATER: Anchor,
  PERSONNEL: Users,
  STORAGE: Package,
  WORKSHOP: Wrench,
} as const;
function DomainIcon({ domain }: { domain: string }) {
  const Icon = DOMAIN_ICONS[domain as keyof typeof DOMAIN_ICONS] ?? Warehouse;
  return <Icon className="text-subtle size-3.5 shrink-0" aria-hidden />;
}

export function FacilitySummary({ facility, compact }: { facility: FacilityDto; compact?: boolean }) {
  const t = useTranslations('game.facility');
  const { vehicles } = useSnapshot();
  const based = vehicles.filter((v) => v.facilityId === facility.id);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionTitle>{t('capacities')}</SectionTitle>
        <ul className="flex flex-col gap-2">
          {facility.capacities
            .filter((c) => c.total > 0 || !compact)
            .map((c) => (
              <li
                key={c.domain}
                className="flex items-center gap-2 text-xs"
                data-testid="capacity-bar"
                data-domain={c.domain}
                data-used={c.used}
                data-total={c.total}
              >
                <DomainIcon domain={c.domain} />
                <span className="text-muted w-24 shrink-0 font-semibold">{t(`domain.${c.domain}`)}</span>
                <ProgressBar
                  value={c.total ? c.used / c.total : 0}
                  label={t(`domain.${c.domain}`)}
                  tone={c.used >= c.total ? 'warning' : 'info'}
                  className="flex-1"
                />
                <span className="tabular w-12 text-right">
                  {c.used}/{c.total}
                </span>
              </li>
            ))}
        </ul>
      </div>
      <div>
        <SectionTitle>{t('vehicles', { count: based.length })}</SectionTitle>
        <VehicleChips vehicles={based} />
      </div>
    </div>
  );
}

function VehicleChips({ vehicles }: { vehicles: VehicleDto[] }) {
  const ts = useTranslations('status.vehicle');
  const select = useUiStore((s) => s.select);
  return (
    <ul className="flex flex-col gap-1.5">
      {vehicles.map((v) => (
        <li key={v.id}>
          <button
            type="button"
            className="border-border bg-surface-2 hover:bg-surface-3 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left"
            onClick={() => select({ kind: 'vehicle', id: v.id })}
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={v.callSign}>
              {v.callSign}
            </span>
            <StatusChip status={v.status} label={ts(v.status)} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FacilityInspector({ facility }: { facility: FacilityDto }) {
  const t = useTranslations('game.facility');
  const ts = useTranslations('status.facility');
  const tp = useTranslations('facilities.promotion');
  const name = useCatalogName();
  const focusOn = useUiStore((s) => s.focusOn);
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="facility-inspector"
      data-facility-status={facility.status}
    >
      <InspectorHeader
        icon={<FamilyBadge family={facility.family} size={40} title={name('facility', facility.typeCode)} />}
        title={facility.name}
        subtitle={name('facility', facility.typeCode)}
        onFocus={() => focusOn(facility.position, 15)}
        badges={<StatusChip status={facility.status} label={ts(facility.status)} />}
      />
      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-5 p-4">
        <ConstructionBanner facility={facility} />
        {facility.promotion ? (
          <p className="text-warning flex flex-wrap items-center gap-2 text-sm" role="status">
            <Hammer className="size-4" aria-hidden />
            {tp('buildingTo', { type: name('facility', facility.promotion.toTypeCode) })}
            <Countdown to={facility.promotion.completeAt} doneLabel="…" />
            <SpeedupButton
              target="FACILITY_UPGRADE"
              targetId={facility.id}
              endsAt={facility.promotion.completeAt}
              size="sm"
              className="ml-auto"
            />
          </p>
        ) : null}
        <FacilitySummary facility={facility} compact />
        <Button asChild variant="secondary">
          <Link href={`/game/facilities?id=${facility.id}`}>{t('manage')}</Link>
        </Button>
      </div>
    </div>
  );
}

/** Renders the inspector for the current single selection (desktop right column / mobile sheet body). */
export function SelectionInspector() {
  const selection = useUiStore((s) => s.selection);
  const clear = useUiStore((s) => s.clearSelection);
  const { incidents, vehicles, facilities } = useSnapshot();
  // Hospitals and candidate sites are not part of the snapshot: their inspectors load their own data.
  const external = selection?.kind === 'hospital' || selection?.kind === 'site';
  const entity = !selection
    ? null
    : external
      ? selection
      : selection.kind === 'incident'
        ? incidents.find((i) => i.id === selection.id)
        : selection.kind === 'vehicle'
          ? vehicles.find((v) => v.id === selection.id)
          : facilities.find((f) => f.id === selection.id);
  // The selected entity can disappear (incident resolved): drop the selection instead of showing a ghost.
  React.useEffect(() => {
    if (selection && !entity) clear();
  }, [selection, entity, clear]);
  if (!selection || !entity) return null;
  if (selection.kind === 'hospital') return <HospitalInspector id={selection.id} />;
  if (selection.kind === 'site') return <SiteInspector id={selection.id} />;
  if (selection.kind === 'incident') return <IncidentInspector incident={entity as IncidentDto} />;
  if (selection.kind === 'vehicle') return <VehicleInspector vehicle={entity as VehicleDto} />;
  return <FacilityInspector facility={entity as FacilityDto} />;
}
