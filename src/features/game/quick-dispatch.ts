'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { IncidentDto, SyncSnapshot } from '@/contracts';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { useErrorMessage } from '@/lib/api/error-message';
import { isApiError } from '@/lib/api/errors';
import { serverNow } from '@/lib/clock';
import { playSound } from '@/lib/sound';
import { soundEnabled, useSettingsStore } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useI18nText } from '@/i18n/use-i18n-text';
import { incidentScene } from '@/features/water/water';
import { useCareerId, usePatchSnapshot } from './hooks';

/** How long the "N vehicles sent · Undo" toast stays at most (D-35: 5 seconds to change your mind). */
export const QUICK_DISPATCH_UNDO_MS = 5000;
/** Never shorter: a toast gone in a second cannot be read (a late tap is still honoured, as a recall). */
export const QUICK_DISPATCH_MIN_UNDO_MS = 2500;

/**
 * Lifetime of the undo toast: until the free undo closes (`DispatchResultDto.cancellableUntil`, the server's grace window or
 * the first departure, whichever comes first), never more than 5 s, never less than 2.5 s. No free undo at all (`null`: a
 * patrol car leaves at once) → the classic 5 s of the recall. Exported for tests.
 */
export function undoToastMs(cancellableUntil: string | null | undefined, nowMs: number): number {
  if (!cancellableUntil) return QUICK_DISPATCH_UNDO_MS;
  const left = Date.parse(cancellableUntil) - nowMs;
  return Math.round(Math.min(QUICK_DISPATCH_UNDO_MS, Math.max(QUICK_DISPATCH_MIN_UNDO_MS, left)));
}

/** Refusals of the free undo that mean "too late / not this one": the undo falls back to recalling the vehicles. */
const RECALL_INSTEAD = ['CANCEL_WINDOW_EXPIRED', 'DISPATCH_NOT_CANCELLABLE', 'NOT_FOUND'] as const;
export const shouldRecallInstead = (error: unknown): boolean =>
  RECALL_INSTEAD.some((code) => isApiError(error, code));

/** Status signature of the fleet: the dispatch-panel caches its options under the same key suffix. */
export const fleetSignature = (vehicles: SyncSnapshot['vehicles']): string =>
  vehicles.map((v) => `${v.id}:${v.status}`).join('|');

/** The queue card shows "Invia" only where a one-tap send can make sense (never on the guided tutorial's incident). */
export const canQuickDispatch = (incident: IncidentDto, vehicles: SyncSnapshot['vehicles']): boolean =>
  incident.status === 'PENDING_RESPONSE' &&
  !incident.isTutorial &&
  vehicles.some((v) => v.status === 'AVAILABLE');

/**
 * One-tap dispatch from the queue card (D-35, 03 §2.3): sends the vehicles the server recommends, then offers up to five
 * seconds to take it back. Undo = the FREE cancel of the dispatch (★POST /dispatches/:id/cancel, air-endurance §5): every
 * vehicle AVAILABLE again as before, the incident with its ORIGINAL deadline, no "recalled" line, nothing charged. When the
 * server says it is too late (a vehicle already left, the window closed) or there never was a free undo, the vehicles are
 * recalled instead — and the toast says so.
 */
