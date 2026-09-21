'use client';
import * as React from 'react';
import { env } from '@/lib/env';
import { api, getAccessToken } from '@/lib/api/client';
import { platformApi } from '@/lib/api/depth';
import { setAnalyticsSink } from '@/lib/analytics';
import { installSoundUnlock } from '@/lib/sound';
import { analyticsAllowed, useSettingsStore } from '@/stores/settings';
import { AnalyticsClient, createTransport } from './analytics-client';
import { isStandalone, listenForInstall, registerServiceWorker, watchForUpdates } from './pwa';

/** Server-side kill switch (feature flag `analytics` of the snapshot). Unknown before the game loads → allowed. */
let analyticsFlag = true;
let activeClient: AnalyticsClient | null = null;

export function setAnalyticsFlag(enabled: boolean): void {
  analyticsFlag = enabled;
  if (!enabled) activeClient?.clear();
}

const newSessionId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;

/**
 * Mounted once by AppProviders: installs the analytics sink behind `track()`, unlocks audio on the first gesture,
 * captures the PWA install prompt and registers the offline service worker (never in mock mode).
 */
export function PlatformBootstrap() {
  React.useEffect(() => {
    // Random per page load, never stored, not derived from the account: groups the events of one visit.
    const sid = newSessionId();
    const client = new AnalyticsClient({
      isEnabled: () => analyticsFlag && analyticsAllowed(useSettingsStore.getState().analyticsConsent),
      context: () => ({
        sid,
        layout: window.matchMedia('(min-width: 1024px)').matches ? 'desktop' : 'mobile',
        locale: document.documentElement.lang || 'it',
        standalone: isStandalone(),
      }),
      send: createTransport({
        apiUrl: env.apiUrl,
        getAccessToken,
        post: (events, authenticated) =>
          authenticated
            ? platformApi.analytics(events)
            : api.post<void>('/analytics/events', { events }, { auth: false }),
        beacon:
          typeof navigator.sendBeacon === 'function'
            ? (url, data) => navigator.sendBeacon(url, data)
            : undefined,
      }),
    });
    activeClient = client;
    setAnalyticsSink(client.track);
    const stopClient = client.start();
    // Consent withdrawn → drop whatever is still queued, immediately.
    const stopConsent = useSettingsStore.subscribe((state, previous) => {
      if (previous.analyticsConsent === true && state.analyticsConsent !== true) client.clear();
    });
    const stopSound = installSoundUnlock();
    const stopInstall = listenForInstall();
    let stopUpdates: (() => void) | undefined;
    void registerServiceWorker({ apiMock: env.apiMock, nodeEnv: process.env.NODE_ENV }).then(
      (registration) => {
        if (registration) stopUpdates = watchForUpdates(registration);
      },
    );
    return () => {
      stopClient();
      stopConsent();
      stopSound();
      stopInstall();
      stopUpdates?.();
      setAnalyticsSink(() => undefined);
      activeClient = null;
    };
  }, []);
  return null;
}
