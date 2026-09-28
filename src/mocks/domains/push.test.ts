import { describe, expect, it } from 'vitest';
import { PushConfigDto, PushPreferencesDto, type RealtimeEnvelope } from '@/contracts';
import { AUTH, P256DH } from '@/test/push-fakes';
import { MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { mockBus } from '../bus';
import { PESCARA } from '../data/pescara';
import { installDomains } from './index';
import {
  MOCK_VAPID_PUBLIC_KEY,
  dropPushEndpoint,
  pushConfig,
  pushState,
  sendTestPush,
  subscribePush,
  unsubscribePush,
  updatePushPreferences,
} from './push';

function world() {
  // A varying (seeded) random source: two careers created at the same instant must still get distinct ids.
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => Date.parse('2026-09-28T09:00:00.000Z'),
    speed: 1,
    emit: (_e: RealtimeEnvelope) => undefined,
    random: () => (seed = (seed * 9301 + 49297) % 233280) / 233280,
  });
  installDomains(engine);
  const careerOf = (email: string): MockCareer => {
    const ch = engine.requestOtp(email);
    const auth = engine.verifyOtp(
      {
        challengeId: ch.challengeId,
        code: OTP_CODE,
        directorName: email.slice(0, 8),
        acceptTerms: true,
        confirmAge: true,
      },
      'vitest',
    );
    const account = engine.authenticate(`Bearer ${auth.accessToken}`);
    const summary = engine.createCareer(account, {
      locationId: PESCARA.id,
      siteId: engine.starterSites()[0]!.id,
    });
    return engine.state.careers[summary.id] as MockCareer;
  };
  return { engine, careerOf };
}

const body = (endpoint: string, patch: Record<string, unknown> = {}) => ({
  endpoint,
  keys: { p256dh: P256DH, auth: AUTH },
  expirationTime: null,
  platform: 'BROWSER',
  userAgent: 'Vitest',
  ...patch,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof MockError
      ? [e.status, e.code, (e.details as { reason?: string } | undefined)?.reason]
      : e;
  }
  return 'no error';
};

