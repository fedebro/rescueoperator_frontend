'use client';
import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, BedDouble, Clock, Hourglass, Package, Undo2, Users } from 'lucide-react';
import type { IncidentDto, VehicleDto } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import type { DispatchChain, DispatchOption } from '@/lib/api/types';
import { formatClock, formatDistance, formatTime } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { soundEnabled, useSettingsStore } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useCatalogName, useI18nText } from '@/i18n/use-i18n-text';
import { useServerNow } from '@/hooks/use-server-now';
import { cn } from '@/lib/utils';
import { TopdownGlyph, vehicleClassOf } from '@/design/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/ui/countdown';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { StatusChip } from '@/components/ui/status-chip';
import { ChainFuelStop } from '@/features/autonomy/dispatch-autonomy';
import { useIncidentPlace } from '@/features/water/incident-water';
import { useCareerId, useSnapshot, useVehicleTypeLookup } from './hooks';

/**
 * Sending a vehicle that is not free (analisi/note-agenti/invio-mezzi-ui.md): the dispatch panel's busy rows, the
 * confirmation of a queue with the mission the vehicle is on and the time it would arrive, the redirect from the way home
 * (also back to the emergency it was recalled from) and the "send it back here" of the vehicle sheet.
 */

/** Incident statuses that can still receive vehicles (the server's `canReceive`, without the medical tail). */
const OPEN_INCIDENT = ['PENDING_RESPONSE', 'RESPONDING', 'ON_SCENE'] as const;
export const isOpenIncident = (incident: Pick<IncidentDto, 'status'>): boolean =>
  (OPEN_INCIDENT as readonly string[]).includes(incident.status);

/**
 * The dispatch options of an incident, under the key the dispatch panel and the vehicle sheet share (one fetch, one cache):
 * they depend on which vehicles are free, so the key follows the fleet's status signature.
 */
