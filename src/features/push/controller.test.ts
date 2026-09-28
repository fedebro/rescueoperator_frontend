import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushConfigDto } from '@/contracts';
import {
  SERVER_KEY,
  P256DH,
  fakeRegistration,
  fakeSubscription,
  installServiceWorker,
  uninstallServiceWorker,
} from '@/test/push-fakes';
import { CAREER_ID } from '@/test/fixtures';

vi.mock('./api', () => ({
  pushApi: {
    subscribe: vi.fn(async () => ({ id: 'psb_01J8Z0000000000000000000AA' })),
    unsubscribe: vi.fn(async () => undefined),
  },
}));

const { pushApi } = await import('./api');
const { SYNC_TTL_MS, currentPushEndpoint, disablePush, enablePush, forgetPushOnDevice, syncPush } =
  await import('./controller');
const { usePushStore } = await import('./store');

const config: PushConfigDto = {
  enabled: true,
  vapidPublicKey: SERVER_KEY,
  categories: [{ code: 'INCIDENT_NEW', defaultEnabled: true }],
};

/** In-memory Cache API (the worker's copy of what it needs for `pushsubscriptionchange`). */
function installCaches() {
  const store = new Map<string, string>();
  globalThis.caches = {
    open: vi.fn(async () => ({
      put: async (key: string, response: Response) => void store.set(key, await response.text()),
      delete: async (key: string) => store.delete(key),
      match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined),
    })),
  } as unknown as CacheStorage;
  return store;
}

beforeEach(() => {
  usePushStore.setState({ promptedRelease: null, optedOut: false, synced: null });
  vi.mocked(pushApi.subscribe).mockClear();
  vi.mocked(pushApi.unsubscribe).mockClear();
});
afterEach(() => {
  uninstallServiceWorker();
  Reflect.deleteProperty(globalThis, 'caches');
});

describe('enablePush ("Attiva notifiche")', () => {
  it('granted → subscribes with the server key, registers the device and remembers it', async () => {
    const { registration, pushManager } = fakeRegistration();
    installServiceWorker(registration);
    const cache = installCaches();
    usePushStore.setState({ optedOut: true });
    const result = await enablePush(Promise.resolve('granted'), {
      careerId: CAREER_ID,
      config,
      now: () => 1000,
    });
    expect(result).toBe('enabled');
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(pushApi.subscribe).toHaveBeenCalledWith(
      CAREER_ID,
      expect.objectContaining({ platform: 'BROWSER', keys: expect.objectContaining({ p256dh: P256DH }) }),
    );
    const endpoint = vi.mocked(pushApi.subscribe).mock.calls[0]![1].endpoint;
    expect(usePushStore.getState()).toMatchObject({
      optedOut: false,
      synced: { endpoint, careerId: CAREER_ID, at: 1000 },
    });
    // What the worker needs to renew a rotated subscription on its own.
    const saved = JSON.parse([...cache.values()][0]!) as Record<string, string>;
    expect(saved).toMatchObject({
      careerId: CAREER_ID,
      vapidPublicKey: SERVER_KEY,
      platform: 'BROWSER',
      endpoint,
    });
    expect(saved.apiBase).toMatch(/\/api\/v1$/);
  });

  it('denied / dismissed in the browser prompt → nothing subscribed', async () => {
    const { registration, pushManager } = fakeRegistration();
    installServiceWorker(registration);
    expect(await enablePush(Promise.resolve('denied'), { careerId: CAREER_ID, config })).toBe('denied');
    expect(await enablePush(Promise.resolve('default'), { careerId: CAREER_ID, config })).toBe('dismissed');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });

  it('push off on the server, or a subscription that fails → reported, never thrown', async () => {
    const { registration, pushManager } = fakeRegistration();
    installServiceWorker(registration);
    expect(
      await enablePush(Promise.resolve('granted'), {
        careerId: CAREER_ID,
        config: { ...config, enabled: false, vapidPublicKey: null },
      }),
    ).toBe('unavailable');
    pushManager.subscribe.mockRejectedValueOnce(new DOMException('push service not available', 'AbortError'));
    expect(await enablePush(Promise.resolve('granted'), { careerId: CAREER_ID, config })).toBe('failed');
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });
});

