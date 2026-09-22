'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Radar, Send, Sparkles, Truck } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { FamilyBadge, GameIcon, TopdownGlyph, capabilityIconName, vehicleClassOf } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CapabilityBar } from '@/components/ui/capability-bar';
import { Checkbox } from '@/components/ui/switch';
import { EmptyState, SectionTitle, Skeleton } from '@/components/ui/misc';
import { StatusChip } from '@/components/ui/status-chip';
import { DispatchCrewBlocked, DispatchCrewPreview, crewBlockOf } from '@/features/personnel/slots';
import { WarningNextAction, warningNextAction } from '@/features/coaching/warning-next-action';
import { CoachMark } from '@/features/coaching/coach-mark';
import { useFamilyLabel } from '@/features/facilities/site-details';
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
  const tx = useI18nText();
  const catalog = useCatalog();
  const nameOf = (code: string) =>
    tx(catalog?.capabilities.find((c) => c.code === code)?.name ?? { key: `catalog.capability.${code}` });
  const legend = {
    onScene: t('onScene'),
    enRoute: t('enRoute'),
    planned: t('planned'),
    required: t('required'),
  };
  return (
    <div className="flex flex-col gap-3">
      {incident.requirements.map((r) => (
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
      ))}
      <ul className="text-subtle flex flex-wrap gap-x-4 gap-y-1 text-[11px]" aria-hidden>
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
const ELIGIBILITY_BLOCKS = ['VEHICLE_DOMAIN_MISMATCH', 'AIR_SUPPORT_NOT_NEEDED'] as const;
type EligibilityBlock = (typeof ELIGIBILITY_BLOCKS)[number];
export const eligibilityBlockOf = (
  option: DispatchOptionsResult['options'][number],
): EligibilityBlock | null => ELIGIBILITY_BLOCKS.find((code) => code === option.blockedReason) ?? null;

/** Reason line for a vehicle that is ineligible by nature; mirrors the crew block's wording and styling. */
function DispatchEligibilityBlock({ option }: { option: DispatchOptionsResult['options'][number] }) {
  const t = useTranslations('game.dispatch.ineligible');
  const block = eligibilityBlockOf(option);
  if (!block) return null;
  return (
    <p
      className="text-danger mt-2 flex items-center gap-1 pl-[30px] text-xs font-semibold"
      role="status"
      data-testid="dispatch-ineligible"
      data-blocked={block}
    >
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      {t(block)}
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

  if (queuedHere)
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone="info">{t('queued')}</Badge>
        <Button size="sm" variant="ghost" onClick={onCancel} loading={cancelling}>
          {t('cancelQueue')}
        </Button>
      </div>
    );

  if (chain.redirectEligible)
    return (
      <Button size="sm" onClick={onChain} loading={chaining} data-testid="chain-redirect">
        {t('redirect')}
      </Button>
    );

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button size="sm" variant="secondary" onClick={onChain} loading={chaining} data-testid="chain-queue">
        {t('queue')}
      </Button>
      {chain.blockedReason ? (
        <span className="text-subtle text-right text-[11px]">
          {t.has(`reason.${chain.blockedReason}` as never)
            ? t(`reason.${chain.blockedReason}` as never)
            : chain.blockedReason}
        </span>
      ) : availableInSeconds !== null ? (
        <span className="text-subtle text-[11px]">{t('availableIn', { time: formatClock(availableInSeconds) })}</span>
      ) : null}
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
  const planned = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const o of data?.options ?? [])
      if (selected.has(o.vehicleId))
        for (const c of o.contributes) m.set(c.code, (m.get(c.code) ?? 0) + c.value);
    return m;
  }, [data, selected]);
  const insufficient = incident.requirements.some(
    (r) => r.level === 'REQUIRED' && r.onScene + r.enRoute + (planned.get(r.capability) ?? 0) < r.required,
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
      else next.add(id);
      return next;
    });
  const sameAsRecommended =
    selected.size === recommended.size && [...selected].every((id) => recommended.has(id));

  if (!data)
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
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
      {dispatchable.size === 0 ? (
        <div>
          <SectionTitle>{t('requirements')}</SectionTitle>
          <RequirementBars incident={incident} planned={planned} />
        </div>
      ) : null}
      {/* Vehicles that only lack a crew explain why and how to fix it, even when nothing else can leave. */}
      {dispatchable.size === 0 ? <DispatchCrewBlocked options={data.options} /> : null}
      {dispatchable.size === 0 && incident.assignedVehicleIds.length > 0 ? (
        <p className="text-subtle text-center text-xs">{t('noneAvailableHint')}</p>
      ) : dispatchable.size === 0 ? (
        <EmptyState
          icon={<Truck className="size-5" />}
          title={t('noneAvailableTitle')}
          description={t('noneAvailableHint')}
          action={
            <Button asChild variant="secondary">
              <Link href="/game/shop">{t('goToShop')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
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
            {manual !== null && !sameAsRecommended ? (
              <Button
                size="lg"
                variant="secondary"
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
            {!data.recommendationCoversRequired && manual === null ? (
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
                    className="text-skyline ml-5 inline-flex items-center gap-1 font-semibold hover:underline"
                  />
                ) : null}
              </p>
            ) : null}
          </div>

          {/* Stuck to the top of the tab's own scroll container while the option list below scrolls, so the
              coverage you're building stays visible without scrolling back up after each pick. Capped and
              internally scrollable: a heavy multi-service incident can list 8-9 requirement bars, which would
              otherwise fill the whole panel and leave no room to reach the vehicle list below it. */}
          <div className="border-border bg-surface-1 sticky top-0 z-10 -mx-4 max-h-[42vh] overflow-y-auto border-b px-4 pb-3">
            <SectionTitle>{t('requirements')}</SectionTitle>
            <RequirementBars incident={incident} planned={planned} />
          </div>

          <div>
            <SectionTitle>{t('options')}</SectionTitle>
            {families.length > 1 ? (
              <div
                role="group"
                aria-label={t('filterByFamily')}
                className="mt-2 mb-2 flex gap-1.5 overflow-x-auto pb-1"
                data-testid="dispatch-family-filter"
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
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={!o.dispatchable}
                          onCheckedChange={() => toggle(o.vehicleId)}
                          aria-label={t('selectVehicle', { callSign: vehicle.callSign })}
                        />
                        <TopdownGlyph
                          vehicleClass={vehicleClassOf(type?.icon)}
                          family={vehicle.family}
                          size={28}
                        />
                        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                          <span className="flex items-center gap-1.5">
                            <span className="text-fg truncate text-sm font-semibold">{vehicle.callSign}</span>
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
                        </label>
                        {o.dispatchable ? (
                          <span className="text-right">
                            <span className="tabular text-fg block text-sm font-semibold">
                              {formatClock(o.etaSeconds)}
                            </span>
                            <span className="tabular text-subtle block text-[11px]">
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
                          <StatusChip status={vehicle.status} label={ts(vehicle.status)} />
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
                          {o.warnings.map((w) => (
                            <Badge key={w} tone="warning">
                              <AlertTriangle className="size-3" aria-hidden />
                              {warningText(w)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <DispatchEligibilityBlock option={o} />
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