export function useDispatchOptions(incidentId: string) {
  const careerId = useCareerId();
  const { vehicles } = useSnapshot();
  const signature = vehicles.map((v) => `${v.id}:${v.status}`).join('|');
  return useQuery({
    queryKey: [...qk.dispatchOptions(careerId, incidentId), signature],
    queryFn: () => gameApi.dispatchOptions(careerId, incidentId),
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
}

/** Text of a `chain.blockedReason` (every code has one in the five languages; an unknown one shows as it is). */
export function useChainReason(): (code: string) => string {
  const t = useTranslations('game.dispatch.chain');
  return React.useCallback(
    (code) => (t.has(`reason.${code}` as never) ? t(`reason.${code}` as never) : code),
    [t],
  );
}

/** Where the vehicle is: its mission as the player recognises it, the vehicle's state. */
function useChainMission(chain: DispatchChain, incident: Pick<IncidentDto, 'id'>) {
  const { incidents } = useSnapshot();
  const closed = useUiStore((s) =>
    chain.currentIncidentId ? s.closedIncidents[chain.currentIncidentId] : undefined,
  );
  const here = !!chain.currentIncidentId && chain.currentIncidentId === incident.id;
  const current = chain.currentIncidentId
    ? incidents.find((i) => i.id === chain.currentIncidentId)
    : undefined;
  return { here, current, closedTitle: closed?.title };
}

/** Row 2 of a busy vehicle: "Impegnato su: <type of emergency> · <address>" and the state of the vehicle. */
export function ChainMission({
  chain,
  incident,
  busyUntil,
}: {
  chain: DispatchChain;
  incident: IncidentDto;
  busyUntil?: string | null;
}) {
  const t = useTranslations('game.dispatch.chain');
  const ts = useTranslations('status.vehicle');
  const tx = useI18nText();
  const placeOf = useIncidentPlace();
  const { here, current, closedTitle } = useChainMission(chain, incident);
  const restocking = chain.vehicleStatus === 'RESTOCKING';
  return (
    <div
      className="mt-2 flex flex-col items-start gap-1.5 text-xs"
      data-testid="chain-mission"
      data-current-incident={chain.currentIncidentId ?? ''}
      data-here={here}
    >
      <span className="min-w-0 break-words" data-testid="chain-mission-text">
        {restocking ? (
          <span className="text-muted inline-flex flex-wrap items-center gap-1">
            {t('restocking')}
            {busyUntil ? <Countdown to={busyUntil} doneLabel="…" /> : null}
          </span>
        ) : here ? (
          <span className="text-fg font-semibold" data-testid="chain-recalled-here">
            {t('recalledHere')}
          </span>
        ) : current ? (
          <>
            <span className="text-subtle">{t('busyOn')} </span>
            <span className="text-fg font-semibold">{tx(current.title)}</span>
            <span className="text-muted"> · {placeOf(current)}</span>
          </>
        ) : chain.vehicleStatus === 'RETURNING' ? (
          <span className="text-muted">
            {closedTitle ? t('returningFrom', { title: tx(closedTitle) }) : t('returningFromClosed')}
          </span>
        ) : null}
      </span>
      <StatusChip status={chain.vehicleStatus} label={ts(chain.vehicleStatus)} />
    </div>
  );
}

/** What the player can do about a reason: the way to fix it ("Vai in Personale") or what the queue does for it. */
function ChainReasonLine({ reason }: { reason: string }) {
  const t = useTranslations('game.dispatch.chain');
  const text = useChainReason();
  const fix =
    reason === 'CREW_INSUFFICIENT' || reason === 'CREW_UNQUALIFIED'
      ? { href: '/game/personnel?tab=recruitment', label: t('fix.personnel'), Icon: Users }
      : reason === 'VEHICLE_INOPERABLE' || reason === 'MAINTENANCE_DUE'
        ? { href: '/game/logistics', label: t('fix.logistics'), Icon: Package }
        : null;
  const hint = t.has(`hint.${reason}` as never) ? t(`hint.${reason}` as never) : null;
  return (
    <div className="flex flex-col gap-1" data-testid="chain-reason" data-reason={reason}>
      <p className="text-warning flex items-start gap-1.5 text-xs font-semibold">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{text(reason)}</span>
      </p>
      {hint ? (
        <p className="text-subtle flex items-start gap-1.5 text-xs" data-testid="chain-hint">
          <BedDouble className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{hint}</span>
        </p>
      ) : null}
      {fix ? (
        <Link
          href={fix.href}
          className="text-skyline inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold hover:underline lg:min-h-0"
          data-testid="chain-fix-link"
        >
          <fix.Icon className="size-3.5" aria-hidden />
          {fix.label}
        </Link>
      ) : null}
    </div>
  );
}

/** Estimated arrival of a queued vehicle, in the row: the clock time and the countdown. */
function ChainArrival({ chain, className }: { chain: DispatchChain; className?: string }) {
  const t = useTranslations('game.dispatch.chain');
  const locale = useLocale();
  const { career } = useSnapshot();
  const arriveAt = chain.estimate?.arriveAt;
  if (!arriveAt) return null;
  return (
    <span className={className} data-testid="chain-arrival">
      {t('queuedEta', { time: formatTime(arriveAt, locale, career.timezone) })}
      {chain.estimate?.approximate ? ` (${t('approximate')})` : ''}
    </span>
  );
}

/**
 * Row 3 of a busy vehicle (`option.chain`, see the contract): redirected at once when it is on its way home and every
 * condition holds, otherwise queued as its next assignment. One tap for the redirect (the row already says when it would
 * arrive); the queue always goes through the confirmation (the mission it is on, the estimate).
 */
export function ChainActions({
  option,
  incident,
  now,
  flow,
}: {
  option: DispatchOption;
  incident: IncidentDto;
  now: number;
  flow: ChainFlow;
}) {
  const t = useTranslations('game.dispatch.chain');
  const itemName = useCatalogName();
  const locale = useLocale();
  const { career } = useSnapshot();
  const chain = option.chain;
  if (!chain) return null;
  const here = !!chain.currentIncidentId && chain.currentIncidentId === incident.id;
  const queuedHere = chain.queuedIncidentId === incident.id;
  const stockLow = chain.stockLow ?? [];
  const busy = flow.busyId === option.vehicleId;
  const availableInSeconds = chain.availableAt
    ? Math.max(0, Math.round((Date.parse(chain.availableAt) - now) / 1000))
    : null;
  // 44 px on touch screens (03 §2.10), the compact 32 px only where there is a mouse.
  const size = 'h-11 lg:h-8';

  if (queuedHere)
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="chain-queued">
        <Badge tone="info">
          <Hourglass className="size-3" aria-hidden />
          {t('queued')}
        </Badge>
        <ChainArrival chain={chain} className="text-muted text-xs" />
        <Button
          size="sm"
          variant="ghost"
          className={size}
          onClick={() => flow.cancelQueue(option.vehicleId)}
          loading={flow.cancellingId === option.vehicleId}
          data-testid="chain-cancel"
        >
          {t('cancelQueue')}
        </Button>
      </div>
    );

  if (chain.redirectEligible)
    return (
      <div className="mt-2 flex flex-col gap-2" data-testid="chain-actions" data-mode="redirect">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            size="sm"
            className={size}
            onClick={() => flow.primary(option)}
            loading={busy}
            data-testid={here ? 'chain-resend' : 'chain-redirect'}
          >
            {here ? t('resend') : t('redirect')}
          </Button>
          <span className="tabular text-fg text-xs font-semibold" data-testid="chain-eta">
            {t('arrivesIn', { time: formatClock(option.etaSeconds) })}
            <span className="text-subtle font-normal">
              {' '}
              · {formatDistance(option.distanceMeters, locale)}
            </span>
          </span>
        </div>
        {/* A redirect in reserve refuels at a pump on the way first: its seconds are already in the new ETA. */}
        {chain.fuelStop ? <ChainFuelStop fuelStop={chain.fuelStop} /> : null}
        {stockLow.length > 0 ? (
          <div className="flex flex-col items-start gap-1" data-testid="chain-stock-low">
            <p className="text-warning flex items-start gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {t('stockLow', { items: stockLow.map((code) => itemName('item', code)).join(', ') })}
              </span>
            </p>
            <Button
              size="sm"
              variant="secondary"
              // A long label wraps on a narrow screen instead of pushing the row out sideways.
              className="h-auto min-h-11 max-w-full py-1.5 text-center whitespace-normal lg:min-h-8"
              onClick={() => flow.askQueue(option, true)}
              data-testid="chain-queue-after-restock"
            >
              {t('queueAfterRestock')}
            </Button>
          </div>
        ) : null}
      </div>
    );

  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="chain-actions" data-mode="queue">
      {chain.blockedReason ? <ChainReasonLine reason={chain.blockedReason} /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          size="sm"
          variant="secondary"
          className={size}
          onClick={() => flow.primary(option)}
          loading={busy}
          data-testid="chain-queue"
        >
          {t('queue')}
        </Button>
        {/* "Free at" = back home + the resupply stop the rule predicts (or the end of the stop it is making). */}
        {availableInSeconds !== null ? (
          <span
            className="text-subtle inline-flex items-center gap-1 text-xs"
            data-testid="chain-available-in"
          >
            <Clock className="size-3.5" aria-hidden />
            {t('availableIn', { time: formatClock(availableInSeconds) })}
          </span>
        ) : chain.estimate?.freeAt ? (
          <span className="text-subtle inline-flex items-center gap-1 text-xs" data-testid="chain-free-at">
            <Clock className="size-3.5" aria-hidden />
            {t('freeAt', { time: formatTime(chain.estimate.freeAt, locale, career.timezone) })}
            {chain.estimate.approximate ? ` (${t('approximate')})` : ''}
          </span>
        ) : null}
      </div>
      {chain.fuelStop ? <ChainFuelStop fuelStop={chain.fuelStop} /> : null}
    </div>
  );
}

/** "tra 2:10": the countdown to an estimated arrival, against the SERVER clock. */
function ArriveIn({ to, className }: { to: string; className?: string }) {
  const t = useTranslations('game.dispatch.chain');
  const now = useServerNow(1000);
  return (
    <span className={cn('tabular', className)} data-testid="chain-confirm-countdown">
      {t('confirm.arriveIn', { time: formatClock(Math.max(0, (Date.parse(to) - now) / 1000)) })}
    </span>
  );
}

/** The confirmation of a queue: the vehicle, the mission it is on, when it would be free and arrive — and what that means. */
function ChainConfirmDialog({
  option,
  vehicle,
  incident,
  queueOnly,
  loading,
  onConfirm,
  onClose,
}: {
  option: DispatchOption;
  vehicle: VehicleDto;
  incident: IncidentDto;
  queueOnly: boolean;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('game.dispatch.chain');
  const tc = useTranslations('common');
  const ts = useTranslations('status.vehicle');
  const tx = useI18nText();
  const locale = useLocale();
  const placeOf = useIncidentPlace();
  const { career, incidents } = useSnapshot();
  const typeOf = useVehicleTypeLookup();
  const chain = option.chain!;
  const type = typeOf(vehicle.typeCode);
  const { here, current, closedTitle } = useChainMission(chain, incident);
  const estimate = chain.estimate;
  const queuedElsewhere =
    chain.queuedIncidentId && chain.queuedIncidentId !== incident.id
      ? incidents.find((i) => i.id === chain.queuedIncidentId)
      : undefined;
  const clock = (iso: string) => formatTime(iso, locale, career.timezone);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={t('confirm.title', { callSign: vehicle.callSign })}
        description={t('confirm.description')}
        closeLabel={tc('close')}
        data-testid="chain-confirm"
      >
        <div className="flex flex-col gap-4 text-sm">
          <section className="flex items-center gap-2.5" data-testid="chain-confirm-vehicle">
            <TopdownGlyph vehicleClass={vehicleClassOf(type?.icon)} family={vehicle.family} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-fg font-semibold break-words">{vehicle.callSign}</p>
              <p className="text-muted text-xs break-words">{type ? tx(type.name) : vehicle.typeCode}</p>
            </div>
          </section>

          <section className="flex flex-col gap-1.5" data-testid="chain-confirm-mission">
            <h3 className="text-subtle text-xs font-semibold tracking-wide uppercase">
              {t('confirm.mission')}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <StatusChip status={chain.vehicleStatus} label={ts(chain.vehicleStatus)} />
              <span className="min-w-0 break-words" data-testid="chain-confirm-mission-text">
                {chain.vehicleStatus === 'RESTOCKING' ? (
                  <span className="text-muted">{t('confirm.idle')}</span>
                ) : here ? (
                  <span className="text-fg font-semibold">{t('recalledHere')}</span>
                ) : current ? (
                  <>
                    <span className="text-fg font-semibold">{tx(current.title)}</span>
                    <span className="text-muted"> · {placeOf(current)}</span>
                  </>
                ) : closedTitle ? (
                  <span className="text-muted">{t('returningFrom', { title: tx(closedTitle) })}</span>
                ) : chain.vehicleStatus === 'RETURNING' ? (
                  <span className="text-muted">{t('returningFromClosed')}</span>
                ) : null}
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-1.5" data-testid="chain-confirm-estimate">
            <h3 className="text-subtle flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              {t('confirm.estimate')}
              {estimate?.approximate ? (
                <Badge tone="neutral" data-testid="chain-confirm-approximate">
                  {t('confirm.approximate')}
                </Badge>
              ) : null}
            </h3>
            {estimate?.freeAt ? (
              <p className="text-fg" data-testid="chain-confirm-free-at">
                {t('confirm.freeAt', { time: clock(estimate.freeAt) })}
              </p>
            ) : null}
            {estimate?.arriveAt ? (
              <p className="text-fg font-semibold" data-testid="chain-confirm-arrive-at">
                {t('confirm.arriveAt', { time: clock(estimate.arriveAt) })}
                <span className="text-muted font-normal">
                  {' · '}
                  <ArriveIn to={estimate.arriveAt} />
                </span>
              </p>
            ) : null}
            <p
              className="text-muted text-xs"
              data-testid="chain-confirm-basis"
              data-basis={estimate?.basis ?? 'UNKNOWN'}
            >
              {t(`confirm.basis.${estimate?.basis ?? 'UNKNOWN'}` as never)}
            </p>
            {queueOnly && chain.redirectEligible ? (
              <p className="text-muted text-xs" data-testid="chain-confirm-after-restock">
                {t('confirm.afterRestock')}
              </p>
            ) : null}
          </section>

          {estimate?.afterExpiry && estimate.incidentExpiresAt ? (
            <p
              className="border-warning/40 bg-warning/10 text-warning flex items-start gap-2 rounded-md border p-2.5 text-sm font-semibold"
              role="alert"
              data-testid="chain-confirm-expiry"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('confirm.afterExpiry', { time: clock(estimate.incidentExpiresAt) })}
            </p>
          ) : null}

          {queuedElsewhere ? (
            <p className="text-muted text-xs" data-testid="chain-confirm-replaces">
              {t('confirm.replaces', { title: tx(queuedElsewhere.title) })}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" className="h-11" onClick={onClose} data-testid="chain-confirm-cancel">
            {t('confirm.cancel')}
          </Button>
          <Button className="h-11" onClick={onConfirm} loading={loading} data-testid="chain-confirm-submit">
            {t('confirm.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ChainRequest {
  vehicleId: string;
  queueOnly: boolean;
  /** What the option promised when the player tapped: a redirect that comes back QUEUED has to say why. */
  expectedRedirect: boolean;
  callSign: string;
  etaSeconds: number;
  arriveAt: string | null;
  here: boolean;
}

/**
 * The chain command of an incident's panel: one tap redirects (the row already says when it would arrive), a queue goes
 * through the confirmation, a redirect that the server turned into a queue says why in the toast. Render `dialog` once.
 */
export function useChainFlow(incident: IncidentDto, options: readonly DispatchOption[] | undefined) {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const t = useTranslations('game.dispatch.chain');
  const locale = useLocale();
  const reasonText = useChainReason();
  const errorMessage = useErrorMessage();
  const { career, vehicles } = useSnapshot();
  const [confirming, setConfirming] = React.useState<{ vehicleId: string; queueOnly: boolean } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });

  const run = useMutation({
    mutationFn: (request: ChainRequest) =>
      gameApi.chainVehicle(careerId, request.vehicleId, incident.id, { queueOnly: request.queueOnly }),
    onMutate: (request) => setBusyId(request.vehicleId),
    onSuccess: async (result, request) => {
      playSound('dispatch', soundEnabled(useSettingsStore.getState().sound));
      setConfirming(null);
      if (result.mode === 'REDIRECTED') {
        toast({
          tone: 'success',
          title: t(request.here ? 'resent' : 'redirected', { callSign: result.vehicle.callSign }),
          description: t('arrivesIn', { time: formatClock(request.etaSeconds) }),
        });
        return;
      }
      // Queued although the player expected a redirect: the server's answer of NOW says why (never a silent surprise).
      if (request.expectedRedirect) {
        const fresh = await gameApi.dispatchOptions(careerId, incident.id).catch(() => null);
        const reason = fresh?.options.find((o) => o.vehicleId === request.vehicleId)?.chain?.blockedReason;
        toast({
          tone: 'info',
          title: reason
            ? t('queuedBecause', { callSign: result.vehicle.callSign, reason: reasonText(reason) })
            : t('queuedUnexpected', { callSign: result.vehicle.callSign }),
        });
        return;
      }
      toast({
        tone: 'success',
        title: request.arriveAt
          ? t('queuedToastAt', {
              callSign: result.vehicle.callSign,
              time: formatTime(request.arriveAt, locale, career.timezone),
            })
          : t('queuedToast', { callSign: result.vehicle.callSign }),
      });
    },
    onError: (e) => {
      setConfirming(null);
      toast({ tone: 'danger', title: errorMessage(e) });
    },
    onSettled: () => {
      setBusyId(null);
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (vehicleId: string) => gameApi.cancelChain(careerId, vehicleId),
    onMutate: (vehicleId) => setCancellingId(vehicleId),
    onSuccess: () => toast({ tone: 'info', title: t('queueCancelled') }),
    onError: (e) => toast({ tone: 'danger', title: errorMessage(e) }),
    onSettled: () => {
      setCancellingId(null);
      refresh();
    },
  });

  const requestOf = (option: DispatchOption, queueOnly: boolean): ChainRequest => {
    const chain = option.chain;
    return {
      vehicleId: option.vehicleId,
      queueOnly,
      expectedRedirect: !queueOnly && chain?.redirectEligible === true,
      callSign: vehicles.find((v) => v.id === option.vehicleId)?.callSign ?? '',
      etaSeconds: option.etaSeconds,
      arriveAt: chain?.estimate?.arriveAt ?? null,
      here: !!chain?.currentIncidentId && chain.currentIncidentId === incident.id,
    };
  };

  const confirmingOption = confirming
    ? options?.find((o) => o.vehicleId === confirming.vehicleId)
    : undefined;
  const confirmingVehicle = confirming ? vehicles.find((v) => v.id === confirming.vehicleId) : undefined;
  const dialog =
    confirming && confirmingOption?.chain && confirmingVehicle ? (
      <ChainConfirmDialog
        option={confirmingOption}
        vehicle={confirmingVehicle}
        incident={incident}
        queueOnly={confirming.queueOnly}
        loading={run.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => run.mutate(requestOf(confirmingOption, confirming.queueOnly))}
      />
    ) : null;

  return {
    busyId: run.isPending ? busyId : null,
    cancellingId: cancel.isPending ? cancellingId : null,
    /** The row's main action: a redirect at one tap when the vehicle can turn now, else the confirmation of the queue. */
    primary: (option: DispatchOption) => {
      if (option.chain?.redirectEligible) run.mutate(requestOf(option, false));
      else setConfirming({ vehicleId: option.vehicleId, queueOnly: false });
    },
    /** Queue without diverting (`queueOnly`): it finishes its way home and its resupply first. Always confirmed. */
    askQueue: (option: DispatchOption, queueOnly = false) =>
      setConfirming({ vehicleId: option.vehicleId, queueOnly }),
    cancelQueue: (vehicleId: string) => cancel.mutate(vehicleId),
    dialog,
  };
}
export type ChainFlow = ReturnType<typeof useChainFlow>;

/**
 * "Send it back to the same emergency" in the vehicle sheet: after a recall made by mistake, as long as the call is open.
 * Reads the same dispatch options as the emergency's own panel (the estimate and the reason are the server's), redirects at
 * one tap when the vehicle can turn now, otherwise offers the queue with its confirmation.
 */
export function ResendHere({ vehicle }: { vehicle: VehicleDto }) {
  const { incidents } = useSnapshot();
  // The server says where a vehicle on its way home comes from (`returningFromIncidentId`; `incidentId` is null then).
  const originId = vehicle.status === 'RETURNING' ? vehicle.returningFromIncidentId : null;
  const incident = originId ? incidents.find((i) => i.id === originId && isOpenIncident(i)) : undefined;
  if (!incident) return null;
  return <ResendHereFor vehicle={vehicle} incident={incident} />;
}

function ResendHereFor({ vehicle, incident }: { vehicle: VehicleDto; incident: IncidentDto }) {
  const t = useTranslations('game.dispatch.chain');
  const tv = useTranslations('game.vehicle');
  const tx = useI18nText();
  const options = useDispatchOptions(incident.id);
  const flow = useChainFlow(incident, options.data?.options);
  const option = options.data?.options.find((o) => o.vehicleId === vehicle.id);
  const chain = option?.chain;
  if (!option || !chain) return null;
  const queuedHere = chain.queuedIncidentId === incident.id;
  return (
    <div className="flex flex-col gap-2" data-testid="resend-here" data-incident-id={incident.id}>
      <p className="text-muted text-xs break-words">{tv('resendFrom', { title: tx(incident.title) })}</p>
      {queuedHere ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="resend-queued">
          <Badge tone="info">
            <Hourglass className="size-3" aria-hidden />
            {t('queued')}
          </Badge>
          <ChainArrival chain={chain} className="text-muted text-xs" />
          <Button
            size="sm"
            variant="ghost"
            className="h-11 lg:h-8"
            onClick={() => flow.cancelQueue(vehicle.id)}
            loading={flow.cancellingId === vehicle.id}
          >
            {t('cancelQueue')}
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant={chain.redirectEligible ? 'primary' : 'secondary'}
            className="h-11 w-full"
            onClick={() => flow.primary(option)}
            loading={flow.busyId === vehicle.id}
            data-testid="resend-vehicle"
          >
            <Undo2 className="size-4 -scale-x-100" aria-hidden />
            {chain.redirectEligible ? tv('resend') : t('queue')}
          </Button>
          {chain.redirectEligible ? (
            <p className="tabular text-muted text-xs" data-testid="resend-eta">
              {t('arrivesIn', { time: formatClock(option.etaSeconds) })}
            </p>
          ) : chain.blockedReason ? (
            <ChainReasonLine reason={chain.blockedReason} />
          ) : null}
        </>
      )}
      {flow.dialog}
    </div>
  );
}
