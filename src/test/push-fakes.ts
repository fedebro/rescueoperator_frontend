import { vi } from 'vitest';
import { bytesToUrlBase64, urlBase64ToUint8Array } from '@/features/push/subscription';

/** A real P-256 point (65 bytes, the mock server's VAPID public key) and a p256dh / auth pair, base64url. */
export const SERVER_KEY =
  'BGGO83ZkbboQc3HONcR__k7uHXyVmLBsOaEhKiGSIfEu7w3ftU4hGVs_gKH-MM-bPYwEyFugl3utv_0Sd3wNbj0';
export const P256DH =
  'BDjl9XCbXSiz0K1Rjn4FOWKXj91QpQu-qX558oUWva01BwByVN5yuOeGg9misRBTqtAfXa7bmDQrpV1RJxHb3lk';
export const AUTH = 'UE93ShGK4TBATgCzSBaWUA';

export type FakeSubscription = PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };

/** A PushSubscription as the browser hands it out. */
export function fakeSubscription(endpoint: string, serverKey: string | null = SERVER_KEY): FakeSubscription {
  return {
    endpoint,
    expirationTime: null,
    options: {
      userVisibleOnly: true,
      applicationServerKey: serverKey ? urlBase64ToUint8Array(serverKey).buffer : null,
    },
    getKey: (name: 'p256dh' | 'auth') => urlBase64ToUint8Array(name === 'p256dh' ? P256DH : AUTH).buffer,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
    unsubscribe: vi.fn(async () => true),
  } as unknown as FakeSubscription;
}

let counter = 0;

/** A registration whose PushManager starts with `current` (or nothing) and hands out new subscriptions. */
export function fakeRegistration(current: PushSubscription | null = null) {
  const state = { subscription: current };
  const pushManager = {
    getSubscription: vi.fn(async () => state.subscription),
    subscribe: vi.fn(async (options: PushSubscriptionOptionsInit) => {
      counter += 1;
      const sub = fakeSubscription(
        `https://fcm.googleapis.com/fcm/send/new-${counter}`,
        bytesToUrlBase64(options.applicationServerKey as ArrayBuffer),
      );
      sub.unsubscribe.mockImplementation(async () => {
        if (state.subscription === sub) state.subscription = null;
        return true;
      });
      state.subscription = sub;
      return sub;
    }),
  };
  return { registration: { pushManager } as unknown as ServiceWorkerRegistration, pushManager, state };
}

/** Installs `navigator.serviceWorker` with this registration as both `ready` and `getRegistration()`. */
export function installServiceWorker(registration: ServiceWorkerRegistration | null): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: registration ? Promise.resolve(registration) : new Promise(() => undefined),
      getRegistration: vi.fn(async () => registration ?? undefined),
    },
    configurable: true,
  });
}

export function uninstallServiceWorker(): void {
  Reflect.deleteProperty(navigator, 'serviceWorker');
}
