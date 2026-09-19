'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Crosshair, MapPin, Undo2, Users, X, Wrench } from 'lucide-react';
import type { FacilityDto, IncidentDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { formatDistance, formatTime } from '@/lib/format';
import { movementProgress, pointAlong } from '@/lib/geo';
import { serverNow } from '@/lib/clock';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useI18nText } from '@/i18n/use-i18n-text';
import {
  FamilyBadge,
  GameIcon,
  TopdownGlyph,
  capabilityIconName,
  categoryIconName,
  isVehicleClass,
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
import { useServerNow } from '@/hooks/use-server-now';
import { useCareerId, useSnapshot, useVehicleTypeLookup } from './hooks';
import { DispatchPanel, RequirementBars } from './dispatch-panel';

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
          <h2 className="font-display truncate text-lg leading-tight font-bold" data-testid="inspector-title">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-muted mt-0.5 flex items-center gap-1 truncate text-xs">
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
            <GameIcon name={categoryIconName(incident.category)} size={22} />
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
            {incident.families.map((f) => (
              <FamilyBadge key={f} family={f} size={22} title={tx({ key: `catalog.family.${f}` })} />
            ))}
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
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{v.callSign}</span>
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
            <DispatchPanel incident={incident} />
          </TabsContent>
          <TabsContent value="details" className="flex flex-col gap-5 p-4">
            <div>
              <SectionTitle>{t('report')}</SectionTitle>
              <p
                className="border-border bg-surface-2 text-fg rounded-md border p-3 text-sm leading-relaxed"
                data-testid="incident-report"
              >
                “{tx(incident.report)}”
              </p>
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

export function VehicleInspector({ vehicle }: { vehicle: VehicleDto }) {
  const careerId = useCareerId();
  const t = useTranslations('game.vehicle');
  const tc = useTranslations('common');
  const ts = useTranslations('status.vehicle');
  const th = useTranslations('status.health');
  const tx = useI18nText();
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const { facilities, incidents } = useSnapshot();
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
            vehicleClass={type && isVehicleClass(type.icon) ? type.icon : 'truck'}
            family={vehicle.family}
            size={40}
          />
        }
        title={vehicle.callSign}
        subtitle={facility?.name}
        onFocus={() => focusOn(currentPosition(), 15)}
        badges={
          <>
            <StatusChip status={vehicle.status} label={ts(vehicle.status)} />
            <Badge>{type ? tx(type.name) : vehicle.typeCode}</Badge>
            {vehicle.movement ? (
              <Eta
                arriveAt={vehicle.movement.arriveAt}
                label={tc('eta')}
                doneLabel={tc('arriving')}
                className="ml-auto text-sm"
              />
            ) : null}
          </>
        }
      />
      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-5 p-4">
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
            {vehicle.capabilities.map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-xs">
                <GameIcon name={capabilityIconName(c.code)} size={16} className="text-muted" />
                <span className="min-w-0 flex-1 truncate">{tx({ key: `catalog.capability.${c.code}` })}</span>
                <ProgressBar value={c.value / 100} label={c.code} tone="info" className="w-24" />
                <span className="tabular text-muted w-7 text-right">{c.value}</span>
              </li>
            ))}
          </ul>
        </div>
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
              <li key={c.domain} className="flex items-center gap-3 text-xs">
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
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{v.callSign}</span>
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
  const tx = useI18nText();
  const focusOn = useUiStore((s) => s.focusOn);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="facility-inspector">
      <InspectorHeader
        icon={<FamilyBadge family={facility.family} size={40} />}
        title={facility.name}
        subtitle={tx({ key: `catalog.facility.${facility.typeCode}.name` })}
        onFocus={() => focusOn(facility.position, 15)}
        badges={<StatusChip status={facility.status} label={ts(facility.status)} />}
      />
      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-5 p-4">
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
  const entity = !selection
    ? null
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
  if (selection.kind === 'incident') return <IncidentInspector incident={entity as IncidentDto} />;
  if (selection.kind === 'vehicle') return <VehicleInspector vehicle={entity as VehicleDto} />;
  return <FacilityInspector facility={entity as FacilityDto} />;
}
