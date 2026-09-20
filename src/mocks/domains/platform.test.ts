import { describe, expect, it } from 'vitest';
import { NotificationDto, SyncSnapshot, type RealtimeEnvelope } from '@/contracts';
import { MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { installDomains } from './index';
import { PESCARA } from '../data/pescara';
import {
  ANALYTICS_RETENTION,
  analyticsLog,
  ingestAnalytics,
  listNotifications,
  readAllNotifications,
  readNotification,
  unreadOf,
} from './platform';

function world() {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: RealtimeEnvelope[] = [];
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed: 1,
    emit: (e) => events.push(e),
    random: () => 0.42,
  });
  installDomains(engine);
  const ch = engine.requestOtp('platform@example.com');
  const auth = engine.verifyOtp(
    {
      challengeId: ch.challengeId,
      code: OTP_CODE,
      directorName: 'Director P',
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
  const career = engine.state.careers[summary.id] as MockCareer;
  return { engine, career, account, events, tick: (ms: number) => (now += ms) };
}

const notify = (w: ReturnType<typeof world>, ...args: unknown[]) =>
  (w.engine.qa.notify as unknown as (...a: unknown[]) => string)(...args);

describe('mock notifications', () => {
  it('qa.notify creates contract-shaped notifications and emits notification.created with the unread count', () => {
    const w = world();
    const base = unreadOf(w.career);
    const id = notify(w, 'FLEET', 'CRITICAL');
    const created = listNotifications(w.career)[0]!;
    expect(created.id).toBe(id);
    expect(NotificationDto.safeParse(created).success).toBe(true);
    expect(created).toMatchObject({ category: 'FLEET', priority: 'CRITICAL', readAt: null });
    expect(created.action.kind).toBe('OPEN_VEHICLE');
    const event = w.events.at(-1)!;
    expect(event.type).toBe('notification.created');
    expect(event.payload).toMatchObject({ unreadNotifications: base + 1 });
  });

  it('targets a real entity when the category has one', () => {
    const w = world();
    notify(w, 'FACILITIES', 'INFO');
    expect(listNotifications(w.career)[0]!.action).toEqual({
      kind: 'OPEN_FACILITY',
      targetId: w.career.facilities[0]!.id,
    });
    notify(w, 'SYSTEM', 'INFO');
    expect(listNotifications(w.career)[0]!.action).toEqual({ kind: 'NONE', targetId: null });
  });

  it('read is idempotent and keeps the snapshot count in sync; read-all clears it', () => {
    const w = world();
    readAllNotifications(w.engine, w.career);
    const a = notify(w, 'ECONOMY', 'INFO');
    notify(w, 'PROGRESSION', 'IMPORTANT');
    notify(w, 'OPERATIONS', 'INFO');
    expect(w.engine.snapshot(w.career).unreadNotifications).toBe(3);

    const first = readNotification(w.engine, w.career, a).readAt;
    expect(first).not.toBeNull();
    w.tick(60_000);
    expect(readNotification(w.engine, w.career, a).readAt).toBe(first);
    expect(w.engine.snapshot(w.career).unreadNotifications).toBe(2);

    expect(readAllNotifications(w.engine, w.career)).toBe(2);
    expect(readAllNotifications(w.engine, w.career)).toBe(0);
    const snap = w.engine.snapshot(w.career);
    expect(snap.unreadNotifications).toBe(0);
    expect(SyncSnapshot.safeParse(snap).success).toBe(true);
    expect(listNotifications(w.career).every((n) => n.readAt !== null)).toBe(true);
  });

  it('404s on an unknown notification', () => {
    const w = world();
    expect(() => readNotification(w.engine, w.career, 'ntf_missing')).toThrowError(MockError);
  });
});

describe('mock analytics ingestion', () => {
  const event = (i: number) => ({
    name: 'screen_view',
    at: '2026-03-01T09:00:00.000Z',
    props: { screen: `s${i}` },
  });

  it('validates the batch with the contract schema', () => {
    const w = world();
    expect(ingestAnalytics(w.engine, { events: [event(1)] }, w.account.user.id)).toBe(1);
    expect(analyticsLog(w.engine)[0]).toMatchObject({ name: 'screen_view', userId: w.account.user.id });
    expect(() =>
      ingestAnalytics(w.engine, { events: [{ name: 'x'.repeat(65), at: 'nope' }] }, null),
    ).toThrowError(MockError);
    expect(() =>
      ingestAnalytics(w.engine, { events: Array.from({ length: 51 }, (_, i) => event(i)) }, null),
    ).toThrowError(MockError);
    expect(() =>
      ingestAnalytics(w.engine, { events: [{ ...event(1), props: { nested: { a: 1 } } }] }, null),
    ).toThrowError(MockError);
  });

  it('keeps only the most recent events and honours the feature flag', () => {
    const w = world();
    for (let batch = 0; batch < 6; batch++)
      ingestAnalytics(
        w.engine,
        { events: Array.from({ length: 50 }, (_, i) => event(batch * 50 + i)) },
        null,
      );
    const log = analyticsLog(w.engine);
    expect(log).toHaveLength(ANALYTICS_RETENTION);
    expect(log.at(-1)!.props).toEqual({ screen: 's299' });
    expect(log[0]!.props).toEqual({ screen: 's100' });
    w.engine.state.featureFlags.analytics = false;
    expect(ingestAnalytics(w.engine, { events: [event(999)] }, null)).toBe(0);
    expect(analyticsLog(w.engine)).toHaveLength(ANALYTICS_RETENTION);
  });
});
