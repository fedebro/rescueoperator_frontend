import type { z } from 'zod';
import {
  PushCategory,
  PushPreferencesBody,
  PushSubscriptionBody,
  type PushConfigDto,
  type PushPlatform,
  type PushPreferencesDto,
} from '@/contracts';
import { mockBus } from '../bus';
import { MockError, type MockCareer, type MockEngine } from '../engine';
import { domainState } from './index';

/**
 * Web push in the mock backend (D-97…D-99, contracts/push.ts). The browser cannot receive a push from here — there is no
 * push service behind the mock — but everything around it is real: the config, subscriptions (upsert by endpoint,
 * contract validation), preferences with quiet hours, the test endpoint, the logout clean-up and the client's presence.
 */

/**
 * A real P-256 public key (65-byte uncompressed point, base64url): browsers validate `applicationServerKey`, so a dev
 * session with the mock can subscribe for real. Its private half was never kept — nothing is ever signed with it.
 */
export const MOCK_VAPID_PUBLIC_KEY =
  'BGGO83ZkbboQc3HONcR__k7uHXyVmLBsOaEhKiGSIfEu7w3ftU4hGVs_gKH-MM-bPYwEyFugl3utv_0Sd3wNbj0';

/** Every category is on by default except ECONOMY (D-97). */
export const PUSH_CATEGORIES: PushConfigDto['categories'] = PushCategory.options.map((code) => ({
  code,
  defaultEnabled: code !== 'ECONOMY',
}));

export interface MockPushSubscription {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
  platform: PushPlatform;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PushDomainState {
  subscriptions: MockPushSubscription[];
  preferences: PushPreferencesDto;
  /** Test pushes requested (`POST …/push/test`), newest last. */
  tests: { at: string; sent: number }[];
}

const defaultPreferences = (): PushPreferencesDto => ({
  categories: PUSH_CATEGORIES.map(({ code, defaultEnabled }) => ({ code, enabled: defaultEnabled })),
  quietHours: { enabled: false, start: '23:00', end: '07:00', timeZone: 'Europe/Rome' },
});

export const pushState = (career: MockCareer): PushDomainState =>
  domainState<PushDomainState>(career, 'push', () => ({
    subscriptions: [],
    preferences: defaultPreferences(),
    tests: [],
  }));

/** `push_notifications` is the server's kill switch (on unless a QA step turns it off). */
export function pushConfig(engine: MockEngine): PushConfigDto {
  const enabled = engine.state.featureFlags.push_notifications !== false;
  return { enabled, vapidPublicKey: enabled ? MOCK_VAPID_PUBLIC_KEY : null, categories: PUSH_CATEGORIES };
}

const validation = (reason: string, message: string) =>
  new MockError(400, 'VALIDATION_ERROR', message, { reason });

/** https only (plus a local http endpoint, as the real server allows outside production). */
function endpointAllowed(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}

const base64UrlBytes = (value: string): number | null => {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  return Math.floor((value.replace(/=+$/, '').length * 3) / 4);
};

/** Removes an endpoint from every career (a browser's endpoint belongs to one account at a time). */
export function dropPushEndpoint(engine: MockEngine, endpoint: string): number {
  let removed = 0;
  for (const career of Object.values(engine.state.careers)) {
    const state = career.ext.push as PushDomainState | undefined;
    if (!state) continue;
    const before = state.subscriptions.length;
    state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint);
    removed += before - state.subscriptions.length;
  }
  return removed;
}

