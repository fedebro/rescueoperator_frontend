'use client';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { SyncSnapshot } from '@/contracts';
import { track } from '@/lib/analytics';
import { useLatest } from '@/hooks/use-latest';
import { toast } from '@/stores/toast';
import { useUiStore, type Selection } from '@/stores/ui';
import { useSnapshot } from '@/features/game/hooks';
import { incidentScene } from '@/features/water/water';
import { parseFocusParam, type FocusTarget } from './deep-link';

export type FocusOutcome = 'opened' | 'incidentClosed' | 'vehicleGone' | 'facilityGone';

type Select = (selection: Selection, opts?: { focus?: [number, number] }) => void;

/**
 * Opens what a deep link points at on the operations map: the inspector (desktop panel, phone sheet at half) with the
 * camera on it. A closed incident has nothing to select — its report is the pending outcome dialog, if any.
 */
export function openFocusTarget(target: FocusTarget, snapshot: SyncSnapshot, select: Select): FocusOutcome {
  switch (target.kind) {
    case 'incident': {
      const incident = snapshot.incidents.find((i) => i.id === target.id);
      if (incident) {
        select({ kind: 'incident', id: incident.id }, { focus: incidentScene(incident) });
        return 'opened';
      }
      return snapshot.pendingOutcomes.some((o) => o.incidentId === target.id) ? 'opened' : 'incidentClosed';
    }
    case 'major': {
      // The coordination view loads the major itself (a running one or the summary of an ended one).
      const ref = snapshot.incidents.find((i) => i.major?.id === target.id)?.major;
      select({ kind: 'major', id: target.id }, ref ? { focus: ref.center } : undefined);
      return 'opened';
    }
    case 'vehicle': {
      const vehicle = snapshot.vehicles.find((v) => v.id === target.id);
      if (!vehicle) return 'vehicleGone';
      select({ kind: 'vehicle', id: vehicle.id }, { focus: vehicle.position });
      return 'opened';
    }
    case 'facility': {
      const facility = snapshot.facilities.find((f) => f.id === target.id);
      if (!facility) return 'facilityGone';
      select({ kind: 'facility', id: facility.id }, { focus: facility.position });
      return 'opened';
    }
  }
}

function DeepLinkFocusEffect() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('push.deepLink');
  const snapshot = useLatest(useSnapshot());
  const raw = pathname === '/game' ? params.get('focus') : null;
  React.useEffect(() => {
    if (!raw) return;
    // The query is a one-shot instruction: a reload or a shared URL must not re-open it.
    router.replace('/game', { scroll: false });
    const target = parseFocusParam(raw);
    if (!target) return;
    const outcome = openFocusTarget(target, snapshot.current, useUiStore.getState().select);
    track('deep_link_opened', { kind: target.kind, success: outcome === 'opened' });
    if (outcome !== 'opened') toast({ tone: 'info', title: t(outcome), durationMs: 4000 });
  }, [raw, router, snapshot, t]);
  return null;
}

/**
 * `/game?focus=incident:inc_…` (also `major:`, `vehicle:`, `facility:`) — the links carried by push notifications.
 * Mounted under GameRuntime (the snapshot is loaded).
 */
export function DeepLinkFocus() {
  // `useSearchParams` needs a Suspense boundary above it (static prerender of the route shell).
  return (
    <React.Suspense fallback={null}>
      <DeepLinkFocusEffect />
    </React.Suspense>
  );
}