describe('syncPush (permission already granted: silent)', () => {
  it('subscribes a device without a subscription and tells the server', async () => {
    const { registration, pushManager } = fakeRegistration();
    installServiceWorker(registration);
    expect(await syncPush({ careerId: CAREER_ID, config, now: () => 5000 })).toBe('synced');
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(pushApi.subscribe).toHaveBeenCalledTimes(1);
  });

  it('skips the server while its record is fresh, re-sends it when stale or for another career', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/existing');
    const { registration, pushManager } = fakeRegistration(existing);
    installServiceWorker(registration);
    usePushStore.setState({
      synced: { endpoint: existing.endpoint, careerId: CAREER_ID, platform: 'BROWSER', at: 1000 },
    });
    expect(await syncPush({ careerId: CAREER_ID, config, now: () => 2000 })).toBe('in-sync');
    expect(pushApi.subscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();

    expect(await syncPush({ careerId: CAREER_ID, config, now: () => 1000 + SYNC_TTL_MS + 1 })).toBe('synced');
    expect(
      await syncPush({
        careerId: 'car_01J8Z0000000000000000000BB',
        config,
        now: () => 1000 + SYNC_TTL_MS + 2,
      }),
    ).toBe('synced');
    expect(pushApi.subscribe).toHaveBeenCalledTimes(2);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('re-sends an unchanged subscription when it is now used from the installed app (Android shares it)', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/shared');
    installServiceWorker(fakeRegistration(existing).registration);
    usePushStore.setState({
      synced: { endpoint: existing.endpoint, careerId: CAREER_ID, platform: 'BROWSER', at: 1000 },
    });
    const standalone = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query: string) => ({ matches: query.includes('standalone') }) as MediaQueryList);
    try {
      expect(await syncPush({ careerId: CAREER_ID, config, now: () => 2000 })).toBe('synced');
      expect(vi.mocked(pushApi.subscribe).mock.calls[0]![1]).toMatchObject({ platform: 'PWA' });
      expect(usePushStore.getState().synced).toMatchObject({ platform: 'PWA' });
    } finally {
      standalone.mockRestore();
    }
  });

  it('replaces a subscription made with a rotated server key', async () => {
    const stale = fakeSubscription('https://fcm.googleapis.com/fcm/send/stale', P256DH);
    const { registration, pushManager } = fakeRegistration(stale);
    installServiceWorker(registration);
    usePushStore.setState({ synced: { endpoint: stale.endpoint, careerId: CAREER_ID, at: Date.now() } });
    expect(await syncPush({ careerId: CAREER_ID, config })).toBe('synced');
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushApi.subscribe).mock.calls[0]![1].endpoint).not.toBe(stale.endpoint);
  });

  it('is "unavailable" without a worker (e.g. a dev build against a real API)', async () => {
    vi.useFakeTimers();
    try {
      installServiceWorker(null);
      const pending = syncPush({ careerId: CAREER_ID, config });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('turning push off', () => {
  it('Settings → off: the server forgets the endpoint, the browser drops it, no silent re-subscription', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/mine');
    const { registration } = fakeRegistration(existing);
    installServiceWorker(registration);
    const cache = installCaches();
    cache.set('/__rc/push-state', '{}');
    usePushStore.setState({ synced: { endpoint: existing.endpoint, careerId: CAREER_ID, at: 1 } });
    await disablePush(CAREER_ID);
    expect(pushApi.unsubscribe).toHaveBeenCalledWith(CAREER_ID, existing.endpoint);
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(usePushStore.getState()).toMatchObject({ optedOut: true, synced: null });
    expect(cache.size).toBe(0);
  });

  it('offline: the browser still drops the subscription', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/mine');
    installServiceWorker(fakeRegistration(existing).registration);
    vi.mocked(pushApi.unsubscribe).mockRejectedValueOnce(new Error('offline'));
    await disablePush(CAREER_ID);
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it('sign-out: reads the endpoint for the logout call, then forgets the subscription (the opt-out choice stays)', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/leaving');
    installServiceWorker(fakeRegistration(existing).registration);
    usePushStore.setState({
      optedOut: false,
      synced: { endpoint: existing.endpoint, careerId: CAREER_ID, at: 1 },
    });
    expect(await currentPushEndpoint()).toBe(existing.endpoint);
    await forgetPushOnDevice();
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(usePushStore.getState()).toMatchObject({ optedOut: false, synced: null });
    expect(pushApi.unsubscribe).not.toHaveBeenCalled();
  });

  it('nothing to read without a worker registration', async () => {
    installServiceWorker(null);
    expect(await currentPushEndpoint()).toBeNull();
    await expect(forgetPushOnDevice()).resolves.toBeUndefined();
  });
});
