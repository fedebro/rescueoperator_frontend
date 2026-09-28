import type { PushConfigDto } from '@/contracts';
import { apiUrl } from '@/lib/api/client';
import { pushApi } from './api';
import { usePushStore } from './store';
import {
  devicePlatform,
  ensureSubscription,
  existingSubscription,
  pushRegistration,
  saveWorkerPushState,
  subscriptionBody,
} from './subscription';

/**
 * The push flows of one device, from the browser to the server and back (D-98). Every function is safe to call at any
 * moment: failures resolve to a result, never throw into the UI.
 */

/** A device re-tells the server about its subscription at most once a day (upsert by endpoint: harmless when unchanged). */
export const SYNC_TTL_MS = 24 * 60 * 60 * 1000;

export type EnableResult = 'enabled' | 'denied' | 'dismissed' | 'unavailable' | 'failed';

interface FlowInput {
  careerId: string;
  config: PushConfigDto;
  now?: () => number;
}

async function registerOnServer(
  careerId: string,
  vapidPublicKey: string,
  subscription: PushSubscription,
  now: number,
): Promise<void> {
  const platform = devicePlatform();
  await pushApi.subscribe(
    careerId,
    subscriptionBody(
      subscription,
      platform,
      typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    ),
  );
  usePushStore.getState().setSynced({ endpoint: subscription.endpoint, careerId, platform, at: now });
  await saveWorkerPushState({
    apiBase: apiUrl(''),
    careerId,
    vapidPublicKey,
    platform,
    endpoint: subscription.endpoint,
  });
}

/**
 * "Attiva notifiche" (sheet or Settings). `permission` is the promise of `Notification.requestPermission()` that the tap
 * handler ALREADY started — synchronously, inside the gesture — so no browser drops the prompt for lack of one.
 */
export async function enablePush(
  permission: Promise<NotificationPermission>,
  { careerId, config, now = Date.now }: FlowInput,
): Promise<EnableResult> {
  const answer = await permission.catch(() => 'default' as NotificationPermission);
  if (answer === 'denied') return 'denied';
  if (answer !== 'granted') return 'dismissed';
  if (!config.enabled || !config.vapidPublicKey) return 'unavailable';
  try {
    const registration = await pushRegistration(15_000);
    if (!registration) return 'unavailable';
    const subscription = await ensureSubscription(registration, config.vapidPublicKey);
    await registerOnServer(careerId, config.vapidPublicKey, subscription, now());
    usePushStore.getState().setOptedOut(false);
    return 'enabled';
  } catch {
    return 'failed';
  }
}

export type SyncResult = 'synced' | 'in-sync' | 'unavailable' | 'failed';

/**
 * Permission already granted: subscribe this device if it is not (new device, lost subscription, rotated server key)
 * and tell the server when its record is missing, stale, or about another endpoint / career / platform. No UI.
 */
export async function syncPush({ careerId, config, now = Date.now }: FlowInput): Promise<SyncResult> {
  if (!config.enabled || !config.vapidPublicKey) return 'unavailable';
  try {
    const registration = await pushRegistration();
    if (!registration) return 'unavailable';
    const subscription = await ensureSubscription(registration, config.vapidPublicKey);
    const record = usePushStore.getState().synced;
    const at = now();
    if (
      record &&
      record.endpoint === subscription.endpoint &&
      record.careerId === careerId &&
      record.platform === devicePlatform() &&
      at - record.at < SYNC_TTL_MS
    )
      return 'in-sync';
    await registerOnServer(careerId, config.vapidPublicKey, subscription, at);
    return 'synced';
  } catch {
    return 'failed';
  }
}

/** This browser's current push endpoint, if any (read without waiting: used on the way out). */
export async function currentPushEndpoint(): Promise<string | null> {
  return (await existingSubscription())?.endpoint ?? null;
}

/** Does this browser hold a push subscription right now? */
export async function hasPushSubscription(): Promise<boolean> {
  return (await existingSubscription()) !== null;
}

/**
 * Settings → off on this device: the server forgets the endpoint, the browser drops the subscription, and a granted
 * permission no longer re-subscribes it silently.
 */
export async function disablePush(careerId: string): Promise<void> {
  usePushStore.getState().setOptedOut(true);
  usePushStore.getState().setSynced(null);
  await saveWorkerPushState(null);
  const subscription = await existingSubscription();
  if (!subscription) return;
  // Offline? The browser still drops the subscription: the push service then answers 404/410 and the server cleans up.
  await pushApi.unsubscribe(careerId, subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

/**
 * Sign-out: the logout call already carried the endpoint (`LogoutBody.pushEndpoint`, the server dropped it); the browser
 * forgets the subscription too. The opt-out choice is kept: whoever signs in next on this device starts from it.
 */
export async function forgetPushOnDevice(): Promise<void> {
  usePushStore.getState().setSynced(null);
  await saveWorkerPushState(null);
  await (await existingSubscription())?.unsubscribe().catch(() => false);
}
