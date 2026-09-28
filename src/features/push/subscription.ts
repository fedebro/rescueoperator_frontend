import type { PushPlatform, PushSubscriptionBody } from '@/contracts';
import { isStandalone } from '@/features/platform/pwa';

/**
 * Thin, testable wrappers around the browser's Push API. No React, no server calls (see `controller.ts`).
 */

/** base64url (no padding) → bytes: the VAPID public key as `applicationServerKey`. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** bytes → base64url without padding. */
export function bytesToUrlBase64(bytes: ArrayBuffer | ArrayBufferView): string {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let raw = '';
  for (const byte of view) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Was this subscription made with the server's current key? A rotated VAPID key needs a new subscription (the push
 * service rejects messages signed with another key). Unknown (a browser that does not expose it) counts as a match.
 */
export function sameApplicationServerKey(subscription: PushSubscription, vapidPublicKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true;
  return bytesToUrlBase64(key) === vapidPublicKey.replace(/=+$/, '');
}

/**
 * The registration that carries the push subscription: `/sw.js` in production, MSW's worker in mock mode. `ready` never
 * settles on a page without a worker, hence the timeout.
 */
export async function pushRegistration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The registration already in place for this page, without waiting for one to activate: enough to read or drop an
 * existing subscription (no registration → no subscription).
 */
export async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** This page's current push subscription, if any. */
export async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await existingRegistration();
  if (!registration?.pushManager) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * `Notification.requestPermission()`, called synchronously by the caller's tap handler (browsers only show their prompt
 * from a user gesture). Older Safari only knows the callback form and returns undefined.
 */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return Promise.resolve('denied');
  try {
    return new Promise<NotificationPermission>((resolve) => {
      const maybe = Notification.requestPermission((result) => resolve(result)) as
        Promise<NotificationPermission> | undefined;
      if (maybe && typeof maybe.then === 'function')
        maybe.then(resolve, () => resolve(Notification.permission));
    });
  } catch {
    return Promise.resolve(Notification.permission);
  }
}

/** This browser's subscription made with `vapidPublicKey` — the existing one when it matches, a new one otherwise. */
export async function ensureSubscription(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameApplicationServerKey(existing, vapidPublicKey)) return existing;
  if (existing) await existing.unsubscribe().catch(() => false);
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export const devicePlatform = (): PushPlatform => (isStandalone() ? 'PWA' : 'BROWSER');

/** `POST …/push/subscriptions` body from a browser subscription. */
export function subscriptionBody(
  subscription: PushSubscription,
  platform: PushPlatform,
  userAgent?: string,
): PushSubscriptionBody {
  const json = subscription.toJSON();
  const key = (name: 'p256dh' | 'auth'): string => {
    const fromJson = json.keys?.[name];
    if (fromJson) return fromJson;
    const raw = subscription.getKey?.(name);
    return raw ? bytesToUrlBase64(raw) : '';
  };
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh: key('p256dh'), auth: key('auth') },
    expirationTime: json.expirationTime ?? subscription.expirationTime ?? null,
    platform,
    ...(userAgent ? { userAgent: userAgent.slice(0, 255) } : {}),
  };
}

/* ───────────── what the service worker needs on its own (`pushsubscriptionchange`) ───────────── */

/** Cache API entry shared with `public/sw.js` (same names there): a tiny key-value store both sides can reach. */
export const WORKER_STATE_CACHE = 'rc-push-state';
export const WORKER_STATE_KEY = '/__rc/push-state';

export interface WorkerPushState {
  /** `https://api…/api/v1` */
  apiBase: string;
  careerId: string;
  vapidPublicKey: string;
  platform: PushPlatform;
  endpoint: string;
}

/** Stores (or, with null, forgets) what the worker needs to renew a subscription the push service rotated. */
export async function saveWorkerPushState(state: WorkerPushState | null): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(WORKER_STATE_CACHE);
    if (state)
      await cache.put(
        WORKER_STATE_KEY,
        new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }),
      );
    else await cache.delete(WORKER_STATE_KEY);
  } catch {
    /* storage blocked: the game re-sends the subscription at its next start anyway */
  }
}
