'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { env } from '@/lib/env';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { formatClock } from '@/lib/format';
import { RealtimeController } from '@/lib/realtime/controller';
import { connectMockBus, connectSocket } from '@/lib/realtime/transport';
import type { Effect } from '@/lib/realtime/reconcile';
import { NotificationDto } from '@/contracts';
import { track } from '@/lib/analytics';
import { incidentCue, notificationCue, playCue, type SoundName } from '@/lib/sound';
import { useI18nText } from '@/i18n/use-i18n-text';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useLatest } from '@/hooks/use-latest';
import { BrandSplash } from '@/components/brand/splash';
import { Button } from '@/components/ui/button';
import { CoreAnalyticsTracker } from '@/features/platform/core-analytics';
import { InstallHint } from '@/features/platform/install-app';
import { resolveAction, sameText } from '@/features/platform/notifications-model';
import { useNotificationAction } from '@/features/platform/notifications-center';
import { setAnalyticsFlag } from '@/features/platform/platform-bootstrap';
import { isStandalone } from '@/features/platform/pwa';
import { CareerProvider, useSnapshotQuery } from './hooks';

/** Loads the snapshot, runs the realtime controller and turns domain effects into toasts / sounds. */
export function GameRuntime({ careerId, children }: { careerId: string; children: React.ReactNode }) {
  const qc = useQueryClient();
  const t = useTranslations('game');
  const tn = useTranslations('notifications');
  const tx = useI18nText();
  const snapshot = useSnapshotQuery(careerId);
  const setConnection = useUiStore((s) => s.setConnection);
  const select = useUiStore((s) => s.select);
  const loaded = snapshot.isSuccess;

  const runNotificationAction = useNotificationAction();
  const [analytics] = React.useState(() => new CoreAnalyticsTracker());

  const effectRef = useLatest((effect: Effect) => {
    analytics.onEffect(effect);
    // `soundEffects` is the server-side kill switch; the player's own switches live in the settings store.
    const cue = (name: SoundName) => {
      if (snapshot.data?.featureFlags.soundEffects !== false) playCue(name);
    };
    switch (effect.type) {
      case 'incident.new':
        cue(incidentCue(effect.incident.severity));
        toast({
          tone: 'danger',
          title: tn('newIncident'),
          description: `${tx(effect.incident.title)} — ${effect.incident.address}`,
          action: {
            label: tn('open'),
            onClick: () =>
              select({ kind: 'incident', id: effect.incident.id }, { focus: effect.incident.position }),
          },
        });
        break;
      case 'incident.escalated':
        cue('escalation');
        toast({
          tone: 'warning',
          title: tn('escalated', { severity: effect.incident.severity }),
          description: effect.incident.address,
        });
        break;
      case 'incident.closed':
        if (effect.result === 'expired' || effect.result === 'failed') cue('failure');
        if (effect.result === 'expired')
          toast({ tone: 'warning', title: tn('expired'), description: effect.incident.address });
        break;
      case 'outcome':
        cue(effect.outcome.result === 'FAILURE' ? 'failure' : 'success');
        break;
      case 'vehicle.arrived':
        cue('arrived');
        toast({
          tone: 'info',
          title: tn('vehicleArrived', { callSign: effect.vehicle.callSign }),
          durationMs: 3500,
        });
        break;
      case 'vehicle.delivered':
        toast({ tone: 'success', title: tn('vehicleDelivered', { callSign: effect.vehicle.callSign }) });
        break;
      case 'vehicle.broke_down':
        cue('error');
        toast({ tone: 'danger', title: tn('vehicleBrokeDown', { callSign: effect.vehicle.callSign }) });
        break;
      case 'vehicle.rerouted':
        toast({
          tone: 'warning',
          title: tn('vehicleRerouted', { callSign: effect.vehicle.callSign }),
          description:
            effect.delaySeconds > 0
              ? tn('vehicleReroutedDelay', { delay: formatClock(effect.delaySeconds) })
              : undefined,
          durationMs: 6000,
        });
        break;
      // No toast: the tab that ordered the transfer already shows the command's own confirmation, and a second one
      // would duplicate it. The event is here for the cache invalidations it carries (facility + personnel).
      case 'vehicle.transferring':
        break;
      case 'level.reached':
        cue('levelUp');
        toast({ tone: 'success', title: tn('levelUp', { level: effect.level }), durationMs: 8000 });
        break;
      case 'unlock.granted':
        cue('unlock');
        break;
      case 'stipend.paid':
        cue('credits');
        toast({ tone: 'success', title: tn('stipendPaid', { amount: effect.amount }) });
        break;
      case 'notification': {
        const parsed = NotificationDto.safeParse(effect.payload.notification);
        if (!parsed.success) break;
        const n = parsed.data;
        // INFO notifications stay silent: they land in the centre and on the badge only.
        if (n.priority !== 'INFO') cue(notificationCue(n.priority));
        if (n.priority === 'CRITICAL') {
          const hasAction = resolveAction(n.action).type !== 'none';
          toast({
            tone: 'danger',
            title: tx(n.title),
            description: sameText(n.title, n.body) ? undefined : tx(n.body),
            durationMs: 10_000,
            action: hasAction
              ? {
                  label: tn('open'),
                  onClick: () => {
                    track('notification_opened', {
                      notificationId: n.id,
                      category: n.category,
                      priority: n.priority,
                      action: n.action.kind,
                    });
                    runNotificationAction(n);
                  },
                }
              : undefined,
          });
        }
        break;
      }
      case 'invalidate': {
        const keys = {
          catalog: [qk.catalog(careerId)],
          economy: [qk.balance(careerId), qk.ledger(careerId), qk.stipend(careerId)],
          progression: [qk.progression(careerId), qk.milestones(careerId)],
          personnel: [qk.personnelRoot(careerId)],
          medical: [qk.medicalRoot(careerId)],
          inventory: [qk.inventory(careerId)],
          maintenance: [qk.maintenance(careerId)],
          world: [qk.worldRoot(careerId), qk.stipend(careerId)],
          monetization: [qk.monetizationRoot(careerId)],
          notifications: [qk.notifications(careerId)],
          facility: [[...qk.career(careerId), 'facility']],
          config: [qk.catalog(careerId)],
        }[effect.scope];
        for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
        break;
      }
      default:
        break;
    }
  });

  React.useEffect(() => {
    if (!loaded) return;
    const controller = new RealtimeController({
      careerId,
      queryClient: qc,
      connect: (handlers) => (env.apiMock ? connectMockBus(handlers) : connectSocket(careerId, handlers)),
      fetchSnapshot: () => gameApi.sync(careerId),
      fetchDelta: (since) => gameApi.syncSince(careerId, since),
      onEffect: (e) => effectRef.current(e),
      onConnection: setConnection,
    });
    controller.start();
    // Coming back to a backgrounded tab (mobile webviews suspend timers and sockets): resync immediately.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void controller.resync();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Presence heartbeat: the server only generates incidents for players who are actually there (D-11).
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') void controller.resync();
    }, 60_000);
    return () => {
      controller.stop();
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(heartbeat);
    };
  }, [careerId, qc, loaded, setConnection, effectRef]);

  // Product analytics of the core loop: derived from snapshot transitions and the selection (see CoreAnalyticsTracker).
  const data = snapshot.data;
  React.useEffect(() => {
    if (!data) return;
    setAnalyticsFlag(data.featureFlags.analytics !== false);
    analytics.sessionStart(data, {
      layout: window.matchMedia('(min-width: 1024px)').matches ? 'desktop' : 'mobile',
      standalone: isStandalone(),
    });
    analytics.onSnapshot(data);
  }, [data, analytics]);
  React.useEffect(
    () =>
      useUiStore.subscribe((state, previous) => {
        if (state.selection !== previous.selection)
          analytics.onSelection(state.selection, qc.getQueryData(qk.sync(careerId)));
      }),
    [analytics, qc, careerId],
  );

  if (snapshot.isError) {
    return (
      <div className="h-dvh-safe grid place-items-center p-6 text-center">
        <div className="flex max-w-sm flex-col items-center gap-3">
          <p className="font-display text-xl font-bold">{t('loadFailed')}</p>
          <p className="text-muted text-sm">{t('loadFailedHint')}</p>
          <Button onClick={() => void snapshot.refetch()} loading={snapshot.isFetching}>
            {t('retry')}
          </Button>
        </div>
      </div>
    );
  }
  if (!snapshot.data) return <BrandSplash />;
  return (
    <CareerProvider value={careerId}>
      {children}
      <InstallHint tutorialCompleted={snapshot.data.career.tutorial.completed} />
    </CareerProvider>
  );
}
