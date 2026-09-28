'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ChevronDown,
  LifeBuoy,
  MapPin,
  Radar,
  Send,
  Sparkles,
  Truck,
  Waves,
} from 'lucide-react';
import type { IncidentDto, ServiceFamily } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { isApiError, type ApiErrorCode } from '@/lib/api/errors';
import type { DispatchOptionsResult } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/api/error-message';
import { formatClock, formatDistance } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { soundEnabled, useSettingsStore } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { useServerNow } from '@/hooks/use-server-now';
import { useIsDesktop } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { FamilyBadge, GameIcon, TopdownGlyph, capabilityIconName, vehicleClassOf } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CapabilityBar } from '@/components/ui/capability-bar';
import { Checkbox } from '@/components/ui/switch';
import { FooterPortal } from '@/components/ui/footer-slot';
import { EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { StatusChip } from '@/components/ui/status-chip';
import { Countdown } from '@/components/ui/countdown';
import { DispatchCrewBlocked, DispatchCrewPreview, crewBlockOf } from '@/features/personnel/slots';
import { AUTONOMY_WARNINGS } from '@/features/autonomy/autonomy';
import {
  ChainFuelStop,
  DispatchAutonomyFlag,
  DispatchFlightNote,
  DispatchReloadNote,
} from '@/features/autonomy/dispatch-autonomy';
import { DispatchPatientCapacityNote } from '@/features/medical/mass-casualty';
import { WarningNextAction, warningNextAction } from '@/features/coaching/warning-next-action';
import { CoachMark } from '@/features/coaching/coach-mark';
import { useFamilyLabel } from '@/features/facilities/site-details';
import { DispatchWaterRoute } from '@/features/water/incident-water';
import { isWaterIncident, requirementsBySide } from '@/features/water/water';
import { useCareerId, useCatalog, useSnapshot, useVehicleTypeLookup } from './hooks';

type FamilyFilter = 'ALL' | ServiceFamily;

export function RequirementBars({
  incident,
  planned,
}: {
  incident: IncidentDto;
  planned?: Map<string, number>;
}) {
  const t = useTranslations('game.requirements');
  const tn = useTranslations('nautical.requirements');
  const tx = useI18nText();
  const catalog = useCatalog();
  const nameOf = (code: string) =>
    tx(catalog?.capabilities?.find((c) => c.code === code)?.name ?? { key: `catalog.capability.${code}` });
  const legend = {
    onScene: t('onScene'),
    enRoute: t('enRoute'),
    planned: t('planned'),
    required: t('required'),
  };
  const bar = (r: IncidentDto['requirements'][number]) =>
    // A need the Coast Guard covers (D-68) is not the player's: a line with who covers it, no bar to fill.
    r.externalSource === 'COAST_GUARD' ? (
      <div
        key={r.capability}
        className="flex items-center gap-2 text-xs"
        data-testid="requirement-coast-guard"
        data-capability={r.capability}
      >
        <span aria-hidden className="text-muted">
          <GameIcon name={capabilityIconName(r.capability)} size={16} />
        </span>
        <span className="text-fg min-w-0 flex-1 truncate font-semibold">{nameOf(r.capability)}</span>
        <Badge tone="info">
          <LifeBuoy className="size-3" aria-hidden />
          {tn('coastGuard')}
        </Badge>
      </div>
    ) : (
      <CapabilityBar
        key={r.capability}
        label={nameOf(r.capability)}
        icon={<GameIcon name={capabilityIconName(r.capability)} size={16} />}
        required={r.required}
        onScene={r.onScene}
        enRoute={r.enRoute}
        planned={planned?.get(r.capability) ?? 0}
        level={r.level}
        levelLabel={t(`level.${r.level}`)}
        legend={legend}
      />
    );
  // Water incidents (D-68): the needs served in the water (boats, aircraft — or the Coast Guard) apart from those served
  // on the shore, at the meeting point (land units).
  const sides = isWaterIncident(incident) ? requirementsBySide(incident.requirements) : null;
  return (
    <div className="flex flex-col gap-3">
      {sides
        ? (
            [
              ['WATER', sides.water, Waves],
              ['SHORE', sides.shore, MapPin],
            ] as const
          )
            .filter(([, list]) => list.length > 0)
            .map(([side, list, Icon]) => (
              <section
                key={side}
                className="flex flex-col gap-2.5"
                data-testid="requirement-side"
                data-side={side}
                aria-label={tn(side === 'WATER' ? 'water' : 'shore')}
              >
                <header className="flex items-baseline gap-2">
                  <Icon className="text-info size-4 shrink-0 self-center" aria-hidden />
                  <span className="text-fg text-xs font-bold tracking-wide uppercase">
                    {tn(side === 'WATER' ? 'water' : 'shore')}
                  </span>
                  <span className="text-subtle min-w-0 truncate text-xs">
                    {tn(side === 'WATER' ? 'waterHint' : 'shoreHint')}
                  </span>
                </header>
                {list.map(bar)}
              </section>
            ))
        : incident.requirements.map(bar)}
      <ul className="text-subtle flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-hidden>
        <li className="flex items-center gap-1">
          <span className="bg-success h-2 w-4 rounded-sm" />
          {legend.onScene}
        </li>
        <li className="flex items-center gap-1">
          <span
            className="h-2 w-4 rounded-sm"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, var(--rc-warning) 0 3px, transparent 3px 5px)',
            }}
          />
          {legend.enRoute}
        </li>
        <li className="flex items-center gap-1">
          <span className="border-info h-2 w-4 rounded-sm border border-dashed" />
          {legend.planned}
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-fg h-3 w-0.5" />
          {legend.required}
        </li>
      </ul>
    </div>
  );
}

