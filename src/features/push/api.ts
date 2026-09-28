/**
 * REST wrappers of the web-push routes (contracts/push.ts; ROUTES.md "Push notifications", D-97…D-99).
 * The logout body that drops this device's subscription lives with the other auth calls (`authApi.logout`).
 */
import type { z } from 'zod';
import {
  PushConfigDto,
  PushPreferencesDto,
  PushSubscriptionResult,
  PushTestResult,
  type PushPreferencesBody,
  type PushSubscriptionBody,
} from '@/contracts';
import { api, request } from '@/lib/api/client';

const base = (careerId: string) => `/careers/${careerId}/push`;

export const pushApi = {
  /** Not career-scoped. `enabled: false` = push is off on the server (no VAPID keys or kill switch). */
  config: () => api.get('/push/config', { schema: PushConfigDto }),
  /** Upsert by endpoint (★ command: Idempotency-Key). */
  subscribe: (careerId: string, body: PushSubscriptionBody) =>
    api.command(`${base(careerId)}/subscriptions`, body, { schema: PushSubscriptionResult }),
  /** Always 204, also for an endpoint the server does not know. */
  unsubscribe: (careerId: string, endpoint: string) =>
    request<void>(`${base(careerId)}/subscriptions`, { method: 'DELETE', body: { endpoint } }).then(
      () => undefined,
    ),
  preferences: (careerId: string) => api.get(`${base(careerId)}/preferences`, { schema: PushPreferencesDto }),
  /** The full object or any part of it; the response is what the server saved. */
  updatePreferences: (careerId: string, body: z.infer<typeof PushPreferencesBody>) =>
    api.put(`${base(careerId)}/preferences`, body, { schema: PushPreferencesDto }),
  /** A test push to the caller's own subscriptions (ignores presence, quiet hours and preferences). */
  test: (careerId: string) => api.post(`${base(careerId)}/test`, {}, { schema: PushTestResult }),
};
