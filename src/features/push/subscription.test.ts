import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushSubscriptionBody } from '@/contracts';
import { AUTH, P256DH, SERVER_KEY, fakeRegistration, fakeSubscription } from '@/test/push-fakes';
import {
  bytesToUrlBase64,
  ensureSubscription,
  pushRegistration,
  requestNotificationPermission,
  sameApplicationServerKey,
  subscriptionBody,
  urlBase64ToUint8Array,
} from './subscription';

describe('base64url', () => {
  it('round-trips the VAPID key (65-byte uncompressed P-256 point)', () => {
    const bytes = urlBase64ToUint8Array(SERVER_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(bytesToUrlBase64(bytes)).toBe(SERVER_KEY);
    expect(bytesToUrlBase64(bytes.buffer)).toBe(SERVER_KEY);
    expect(urlBase64ToUint8Array(AUTH)).toHaveLength(16);
  });

  it('compares a subscription key with the server key (unknown counts as the same)', () => {
    expect(sameApplicationServerKey(fakeSubscription('https://x.test/a'), SERVER_KEY)).toBe(true);
    expect(sameApplicationServerKey(fakeSubscription('https://x.test/a'), P256DH)).toBe(false);
    expect(sameApplicationServerKey(fakeSubscription('https://x.test/a', null), P256DH)).toBe(true);
  });
});

describe('ensureSubscription', () => {
  it('subscribes with userVisibleOnly and the server key when there is no subscription', async () => {
    const { registration, pushManager } = fakeRegistration();
    const subscription = await ensureSubscription(registration, SERVER_KEY);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const options = pushManager.subscribe.mock.calls[0]![0];
    expect(options.userVisibleOnly).toBe(true);
    expect(bytesToUrlBase64(options.applicationServerKey as Uint8Array)).toBe(SERVER_KEY);
    expect(subscription.endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//);
  });

  it('keeps a subscription made with the same key, replaces one made with a rotated key', async () => {
    const same = fakeSubscription('https://fcm.googleapis.com/fcm/send/same');
    const kept = fakeRegistration(same);
    expect(await ensureSubscription(kept.registration, SERVER_KEY)).toBe(same);
    expect(kept.pushManager.subscribe).not.toHaveBeenCalled();

    const stale = fakeSubscription('https://fcm.googleapis.com/fcm/send/stale', P256DH);
    const rotated = fakeRegistration(stale);
    const fresh = await ensureSubscription(rotated.registration, SERVER_KEY);
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(rotated.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(fresh.endpoint).not.toBe(stale.endpoint);
  });
});

describe('subscriptionBody', () => {
  it('builds a body the contract accepts (keys from toJSON, platform, user agent capped)', () => {
    const body = subscriptionBody(
      fakeSubscription('https://fcm.googleapis.com/fcm/send/abc'),
      'PWA',
      'x'.repeat(400),
    );
    expect(PushSubscriptionBody.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: P256DH, auth: AUTH },
      expirationTime: null,
      platform: 'PWA',
    });
    expect(body.userAgent).toHaveLength(255);
  });

  it('falls back to getKey() when toJSON has no keys (older engines)', () => {
    const sub = fakeSubscription('https://updates.push.services.mozilla.com/wpush/v2/x');
    (sub as unknown as { toJSON: () => unknown }).toJSON = () => ({ endpoint: sub.endpoint });
    expect(subscriptionBody(sub, 'BROWSER').keys).toEqual({ p256dh: P256DH, auth: AUTH });
  });
});

describe('requestNotificationPermission', () => {
  const original = globalThis.Notification;
  afterEach(() => {
    globalThis.Notification = original;
  });

  it('supports the promise form and the old callback-only Safari form', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: vi.fn(async () => 'granted'),
    } as unknown as typeof Notification;
    expect(await requestNotificationPermission()).toBe('granted');

    globalThis.Notification = {
      permission: 'default',
      requestPermission: vi.fn((callback: (p: NotificationPermission) => void) => {
        setTimeout(() => callback('denied'), 0);
        return undefined;
      }),
    } as unknown as typeof Notification;
    expect(await requestNotificationPermission()).toBe('denied');
  });

  it('calls the browser synchronously (inside the tap), before any await', () => {
    const request = vi.fn(async () => 'granted' as NotificationPermission);
    globalThis.Notification = {
      permission: 'default',
      requestPermission: request,
    } as unknown as typeof Notification;
    void requestNotificationPermission();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('answers "denied" where the Notification API does not exist', async () => {
    // @ts-expect-error — simulating a browser without the API
    delete globalThis.Notification;
    expect(await requestNotificationPermission()).toBe('denied');
  });
});

describe('pushRegistration', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.useRealTimers();
  });

  it('resolves the ready registration, or null after the timeout when no worker ever activates', async () => {
    const registration = { scope: '/' } as ServiceWorkerRegistration;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
    });
    expect(await pushRegistration(50)).toBe(registration);

    vi.useFakeTimers();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: new Promise(() => undefined) },
      configurable: true,
    });
    const pending = pushRegistration(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBeNull();
  });

  it('is null without service workers', async () => {
    expect(await pushRegistration(10)).toBeNull();
  });
});
