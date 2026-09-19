'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { env } from '@/lib/env';
import { gameApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/query-keys';
import { RealtimeController } from '@/lib/realtime/controller';
import { connectMockBus, connectSocket } from '@/lib/realtime/transport';
import type { Effect } from '@/lib/realtime/reconcile';
import { playSound } from '@/lib/sound';
import { useI18nText } from '@/i18n/use-i18n-text';
import { soundEnabled, useSettingsStore } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useLatest } from '@/hooks/use-latest';
import { BrandSplash } from '@/components/brand/splash';
import { Button } from '@/components/ui/button';
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

  const effectRef = useLatest((effect: Effect) => {
    const sound = soundEnabled(useSettingsStore.getState().sound);
    switch (effect.type) {
      case 'incident.new':
        playSound('incident', sound);
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
        toast({
          tone: 'warning',
          title: tn('escalated', { severity: effect.incident.severity }),
          description: effect.incident.address,
        });
        break;
      case 'incident.closed':
        if (effect.result === 'expired')
          toast({ tone: 'warning', title: tn('expired'), description: effect.incident.address });
        break;
      case 'outcome':
        playSound('success', sound);
        break;
      case 'vehicle.arrived':
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
        toast({ tone: 'danger', title: tn('vehicleBrokeDown', { callSign: effect.vehicle.callSign }) });
        break;
      case 'level.reached':
        toast({ tone: 'success', title: tn('levelUp', { level: effect.level }), durationMs: 8000 });
        break;
      case 'stipend.paid':
        toast({ tone: 'success', title: tn('stipendPaid', { amount: effect.amount }) });
        break;
      case 'invalidate': {
        const keys = {
          catalog: [qk.catalog(careerId)],
          economy: [qk.balance(careerId), qk.ledger(careerId), qk.stipend(careerId)],
          progression: [qk.progression(careerId)],
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
  return <CareerProvider value={careerId}>{children}</CareerProvider>;
}
