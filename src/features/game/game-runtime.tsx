'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { env } from '@/lib/env';
import { gameApi } from '@/lib/api/endpoints';
import { invalidateFresh } from '@/lib/api/invalidate';
import { qk } from '@/lib/api/query-keys';
import { formatAmount, formatClock } from '@/lib/format';
import { RealtimeController } from '@/lib/realtime/controller';
import { AllianceRealtimeController } from '@/lib/realtime/alliance-controller';
import type { AllianceEffect } from '@/lib/realtime/alliance-reconcile';
import { connectMockBus, connectSocket } from '@/lib/realtime/transport';
import { allianceApi } from '@/lib/api/alliance';
import { allianceOf } from '@/features/alliance/snapshot';
import type { Effect } from '@/lib/realtime/reconcile';
import { NotificationDto, type MajorIncidentDto } from '@/contracts';
import { track } from '@/lib/analytics';
import { incidentCue, notificationCue, playCue, type SoundName } from '@/lib/sound';
import { useI18nText } from '@/i18n/use-i18n-text';
import { useCatalogReady } from '@/i18n/catalog-texts';
import { toast } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useLatest } from '@/hooks/use-latest';
import { BrandSplash } from '@/components/brand/splash';
import { Button } from '@/components/ui/button';
import { CoreAnalyticsTracker } from '@/features/platform/core-analytics';
import { InstallHint } from '@/features/platform/install-app';
import { PushRuntime } from '@/features/push/push-prompt';
import { DeepLinkFocus } from '@/features/push/deep-link-focus';
import {
  isSevereIncidentNotification,
  resolveAction,
  sameText,
} from '@/features/platform/notifications-model';
import { useNotificationAction } from '@/features/platform/notifications-center';
import { setAnalyticsFlag } from '@/features/platform/platform-bootstrap';
import { isStandalone } from '@/features/platform/pwa';
import { useAutonomyCoaching } from '@/features/autonomy/coaching';
import { refreshFleetAutonomy } from '@/features/autonomy/refresh';
import { incidentScene } from '@/features/water/water';
import { useOpenMajor } from '@/features/major/hooks';
import { acknowledgedMajors, isMajorNotification, isMajorStartNotification } from '@/features/major/major';
import { useMajorStore } from '@/features/major/store';
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
  const router = useRouter();
  const loaded = snapshot.isSuccess;
  // Toast texts are resolved when the event arrives: a call reported before the catalog texts are there is announced by
  // its address alone rather than by a raw key (the list and the inspector re-render with the title a moment later).
  const catalogReady = useLatest(useCatalogReady());

  const runNotificationAction = useNotificationAction();
  const autonomyCoaching = useAutonomyCoaching(careerId);
  const tm = useTranslations('maxi.toast');
  const ta = useTranslations('autonomy.bingo');
  const locale = useLocale();
  const openMajor = useOpenMajor();
  const [analytics] = React.useState(() => new CoreAnalyticsTracker());

  const effectRef = useLatest((effect: Effect) => {
    analytics.onEffect(effect);
    // `soundEffects` is the server-side kill switch; the player's own switches live in the settings store.
    const cue = (name: SoundName) => {
      if (snapshot.data?.featureFlags.soundEffects !== false) playCue(name);
    };
    /**
     * A change of a major (D-24): the coordination view's cache follows the event; the start raises the full-screen alert
     * (once per major and device), a new phase says so, the end sums up the bonus with a way to the summary.
     */
    const onMajor = (major: MajorIncidentDto, started: boolean) => {
      const key = qk.major(careerId, major.id);
      const previous = qc.getQueryData<MajorIncidentDto>(key);
      // A read of this major still in flight (the 20 s poll, or the re-read after a member changed) carries an older
      // snapshot: drop it, or it lands after this push and puts an ended major back to ACTIVE until the next poll.
      void qc.cancelQueries({ queryKey: key, exact: true }, { revert: false, silent: true });
      qc.setQueryData(key, major);
      qc.setQueryData(qk.majorCurrent(careerId), major.status === 'ACTIVE' ? major : null);
      if (started) {
        void invalidateFresh(qc, qk.majorList(careerId));
        if (!acknowledgedMajors(careerId).has(major.id)) useMajorStore.getState().showAlert(major.id);
        return;
      }
      if (major.status === 'ACTIVE' && previous && previous.phase !== major.phase)
        toast({
          tone: 'info',
          title: tm('phase', { phase: tx({ key: `major.phase.${major.phase}.name` }) }),
          durationMs: 4000,
          action: { label: tm('coordinate'), onClick: () => openMajor(major.id, major.center) },
        });
      if (major.status === 'ENDED' && previous?.status !== 'ENDED') {
        if (useMajorStore.getState().alertId === major.id) useMajorStore.getState().dismissAlert();
        void invalidateFresh(qc, qk.majorList(careerId));
        void invalidateFresh(qc, qk.majorTrophies(careerId));
        cue(major.outcome === 'FAILURE' ? 'failure' : 'success');
        const medal = major.reward.medal ? tx({ key: `major.medal.${major.reward.medal}.title` }) : null;
        const credits =
          major.reward.credits && major.reward.credits !== '0'
            ? tm('endedBody', { credits: formatAmount(major.reward.credits, locale) })
            : null;
        toast({
          tone: major.outcome === 'SUCCESS' ? 'success' : 'warning',
          title: tx({ key: `major.outcome.${major.outcome ?? 'SUCCESS'}` }),
          description: [credits, medal].filter(Boolean).join(' · ') || undefined,
          durationMs: 10_000,
          action: { label: tm('summary'), onClick: () => openMajor(major.id, major.center) },
        });
      }
    };
    switch (effect.type) {
      case 'incident.new':
        if (effect.incident.major) {
          // A major's members never get the normal "new call" alert: the major has its own (full-screen) one. A linked
          // incident born later in the event (phase, growth) still says so, in the major's words.
          if (effect.incident.major.phase === 'ALARM') break;
          cue('notification.important');
          toast({
            tone: 'warning',
            title: tm('linked'),
            description: `${tx(effect.incident.title)} — ${effect.incident.placeText ? tx(effect.incident.placeText) : effect.incident.address}`,
            action: {
              label: tn('open'),
              onClick: () => {
                select(
                  { kind: 'incident', id: effect.incident.id },
                  { focus: incidentScene(effect.incident) },
                );
                if (window.location.pathname !== '/game') router.push('/game');
              },
            },
          });
          break;
        }
        cue(incidentCue(effect.incident.severity));
        toast({
          tone: 'danger',
          title: tn('newIncident'),
          description: catalogReady.current
            ? `${tx(effect.incident.title)} — ${effect.incident.placeText ? tx(effect.incident.placeText) : effect.incident.address}`
            : effect.incident.address,
          action: {
            label: tn('open'),
            // From any page, not only the map (03 §2.8): select it, then bring the map (and its sheet) up.
            onClick: () => {
              select({ kind: 'incident', id: effect.incident.id }, { focus: incidentScene(effect.incident) });
              if (window.location.pathname !== '/game') router.push('/game');
            },
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
        // An inspector left open on it can then say how it ended instead of vanishing (02 §4 #8).
        useUiStore
          .getState()
          .noteIncidentClosed(effect.incident.id, { result: effect.result, title: effect.incident.title });
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
      // Vehicle autonomy (D-22): the two one-off coaching lines.
      case 'vehicle.returned':
        autonomyCoaching.onReturned(effect.vehicle);
        break;
      case 'vehicle.reserve':
        autonomyCoaching.onReserve(effect.vehicle);
        break;
      // Flight endurance: an aircraft turned back at "bingo" (and flies back on its own once refuelled).
      case 'vehicle.bingo': {
        const vehicle = effect.vehicle;
        if (effect.queuedIncidentId)
          useMajorStore.getState().rememberResume(vehicle.id, effect.queuedIncidentId);
        cue('notification.important');
        // The one-off coaching line first: on phones the newest toast is the one in front, and it must be the one
        // with the way to the aircraft ("Vedi").
        autonomyCoaching.onBingo(vehicle);
        toast({
          tone: 'warning',
          title: ta('title', { callSign: vehicle.callSign }),
          description: effect.queuedIncidentId ? ta('resume') : ta('home'),
          durationMs: 7000,
          action: {
            label: ta('show'),
            onClick: () => {
              select({ kind: 'vehicle', id: vehicle.id });
              if (window.location.pathname !== '/game') router.push('/game');
            },
          },
        });
        break;
      }
      case 'vehicle.committed': {
        const resume = useMajorStore.getState().flightResume[effect.vehicle.id];
        if (!resume) break;
        useMajorStore.getState().clearResume(effect.vehicle.id);
        if (resume === effect.incidentId)
          toast({
            tone: 'info',
            title: ta('resumed', { callSign: effect.vehicle.callSign }),
            durationMs: 4000,
          });
        break;
      }
      case 'major.updated':
        onMajor(effect.major, effect.started);
        break;
      case 'level.reached':
        cue('levelUp');
        toast({ tone: 'success', title: tn('levelUp', { level: effect.level }), durationMs: 8000 });
        // Onboard stock (level 2) and fuel (level 3) unlock for the whole fleet without a vehicle event (D-22).
        void refreshFleetAutonomy(qc, careerId);
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
        // The start of a major has its own alarm (the full-screen alert and its siren): no second one here.
        if (isMajorStartNotification(n)) break;
        // A severe new call is announced by its own "Nuova emergenza" toast and cue: the notification only lands in the
        // centre and on the badge (with its "open the incident" action there).
        if (isSevereIncidentNotification(n)) break;
        // INFO notifications stay silent: they land in the centre and on the badge only.
        if (n.priority !== 'INFO') cue(notificationCue(n.priority));
        // Alliance news (a join request, an invite, a role, a removal…) concerns the section: re-read it (D-102…D-123).
        if (n.category === 'ALLIANCE') void invalidateFresh(qc, qk.allianceRoot(careerId));
        // A major's growth and its reinforcements on scene (the end has its own summary toast, see `major.updated`).
        if (isMajorNotification(n) && !n.title.key.includes('.ENDED_') && n.priority !== 'CRITICAL') {
          toast({
            tone: n.priority === 'IMPORTANT' ? 'warning' : 'info',
            title: tx(n.title),
            description: sameText(n.title, n.body) ? undefined : tx(n.body),
            durationMs: 6000,
            action:
              resolveAction(n.action).type !== 'none'
                ? { label: tm('coordinate'), onClick: () => runNotificationAction(n) }
                : undefined,
          });
          break;
        }
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
          major: [qk.majorRoot(careerId)],
          alliance: [qk.allianceRoot(careerId)],
          notifications: [qk.notifications(careerId)],
          facility: [[...qk.career(careerId), 'facility']],
          config: [qk.catalog(careerId)],
        }[effect.scope];
        for (const queryKey of keys) void invalidateFresh(qc, queryKey);
        break;
      }
      default:
        break;
    }
  });

  // My allied column settled or came back (05 §6): one toast per column and outcome; never one per chat message (03 §4.1).
  const tal = useTranslations('alliance.aid');
  const seenColumns = React.useRef(new Set<string>());
  const allianceEffectRef = useLatest((effect: AllianceEffect) => {
    if (effect.type !== 'column.updated' || !effect.column.mine) return;
    const c = effect.column;
    const key = `${c.id}:${c.status}:${c.reward.status}`;
    if (seenColumns.current.has(key)) return;
    seenColumns.current.add(key);
    if (c.status === 'ABORTED') toast({ tone: 'info', title: tal('toast.aborted'), durationMs: 5000 });
    else if (c.status === 'ON_SCENE')
      toast({
        tone: 'info',
        title: tal('toast.onScene', { name: c.requester.directorName ?? '' }),
        durationMs: 4000,
      });
    else if (c.reward.status === 'PAID')
      toast({
        tone: 'success',
        title: tal('toast.paid', { credits: formatAmount(c.reward.credits ?? '0', locale) }),
        durationMs: 8000,
      });
    else if (c.reward.status === 'CAPPED')
      toast({ tone: 'info', title: tal('toast.capped'), durationMs: 6000 });
    else if (c.reward.status === 'UNDER_REVIEW')
      toast({ tone: 'warning', title: tal('toast.review'), durationMs: 6000 });
    else if (
      c.reward.status === 'NONE' &&
      (c.status === 'RETURNING' || c.status === 'RETURNED' || c.status === 'RECALLED')
    )
      toast({ tone: 'info', title: tal('toast.none'), durationMs: 5000 });
  });
  const allianceControllerRef = React.useRef<AllianceRealtimeController | null>(null);
  React.useEffect(() => {
    if (!loaded) return;
    // The alliance stream (D-102…D-123): same socket, event `alliance`, its own sequence and replay.
    const alliance = new AllianceRealtimeController({
      careerId,
      queryClient: qc,
      fetchDelta: (since) => allianceApi.sync(careerId, since),
      onEffect: (effect) => allianceEffectRef.current(effect),
    });
    allianceControllerRef.current = alliance;
    const controller = new RealtimeController({
      careerId,
      queryClient: qc,
      connect: (handlers) => (env.apiMock ? connectMockBus(handlers) : connectSocket(careerId, handlers)),
      fetchSnapshot: () => gameApi.sync(careerId),
      fetchDelta: (since) => gameApi.syncSince(careerId, since),
      onEffect: (e) => effectRef.current(e),
      onConnection: setConnection,
      onAllianceEvent: (raw) => alliance.handle(raw),
      onReconnected: () => void alliance.resync(),
    });
    controller.start();
    alliance.start();
    const resyncAll = () => {
      void controller.resync();
      void alliance.resync();
    };
    // Coming back to a backgrounded tab (mobile webviews suspend timers and sockets): resync immediately.
    const onVisible = () => {
      if (document.visibilityState === 'visible') resyncAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Presence heartbeat: the server only generates incidents for players who are actually there (D-11).
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') resyncAll();
    }, 60_000);
    return () => {
      controller.stop();
      alliance.stop();
      allianceControllerRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(heartbeat);
    };
  }, [careerId, qc, loaded, setConnection, effectRef, allianceEffectRef]);
  // Joined or left an alliance: the stream's sequence belongs to the new alliance (or to none).
  const allianceId = snapshot.data ? (allianceOf(snapshot.data)?.id ?? null) : null;
  const previousAllianceId = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (previousAllianceId.current !== undefined && previousAllianceId.current !== allianceId)
      allianceControllerRef.current?.reset();
    previousAllianceId.current = allianceId;
  }, [allianceId]);

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
      {/* Web push (D-97…D-99): the once-per-release permission sheet, silent re-subscription, notification deep links. */}
      <PushRuntime tutorialCompleted={snapshot.data.career.tutorial.completed} />
      <DeepLinkFocus />
    </CareerProvider>
  );
}