/**
 * Coverage the incident would have with what is on scene, on the way and `planned` on top: the share of the REQUIRED
 * capability points met (all requirements when none is required) and the capabilities still short. Exported for tests.
 */
export function coverageForecast(
  incident: Pick<IncidentDto, 'requirements'>,
  planned: ReadonlyMap<string, number>,
): { percent: number; missing: string[] } {
  // Needs covered by external support (a locked family, the Coast Guard on the water) are not the player's to fill.
  const own = incident.requirements.filter((r) => !r.external);
  const required = own.filter((r) => r.level === 'REQUIRED');
  const pool = required.length > 0 ? required : own;
  let have = 0;
  let need = 0;
  const missing: string[] = [];
  for (const r of pool) {
    const covered = r.onScene + r.enRoute + (planned.get(r.capability) ?? 0);
    have += Math.min(covered, r.required);
    need += r.required;
    if (covered < r.required) missing.push(r.capability);
  }
  return { percent: need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 100, missing };
}

/**
 * One line instead of the old sticky block of bars (03 §2.4): "Copertura prevista 85% · manca: Sanitario", with the
 * full bars one tap away. Forecast = what the primary action would send (the manual pick once there is one).
 */
function RequirementSummary({
  incident,
  planned,
  defaultOpen,
}: {
  incident: IncidentDto;
  planned: Map<string, number>;
  defaultOpen: boolean;
}) {
  const t = useTranslations('game.requirements');
  const tx = useI18nText();
  const catalog = useCatalog();
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const { percent, missing } = coverageForecast(incident, planned);
  const nameOf = (code: string) =>
    tx(catalog?.capabilities?.find((c) => c.code === code)?.name ?? { key: `catalog.capability.${code}` });
  const list =
    missing.slice(0, 2).map(nameOf).join(', ') + (missing.length > 2 ? ` +${missing.length - 2}` : '');
  return (
    <div data-testid="coverage-summary" data-percent={percent} data-open={open}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 text-left text-sm"
        data-testid="coverage-toggle"
      >
        <span className="text-muted shrink-0">{t('forecast')}</span>
        <span
          className={cn(
            'tabular shrink-0 font-bold',
            percent >= 100 ? 'text-success' : percent >= 60 ? 'text-warning' : 'text-danger',
          )}
        >
          {percent}%
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-subtle" aria-hidden>
            ·{' '}
          </span>
          {missing.length > 0 ? (
            <span className="text-warning">{t('missing', { list })}</span>
          ) : (
            <span className="text-success">{t('covered')}</span>
          )}
        </span>
        <ChevronDown
          className={cn('text-muted size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
        <span className="sr-only">{open ? t('hideDetails') : t('showDetails')}</span>
      </button>
      {open ? (
        <div id={id} className="mt-2">
          <RequirementBars incident={incident} planned={planned} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Codes the dispatch command can still throw for a vehicle that `dispatch-options` marked `dispatchable: true`: the
 * options list checks each vehicle on its own, but crew and consumables are a shared pool per facility, so two
 * vehicles that each look sendable in isolation can still compete for the same operator or the same last box of
 * supplies once they are sent together — and conditions/incident/vehicle state can also simply move on between the
 * fetch and the click. Either way the option list is now stale: clear the manual pick and refetch it.
 */
const DISPATCH_STALE_CODES: ReadonlySet<ApiErrorCode> = new Set([
  'VEHICLE_NOT_AVAILABLE',
  'INCIDENT_NOT_DISPATCHABLE',
  'CREW_INSUFFICIENT',
  'CREW_UNQUALIFIED',
  'CREW_EXHAUSTED',
  'INVENTORY_INSUFFICIENT',
]);

/**
 * Blocks that describe what a vehicle *is* rather than what it is doing: a boat cannot be sent inland, an aircraft is
 * not launched for an incident it would contribute nothing to. Unlike a crew or stock block there is nothing to fix
 * and nothing to wait for, so the row shows the reason on its own, with no "how to fix it" link.
 */
const ELIGIBILITY_BLOCKS = [
  'VEHICLE_DOMAIN_MISMATCH',
  'AIR_SUPPORT_NOT_NEEDED',
  // Flight endurance: not even there and back with the reserve intact, a full tank included (air-endurance §1).
  'ENDURANCE_INSUFFICIENT',
] as const;
type EligibilityBlock = (typeof ELIGIBILITY_BLOCKS)[number];
export const eligibilityBlockOf = (
  option: DispatchOptionsResult['options'][number],
): EligibilityBlock | null => ELIGIBILITY_BLOCKS.find((code) => code === option.blockedReason) ?? null;

/** Reason line for a vehicle that is ineligible by nature; mirrors the crew block's wording and styling. */
function DispatchEligibilityBlock({
  option,
  incident,
  boat,
}: {
  option: DispatchOptionsResult['options'][number];
  incident: IncidentDto;
  /** The vehicle is a boat (a WATER-domain type). */
  boat: boolean;
}) {
  const t = useTranslations('game.dispatch.ineligible');
  const tn = useTranslations('nautical.dispatch');
  const block = eligibilityBlockOf(option);
  if (!block) return null;
  // The water scene (D-68) says exactly why: a boat never reaches a land incident; a land unit at a water incident only
  // works at the meeting point, for care, transport or security.
  const text =
    block === 'VEHICLE_DOMAIN_MISMATCH' && boat && !isWaterIncident(incident)
      ? tn('boatOnLand')
      : block === 'VEHICLE_DOMAIN_MISMATCH' && !boat && isWaterIncident(incident)
        ? tn('landAtWater')
        : t(block);
  return (
    <p
      className="text-danger mt-2 flex items-center gap-1 pl-[30px] text-xs font-semibold"
      role="status"
      data-testid="dispatch-ineligible"
      data-blocked={block}
    >
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

/**
 * A vehicle that isn't AVAILABLE but is on a mission or returning (`option.chain` present, see the contract's
 * `DispatchOption.chain` doc) can still be pointed at THIS incident: redirected immediately if it's RETURNING and
 * every chaining condition holds, otherwise queued as its next assignment once it frees up. One button either way —
 * the server decides which — mirroring the single `chain` endpoint it calls.
 */
function ChainAction({
  option,
  incidentId,
  now,
  onChain,
  onCancel,
  chaining,
  cancelling,
}: {
  option: DispatchOptionsResult['options'][number];
  incidentId: string;
  now: number;
  onChain: () => void;
  onCancel: () => void;
  chaining: boolean;
  cancelling: boolean;
}) {
  const t = useTranslations('game.dispatch.chain');
  const chain = option.chain;
  if (!chain) return null;
  const queuedHere = chain.queuedIncidentId === incidentId;
  const availableInSeconds = chain.availableAt
    ? Math.max(0, Math.round((Date.parse(chain.availableAt) - now) / 1000))
    : null;

  // 44 px on touch screens (03 §2.10), the compact 32 px only where there is a mouse.
  const size = 'h-11 lg:h-8';
  if (queuedHere)
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone="info">{t('queued')}</Badge>
        <Button size="sm" variant="ghost" className={size} onClick={onCancel} loading={cancelling}>
          {t('cancelQueue')}
        </Button>
      </div>
    );

  if (chain.redirectEligible)
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button size="sm" className={size} onClick={onChain} loading={chaining} data-testid="chain-redirect">
          {t('redirect')}
        </Button>
        {/* A redirect in reserve refuels at a pump on the way first: its seconds are already in the new ETA. */}
        {chain.fuelStop ? <ChainFuelStop fuelStop={chain.fuelStop} /> : null}
      </div>
    );

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        className={size}
        onClick={onChain}
        loading={chaining}
        data-testid="chain-queue"
      >
        {t('queue')}
      </Button>
      {chain.blockedReason ? (
        <span
          className="text-subtle text-right text-xs"
          data-testid="chain-reason"
          data-reason={chain.blockedReason}
        >
          {t.has(`reason.${chain.blockedReason}` as never)
            ? t(`reason.${chain.blockedReason}` as never)
            : chain.blockedReason}
        </span>
      ) : null}
      {/* "Free at" = back home + the resupply stop the rule predicts (or the end of the stop it is making). */}
      {availableInSeconds !== null ? (
        <span className="text-subtle text-xs" data-testid="chain-available-in">
          {t('availableIn', { time: formatClock(availableInSeconds) })}
        </span>
      ) : null}
      {chain.fuelStop ? <ChainFuelStop fuelStop={chain.fuelStop} /> : null}
    </div>
  );
}

/** Assisted but fully editable dispatch: one tap sends the recommended set, no confirmation step (Spec 05 §13). */
export function DispatchPanel({ incident }: { incident: IncidentDto }) {
  const careerId = useCareerId();
  const t = useTranslations('game.dispatch');
  const tv = useTranslations('game.vehicle');
  const ts = useTranslations('status.vehicle');
  const tw = useTranslations('game.dispatch.warning');
  const tci = useTranslations('coaching.marks.crewInsufficient');
  const tm = useTranslations('maxi.dispatch');
  const itemName = useCatalogName();
  /**
   * Warning codes are opaque strings; the stock ones carry the item code after a colon
   * (`STOCK_LOW:FIRE_FOAM`). An unknown code falls back to itself rather than throwing, so a server that learns a new
   * warning never breaks an old client.
   */
  const warningText = (code: string): string => {
    const [key, param] = code.split(':');
    if (param && tw.has(key as never))
      return (tw as unknown as (k: string, v: Record<string, string>) => string)(key!, {
        item: itemName('item', param),
      });
    return tw.has(code as never) ? tw(code as never) : code;
  };
  const tx = useI18nText();
  const locale = useLocale();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const now = useServerNow(1000);
  const desktop = useIsDesktop();
  const { vehicles, facilities } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const familyLabel = useFamilyLabel();
  const facilityNameOf = (facilityId: string): string =>
    facilities.find((f) => f.id === facilityId)?.name ?? '—';
  // Options depend on which vehicles are free: refetch whenever the fleet's status signature changes.
  const signature = vehicles.map((v) => `${v.id}:${v.status}`).join('|');
  const options = useQuery({
    queryKey: [...qk.dispatchOptions(careerId, incident.id), signature],
    queryFn: () => gameApi.dispatchOptions(careerId, incident.id),
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
  const [manual, setManual] = React.useState<Set<string> | null>(null);
  const [familyFilter, setFamilyFilter] = React.useState<FamilyFilter>('ALL');

  const data = options.data;
  const families = React.useMemo(() => {
    const set = new Set<ServiceFamily>();
    for (const o of data?.options ?? []) {
      const family = vehicles.find((v) => v.id === o.vehicleId)?.family;
      if (family) set.add(family);
    }
    return [...set];
  }, [data, vehicles]);
  const visibleOptions = React.useMemo(
    () =>
      (data?.options ?? []).filter(
        (o) => familyFilter === 'ALL' || vehicles.find((v) => v.id === o.vehicleId)?.family === familyFilter,
      ),
    [data, vehicles, familyFilter],
  );
  const recommended = React.useMemo(() => new Set(data?.recommendedVehicleIds ?? []), [data]);
  const dispatchable = React.useMemo(
    () => new Set((data?.options ?? []).filter((o) => o.dispatchable).map((o) => o.vehicleId)),
    [data],
  );
  /**
   * The manual checklist starts empty, not pre-filled with the recommendation: "Invia il mezzo consigliato" already
   * covers the one-tap recommended send, so this list is for building a selection from scratch, not editing a
   * recommended baseline the player didn't ask to see pre-ticked.
   */
  const selected = React.useMemo(
    () => new Set([...(manual ?? [])].filter((id) => dispatchable.has(id))),
    [manual, dispatchable],
  );
  // One dispatch command sends at most `maxVehiclesPerDispatch` (12; 24 on a major's incidents, D-69): the rest next time.
  const cap = data?.maxVehiclesPerDispatch ?? null;
  const capReached = cap !== null && selected.size >= cap;
  const planned = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const o of data?.options ?? [])
      if (selected.has(o.vehicleId))
        for (const c of o.contributes) m.set(c.code, (m.get(c.code) ?? 0) + c.value);
    return m;
  }, [data, selected]);
  const insufficient = incident.requirements.some(
    (r) =>
      r.level === 'REQUIRED' &&
      !r.external &&
      r.onScene + r.enRoute + (planned.get(r.capability) ?? 0) < r.required,
  );
  // The first option warning with a known "go fix it" destination — one concrete next action, not one per badge.
  const actionableWarning = (data?.options ?? [])
    .flatMap((o) => o.warnings)
    .find((w) => warningNextAction(w));

  /**
   * A stale-code rejection (a CREW_ code, VEHICLE_NOT_AVAILABLE, etc.) means the option list that "send
   * recommended"/"send selected" just acted on is stale (see DISPATCH_STALE_CODES above). Resetting the manual pick
   * is not enough on its own: the
   * "send recommended" button reads `recommended`, which still holds the SAME stale set until the refetch actually
   * lands, so a quick second tap would immediately resubmit the very set that just failed. This flag keeps both send
   * buttons disabled until the refetch this error triggered has genuinely completed.
   */
  const [awaitingStaleRefetch, setAwaitingStaleRefetch] = React.useState(false);

  const mutation = useMutation({
    mutationFn: (ids: string[]) => gameApi.dispatch(careerId, incident.id, ids),
    onSuccess: (_r, ids) => {
      playSound('dispatch', soundEnabled(useSettingsStore.getState().sound));
      toast({ tone: 'success', title: t('sent', { count: ids.length }), durationMs: 3000 });
      setManual(null);
      if (incident.isTutorial) void gameApi.tutorialAdvance(careerId, 'WATCH_ARRIVAL').catch(() => undefined);
      void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
    },
    onError: (e) => {
      toast({ tone: 'danger', title: errorMessage(e) });
      if (isApiError(e) && DISPATCH_STALE_CODES.has(e.code)) {
        setManual(null);
        setAwaitingStaleRefetch(true);
        void options.refetch().finally(() => setAwaitingStaleRefetch(false));
      }
    },
  });

  const [chainingId, setChainingId] = React.useState<string | null>(null);
  const chainMutation = useMutation({
    mutationFn: (vehicleId: string) => gameApi.chainVehicle(careerId, vehicleId, incident.id),
    onMutate: (vehicleId) => setChainingId(vehicleId),
    onSuccess: (result) => {
      playSound('dispatch', soundEnabled(useSettingsStore.getState().sound));
      toast({
        tone: 'success',
        title: t(result.mode === 'REDIRECTED' ? 'chain.redirected' : 'chain.queuedToast', {
          callSign: result.vehicle.callSign,
        }),
      });
      void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
    onSettled: () => setChainingId(null),
  });
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const cancelChainMutation = useMutation({
    mutationFn: (vehicleId: string) => gameApi.cancelChain(careerId, vehicleId),
    onMutate: (vehicleId) => setCancellingId(vehicleId),
    onSuccess: () => {
      toast({ tone: 'info', title: t('chain.queueCancelled') });
      void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
    },
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
    onSettled: () => setCancellingId(null),
  });

  const toggle = (id: string) =>
    setManual((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else if (cap === null || [...next].filter((x) => dispatchable.has(x)).length < cap) next.add(id);
      return next;
    });
  const sameAsRecommended =
    selected.size === recommended.size && [...selected].every((id) => recommended.has(id));
  // A vehicle that's busy elsewhere or RETURNING is never `dispatchable`, but it can still be redirected/queued here
  // via `chain` — that option list must render even when nothing can leave immediately (e.g. a one-vehicle fleet with
  // its only unit inbound from another call), or the chain action has nowhere to appear.
  const anyChainable = (data?.options ?? []).some((o) => o.chain);
  const manualPick = manual !== null && !sameAsRecommended;
  // What the primary action would add on top of what is already committed: the forecast of the summary line.
  const forecast = React.useMemo(() => {
    if (manualPick) return planned;
    const m = new Map<string, number>();
    for (const o of data?.options ?? [])
      if (recommended.has(o.vehicleId) && o.dispatchable)
        for (const c of o.contributes) m.set(c.code, (m.get(c.code) ?? 0) + c.value);
    return m;
  }, [manualPick, planned, data, recommended]);

  if (!data)
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );

  const sendRecommended = (
    <Button
      size={manualPick ? 'md' : 'lg'}
      variant={manualPick ? 'secondary' : 'primary'}
      className="w-full"
      onClick={() => mutation.mutate([...recommended])}
      loading={mutation.isPending || awaitingStaleRefetch}
      disabled={recommended.size === 0 || awaitingStaleRefetch}
      data-tutorial="send-recommended"
      data-testid="send-recommended"
    >
      <Sparkles className="size-5" aria-hidden />
      {t('sendRecommended', { count: recommended.size })}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="dispatch-panel">
      <CoachMark
        id="crewInsufficient"
        when={data.options.some((o) => crewBlockOf(o) === 'CREW_INSUFFICIENT')}
        selector='[data-blocked="CREW_INSUFFICIENT"]'
        title={tci('title')}
        body={tci('body')}
        actionLabel={tci('action')}
        actionHref="/game/personnel?tab=recruitment"
      />
      {dispatchable.size === 0 && !anyChainable ? (
        <div>
          <SectionTitle>{t('requirements')}</SectionTitle>
          <RequirementBars incident={incident} planned={planned} />
        </div>
      ) : null}
      {/* Vehicles that only lack a crew explain why and how to fix it, even when nothing else can leave. */}
      {dispatchable.size === 0 && !anyChainable ? <DispatchCrewBlocked options={data.options} /> : null}
      {dispatchable.size === 0 && !anyChainable && incident.assignedVehicleIds.length > 0 ? (
        <p className="text-subtle text-center text-xs">{t('noneAvailableHint')}</p>
      ) : dispatchable.size === 0 && !anyChainable ? (
        <EmptyState
          icon={<Truck className="size-5" />}
          title={t('noneAvailableTitle')}
          description={t('noneAvailableHint')}
          action={
            <Button asChild variant="secondary" className="h-11">
              <Link href="/game/shop">{t('goToShop')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* The primary action lives in the inspector's pinned footer (always visible, also in the sheet's peek). */}
          {dispatchable.size > 0 ? (
            <FooterPortal>
              <div className="flex flex-col gap-2" data-testid="dispatch-actions">
                {manualPick ? (
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => mutation.mutate([...selected])}
                    loading={mutation.isPending || awaitingStaleRefetch}
                    disabled={selected.size === 0 || awaitingStaleRefetch}
                    data-testid="send-selected"
                  >
                    <Send className="size-4" aria-hidden />
                    {t('sendSelected', { count: selected.size })}
                  </Button>
                ) : null}
                {sendRecommended}
              </div>
            </FooterPortal>
          ) : null}

          <div className="flex flex-col gap-1">
            <RequirementSummary incident={incident} planned={forecast} defaultOpen={desktop} />
            {!data.recommendationCoversRequired && manual === null && dispatchable.size > 0 ? (
              <p className="text-warning flex items-start gap-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t('recommendationPartial')}
              </p>
            ) : null}
            {insufficient && !sameAsRecommended && selected.size > 0 ? (
              <p
                role="status"
                className="text-warning flex flex-wrap items-start gap-x-2 gap-y-1 text-xs"
                data-testid="insufficient-warning"
              >
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t('insufficient')}
                </span>
                {actionableWarning ? (
                  <WarningNextAction
                    code={actionableWarning}
                    className="text-skyline ml-5 inline-flex min-h-11 items-center gap-1 font-semibold hover:underline lg:min-h-0"
                  />
                ) : null}
              </p>
            ) : null}
          </div>

          <div>
            <SectionTitle>{t('options')}</SectionTitle>
            {cap !== null && (incident.major || capReached) ? (
              <p
                className={cn(
                  'mb-2 flex items-start gap-1.5 text-xs',
                  capReached ? 'text-warning' : 'text-muted',
                )}
                role={capReached ? 'status' : undefined}
                data-testid="dispatch-cap"
                data-cap={cap}
                data-reached={capReached}
              >
                <Truck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {capReached
                  ? tm('capReached', { count: cap })
                  : tm('majorCap', { count: cap, selected: selected.size })}
              </p>
            ) : null}
            {families.length > 1 ? (
              <div
                role="group"
                aria-label={t('filterByFamily')}
                className="mt-2 mb-2 flex flex-wrap gap-1.5"
                data-testid="dispatch-family-filter"
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
                    data-testid="dispatch-family-chip"
                    data-family={f}
                  >
                    {f === 'ALL' ? null : <FamilyBadge family={f} size={18} />}
                    {f === 'ALL' ? t('allFamilies') : familyLabel(f)}
                  </button>
                ))}
              </div>
            ) : null}
            {visibleOptions.length === 0 ? (
              <EmptyState title={t('filterEmpty')} />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {visibleOptions.map((o) => {
                  const vehicle = vehicles.find((v) => v.id === o.vehicleId);
                  if (!vehicle) return null;
                  const type = typeOf(vehicle.typeCode);
                  const checked = selected.has(o.vehicleId);
                  const id = `opt-${o.vehicleId}`;
                  return (
                    <li
                      key={o.vehicleId}
                      className={cn(
                        'bg-surface-2 rounded-md border p-2.5',
                        checked ? 'border-focus' : 'border-border',
                        !o.dispatchable && 'opacity-60',
                      )}
                      data-testid="dispatch-option"
                    >
                      <div className="flex items-center gap-2.5">
                        {/* The whole row (box, icon, names) is one target: the 20 px box alone was a thumb trap. */}
                        <label
                          htmlFor={id}
                          className={cn(
                            'flex min-h-11 min-w-0 flex-1 items-center gap-2.5',
                            o.dispatchable ? 'cursor-pointer' : 'cursor-default',
                          )}
                        >
                          <Checkbox
                            id={id}
                            checked={checked}
                            disabled={!o.dispatchable || (capReached && !checked)}
                            onCheckedChange={() => toggle(o.vehicleId)}
                            aria-label={t('selectVehicle', { callSign: vehicle.callSign })}
                          />
                          <TopdownGlyph
                            vehicleClass={vehicleClassOf(type?.icon)}
                            family={vehicle.family}
                            size={28}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="text-fg truncate text-sm font-semibold">
                                {vehicle.callSign}
                              </span>
                              {o.recommended ? <Badge tone="brand">{t('recommended')}</Badge> : null}
                              {vehicle.movement?.purpose === 'PATROLLING' ? (
                                <Badge tone="info" data-testid="dispatch-option-patrolling">
                                  <Radar className="size-3" aria-hidden />
                                  {tv('patrol.onPatrol')}
                                </Badge>
                              ) : null}
                            </span>
                            <span className="text-muted block truncate text-xs">
                              {type ? tx(type.name) : vehicle.typeCode}
                            </span>
                            <span
                              className="text-subtle block truncate text-xs"
                              data-testid="dispatch-option-facility"
                            >
                              {facilityNameOf(vehicle.facilityId)}
                            </span>
                          </span>
                        </label>
                        {o.dispatchable ? (
                          <span className="text-right">
                            <span className="tabular text-fg block text-sm font-semibold">
                              {formatClock(o.etaSeconds)}
                            </span>
                            <span className="tabular text-subtle block text-xs">
                              {formatDistance(o.distanceMeters, locale)}
                            </span>
                          </span>
                        ) : o.chain ? (
                          <ChainAction
                            option={o}
                            incidentId={incident.id}
                            now={now}
                            onChain={() => chainMutation.mutate(o.vehicleId)}
                            onCancel={() => cancelChainMutation.mutate(o.vehicleId)}
                            chaining={chainingId === o.vehicleId && chainMutation.isPending}
                            cancelling={cancellingId === o.vehicleId && cancelChainMutation.isPending}
                          />
                        ) : (
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <StatusChip status={vehicle.status} label={ts(vehicle.status)} />
                            {vehicle.status === 'RESTOCKING' && vehicle.busyUntil ? (
                              <Countdown
                                to={vehicle.busyUntil}
                                doneLabel="…"
                                className="text-muted text-xs"
                              />
                            ) : null}
                          </span>
                        )}
                      </div>
                      {o.contributes.length > 0 || o.warnings.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1 pl-[30px]">
                          {o.contributes.map((c) => (
                            <Badge key={c.code} tone="neutral">
                              <GameIcon name={capabilityIconName(c.code)} size={12} />
                              {c.value}
                            </Badge>
                          ))}
                          {/* Autonomy (D-22): one discreet flag instead of a warning badge per code. */}
                          <DispatchAutonomyFlag option={o} />
                          {o.warnings
                            .filter((w) => !AUTONOMY_WARNINGS.has(w))
                            .map((w) => (
                              <Badge key={w} tone="warning">
                                <AlertTriangle className="size-3" aria-hidden />
                                {warningText(w)}
                              </Badge>
                            ))}
                        </div>
                      ) : null}
                      <DispatchReloadNote option={o} className="mt-1.5 pl-[30px]" />
                      {/* Aircraft (flight endurance): minutes needed / on board, how long it can stay over the scene. */}
                      <DispatchFlightNote option={o} className="mt-1.5 pl-[30px]" />
                      {/* Mass-casualty care: the maxi ambulance carries 4, the field post treats on scene. */}
                      <DispatchPatientCapacityNote tags={type?.tags} className="mt-1.5 pl-[30px]" />
                      {/* Water incidents: where it goes (scene / meeting point) and a boat's way there. */}
                      <DispatchWaterRoute option={o} className="mt-1.5 pl-[30px]" />
                      <DispatchEligibilityBlock
                        option={o}
                        incident={incident}
                        boat={type?.domain === 'WATER'}
                      />
                      <DispatchCrewPreview option={o} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