export function subscribePush(engine: MockEngine, career: MockCareer, body: unknown): { id: string } {
  if (!pushConfig(engine).enabled) throw new MockError(403, 'FEATURE_DISABLED', 'Push notifications are off');
  const parsed = PushSubscriptionBody.safeParse(body);
  if (!parsed.success)
    throw new MockError(400, 'VALIDATION_ERROR', 'Invalid push subscription', {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  const data = parsed.data;
  if (!endpointAllowed(data.endpoint)) throw validation('ENDPOINT_NOT_ALLOWED', 'Endpoint not allowed');
  if (base64UrlBytes(data.keys.p256dh) !== 65 || base64UrlBytes(data.keys.auth) !== 16)
    throw validation('INVALID_KEYS', 'Invalid subscription keys');
  const state = pushState(career);
  const now = new Date(engine.now()).toISOString();
  const existing = state.subscriptions.find((s) => s.endpoint === data.endpoint);
  if (existing) {
    Object.assign(existing, {
      keys: data.keys,
      expirationTime: data.expirationTime ?? null,
      platform: data.platform,
      userAgent: data.userAgent?.slice(0, 255) ?? null,
      updatedAt: now,
    });
    engine.save();
    return { id: existing.id };
  }
  // Upsert by endpoint: registered by another account on the same browser → it moves to the caller.
  dropPushEndpoint(engine, data.endpoint);
  const subscription: MockPushSubscription = {
    id: engine.id('psb'),
    endpoint: data.endpoint,
    keys: data.keys,
    expirationTime: data.expirationTime ?? null,
    platform: data.platform,
    userAgent: data.userAgent?.slice(0, 255) ?? null,
    createdAt: now,
    updatedAt: now,
  };
  state.subscriptions.push(subscription);
  engine.save();
  return { id: subscription.id };
}

/** Always succeeds (unknown endpoints included), like the real `DELETE`. */
export function unsubscribePush(engine: MockEngine, career: MockCareer, body: Record<string, unknown>): void {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  if (!endpoint) throw new MockError(400, 'VALIDATION_ERROR', 'endpoint is required');
  const state = pushState(career);
  state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint);
  engine.save();
}

const validTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export function updatePushPreferences(
  engine: MockEngine,
  career: MockCareer,
  body: unknown,
): PushPreferencesDto {
  const parsed = PushPreferencesBody.safeParse(body);
  if (!parsed.success)
    throw new MockError(400, 'VALIDATION_ERROR', 'Invalid push preferences', {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  const { categories, quietHours } = parsed.data as z.infer<typeof PushPreferencesBody>;
  if (quietHours) {
    if (quietHours.enabled && quietHours.start === quietHours.end)
      throw validation('EMPTY_QUIET_HOURS', 'Quiet hours: start must differ from end');
    if (!validTimeZone(quietHours.timeZone))
      throw validation('INVALID_TIME_ZONE', 'Quiet hours: unknown time zone');
  }
  const state = pushState(career);
  state.preferences = {
    categories: state.preferences.categories.map(
      (c) => categories?.find((next) => next.code === c.code) ?? c,
    ),
    quietHours: quietHours ?? state.preferences.quietHours,
  };
  engine.save();
  return state.preferences;
}

/** The mock cannot deliver it: it records the request and answers how many subscriptions it would reach. */
export function sendTestPush(engine: MockEngine, career: MockCareer): { sent: number } {
  if (!pushConfig(engine).enabled) throw new MockError(403, 'FEATURE_DISABLED', 'Push notifications are off');
  const state = pushState(career);
  const sent = state.subscriptions.length;
  state.tests.push({ at: new Date(engine.now()).toISOString(), sent });
  if (state.tests.length > 20) state.tests.splice(0, state.tests.length - 20);
  engine.save();
  return { sent };
}

export interface PushPresence {
  visible: boolean;
  at: string;
  /** How many reports so far (a new socket, every visibility change). */
  reports: number;
}

/** Simulation of the `push` area: QA helpers and the presence the client reports on the bus. */
export function installPush(engine: MockEngine): void {
  const presence = (): PushPresence =>
    (engine.state.ext.pushPresence ??= { visible: false, at: '', reports: 0 }) as PushPresence;
  mockBus.onPresence((visible) => {
    const current = presence();
    current.visible = visible;
    current.at = new Date(engine.now()).toISOString();
    current.reports += 1;
  });
  /** QA: this career's push subscriptions. */
  engine.qa.pushSubscriptions = (() => pushState(engine.qa.career()).subscriptions) as never;
  /** QA: this career's push preferences. */
  engine.qa.pushPreferences = (() => pushState(engine.qa.career()).preferences) as never;
  /** QA: the test pushes requested so far. */
  engine.qa.pushTests = (() => pushState(engine.qa.career()).tests) as never;
  /** QA: the last presence the client reported (`{ visible, at, reports }`). */
  engine.qa.pushPresence = (() => ({ ...presence() })) as never;
}