describe('mock push backend', () => {
  it('serves a contract-shaped config with a real P-256 key; the kill switch turns it off', () => {
    const { engine } = world();
    const config = pushConfig(engine);
    expect(PushConfigDto.safeParse(config).success).toBe(true);
    expect(config.enabled).toBe(true);
    expect(config.vapidPublicKey).toBe(MOCK_VAPID_PUBLIC_KEY);
    expect(config.categories.find((c) => c.code === 'ECONOMY')?.defaultEnabled).toBe(false);
    expect(config.categories.filter((c) => c.defaultEnabled)).toHaveLength(8);
    engine.state.featureFlags.push_notifications = false;
    expect(pushConfig(engine)).toMatchObject({ enabled: false, vapidPublicKey: null });
  });

  it('subscriptions: validated like the server, upserted by endpoint, moved to whoever registers them last', () => {
    const { engine, careerOf } = world();
    const a = careerOf('push-a@example.com');
    const b = careerOf('push-b@example.com');
    const endpoint = 'https://fcm.googleapis.com/fcm/send/device-1';
    const first = subscribePush(engine, a, body(endpoint));
    expect(first.id).toMatch(/^psb_/);
    expect(subscribePush(engine, a, body(endpoint, { platform: 'PWA' })).id).toBe(first.id);
    expect(pushState(a).subscriptions).toHaveLength(1);
    expect(pushState(a).subscriptions[0]!.platform).toBe('PWA');
    subscribePush(engine, b, body(endpoint));
    expect(pushState(a).subscriptions).toHaveLength(0);
    expect(pushState(b).subscriptions).toHaveLength(1);

    expect(code(() => subscribePush(engine, a, body('http://push.example/x')))).toEqual([
      400,
      'VALIDATION_ERROR',
      'ENDPOINT_NOT_ALLOWED',
    ]);
    expect(
      code(() =>
        subscribePush(
          engine,
          a,
          body('https://x.test/1', { keys: { p256dh: P256DH.slice(0, 84), auth: AUTH } }),
        ),
      ),
    ).toEqual([400, 'VALIDATION_ERROR', 'INVALID_KEYS']);
    expect(code(() => subscribePush(engine, a, { endpoint: 'nope' }))).toEqual([
      400,
      'VALIDATION_ERROR',
      undefined,
    ]);
    engine.state.featureFlags.push_notifications = false;
    expect(code(() => subscribePush(engine, a, body('https://x.test/2')))).toEqual([
      403,
      'FEATURE_DISABLED',
      undefined,
    ]);
  });

  it('unsubscribe always succeeds; logout drops the endpoint wherever it is', () => {
    const { engine, careerOf } = world();
    const a = careerOf('push-c@example.com');
    subscribePush(engine, a, body('https://fcm.googleapis.com/fcm/send/1'));
    subscribePush(engine, a, body('https://fcm.googleapis.com/fcm/send/2'));
    unsubscribePush(engine, a, { endpoint: 'https://fcm.googleapis.com/fcm/send/unknown' });
    unsubscribePush(engine, a, { endpoint: 'https://fcm.googleapis.com/fcm/send/1' });
    expect(pushState(a).subscriptions.map((s) => s.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/2',
    ]);
    expect(dropPushEndpoint(engine, 'https://fcm.googleapis.com/fcm/send/2')).toBe(1);
    expect(pushState(a).subscriptions).toHaveLength(0);
  });

  it('preferences: defaults, partial updates, quiet-hours validation', () => {
    const { engine, careerOf } = world();
    const a = careerOf('push-d@example.com');
    const initial = pushState(a).preferences;
    expect(PushPreferencesDto.safeParse(initial).success).toBe(true);
    expect(initial.quietHours).toEqual({
      enabled: false,
      start: '23:00',
      end: '07:00',
      timeZone: 'Europe/Rome',
    });
    const saved = updatePushPreferences(engine, a, { categories: [{ code: 'ECONOMY', enabled: true }] });
    expect(saved.categories.find((c) => c.code === 'ECONOMY')?.enabled).toBe(true);
    expect(saved.categories.find((c) => c.code === 'INCIDENT_NEW')?.enabled).toBe(true);
    expect(saved.quietHours).toEqual(initial.quietHours);
    const quiet = { enabled: true, start: '22:30', end: '06:45', timeZone: 'America/New_York' };
    expect(updatePushPreferences(engine, a, { quietHours: quiet }).quietHours).toEqual(quiet);
    // The server's reasons (`details.reason`), shown by Settings in the player's words.
    expect(code(() => updatePushPreferences(engine, a, { quietHours: { ...quiet, end: '22:30' } }))).toEqual([
      400,
      'VALIDATION_ERROR',
      'EMPTY_QUIET_HOURS',
    ]);
    expect(
      code(() => updatePushPreferences(engine, a, { quietHours: { ...quiet, timeZone: 'Mars/Olympus' } })),
    ).toEqual([400, 'VALIDATION_ERROR', 'INVALID_TIME_ZONE']);
    expect(
      code(() => updatePushPreferences(engine, a, { quietHours: { ...quiet, start: '25:00' } })),
    ).toEqual([400, 'VALIDATION_ERROR', undefined]);
  });

  it('the test push answers how many subscriptions it would reach, and is recorded', () => {
    const { engine, careerOf } = world();
    const a = careerOf('push-e@example.com');
    expect(sendTestPush(engine, a)).toEqual({ sent: 0 });
    subscribePush(engine, a, body('https://fcm.googleapis.com/fcm/send/t'));
    expect(sendTestPush(engine, a)).toEqual({ sent: 1 });
    expect(pushState(a).tests.map((t) => t.sent)).toEqual([0, 1]);
  });

  it('records the presence the client reports on the bus', async () => {
    const { engine } = world();
    mockBus.presence(true);
    mockBus.presence(false);
    await new Promise((r) => setTimeout(r, 5));
    const presence = (engine.qa.pushPresence as unknown as () => { visible: boolean; reports: number })();
    expect(presence.visible).toBe(false);
    expect(presence.reports).toBeGreaterThanOrEqual(2);
  });
});