export function useQuickDispatch(): {
  send: (incident: IncidentDto) => Promise<void>;
  sending: ReadonlySet<string>;
} {
  const careerId = useCareerId();
  const qc = useQueryClient();
  const t = useTranslations('game.quickDispatch');
  const tx = useI18nText();
  const errorMessage = useErrorMessage();
  const patch = usePatchSnapshot();
  const [sending, setSending] = React.useState<ReadonlySet<string>>(() => new Set());

  const mark = React.useCallback((id: string, on: boolean) => {
    setSending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const recall = React.useCallback(
    async (incident: IncidentDto, vehicleIds: readonly string[], late: boolean) => {
      const results = await Promise.allSettled(vehicleIds.map((id) => gameApi.recallVehicle(careerId, id)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed)
        toast({ tone: 'warning', title: t('undoFailed'), description: errorMessage(failed.reason) });
      else
        toast({
          tone: late ? 'warning' : 'info',
          // Said plainly: the free undo was too late, the vehicles were recalled (a recall may leave a line and a delay).
          title: late ? t('recalledInstead') : t('undone'),
          description: tx(incident.title),
          durationMs: late ? 5000 : 3000,
        });
    },
    [careerId, t, tx, errorMessage],
  );

  const undo = React.useCallback(
    async (
      incident: IncidentDto,
      sent: { dispatchId: string; vehicleIds: readonly string[]; free: boolean },
    ) => {
      let late = false;
      if (sent.free) {
        try {
          const result = await gameApi.cancelDispatch(careerId, sent.dispatchId);
          // The events follow; patching now puts the card back at once.
          patch((s) => ({
            ...s,
            incidents: s.incidents.map((i) => (i.id === result.incident.id ? result.incident : i)),
            vehicles: s.vehicles.map((v) => result.vehicles.find((x) => x.id === v.id) ?? v),
          }));
          toast({ tone: 'info', title: t('cancelled'), description: tx(incident.title), durationMs: 3000 });
          void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
          return;
        } catch (e) {
          if (!shouldRecallInstead(e)) {
            toast({ tone: 'warning', title: t('undoFailed'), description: errorMessage(e) });
            return;
          }
          late = true;
        }
      }
      await recall(incident, sent.vehicleIds, late);
      void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
    },
    [careerId, qc, t, tx, errorMessage, patch, recall],
  );

  const send = React.useCallback(
    async (incident: IncidentDto) => {
      mark(incident.id, true);
      try {
        const snapshot = qc.getQueryData<SyncSnapshot>(qk.sync(careerId));
        const options = await qc.fetchQuery({
          queryKey: [...qk.dispatchOptions(careerId, incident.id), fleetSignature(snapshot?.vehicles ?? [])],
          queryFn: () => gameApi.dispatchOptions(careerId, incident.id),
          staleTime: 3_000,
        });
        const sendable = new Set(options.options.filter((o) => o.dispatchable).map((o) => o.vehicleId));
        const ids = options.recommendedVehicleIds.filter((id) => sendable.has(id));
        if (ids.length === 0) {
          toast({
            tone: 'warning',
            title: t('noRecommendation'),
            description: tx(incident.title),
            action: {
              label: t('open'),
              onClick: () =>
                useUiStore
                  .getState()
                  .select({ kind: 'incident', id: incident.id }, { focus: incidentScene(incident) }),
            },
          });
          return;
        }
        const result = await gameApi.dispatch(careerId, incident.id, ids);
        playSound('dispatch', soundEnabled(useSettingsStore.getState().sound));
        const sent = result.vehicles.map((v) => v.id);
        // A free undo exists unless the server says `null` (then "Annulla" recalls, as it always did).
        const free = result.cancellableUntil !== null && result.cancellableUntil !== undefined;
        toast({
          tone: 'success',
          title: t('sent', { count: sent.length }),
          description: options.recommendationCoversRequired
            ? tx(incident.title)
            : `${tx(incident.title)} · ${t('partial')}`,
          durationMs: undoToastMs(result.cancellableUntil, serverNow()),
          action: {
            label: free ? t('undo') : t('recall'),
            onClick: () => void undo(incident, { dispatchId: result.dispatchId, vehicleIds: sent, free }),
          },
        });
        void qc.invalidateQueries({ queryKey: qk.dispatchOptions(careerId, incident.id) });
      } catch (e) {
        toast({ tone: 'danger', title: errorMessage(e) });
      } finally {
        mark(incident.id, false);
      }
    },
    [careerId, qc, t, tx, errorMessage, mark, undo],
  );

  return { send, sending };
}
