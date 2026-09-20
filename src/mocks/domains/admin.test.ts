import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { AdminDashboardDto, SyncSnapshot, type RealtimeEnvelope } from '@/contracts';
import { adminApi } from '@/lib/api/admin';
import { setAccessToken } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { resetClockForTests } from '@/lib/clock';
import { MockEngine, OTP_CODE, memoryStorage } from '../engine';
import { createHandlers } from '../handlers';
import { PESCARA } from '../data/pescara';
import { INITIAL_CONFIG_VERSION, adminState, failAction, pointInPolygon } from './admin';

/**
 * The admin mock is exercised through the real API client (`adminApi`) and MSW: this pins, in one place, the assumed
 * routes, their shapes (a contract mismatch warns → the test fails) and the role matrix the backend must honour.
 */
const BASE = 'http://api.test';
const server = setupServer();
let engine: MockEngine;
let events: RealtimeEnvelope[];
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  events = [];
  engine = new MockEngine({ storage: memoryStorage(), speed: 50, emit: (e) => events.push(e) });
  server.resetHandlers(...createHandlers(engine, BASE));
  setAccessToken(null);
  resetClockForTests();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  const mismatches = warn.mock.calls.filter((c) => String(c[0]).includes('contract mismatch'));
  warn.mockRestore();
  expect(mismatches, 'every admin response matches its schema').toEqual([]);
});

/** Signs in (creating the account on first use) and makes it the caller of the next requests. */
function signIn(email: string, directorName = `Dir ${email.split('@')[0]}`) {
  const { challengeId } = engine.requestOtp(email);
  const auth = engine.verifyOtp(
    { challengeId, code: OTP_CODE, directorName, acceptTerms: true, confirmAge: true },
    'vitest',
  );
  setAccessToken(auth.accessToken, auth.accessTokenExpiresAt);
  return engine.authenticate(`Bearer ${auth.accessToken}`);
}
function playerCareer(email = 'player@example.com') {
  const account = signIn(email);
  const summary = engine.createCareer(account, {
    locationId: PESCARA.id,
    siteId: engine.starterSites()[0]!.id,
  });
  return engine.state.careers[summary.id]!;
}
async function status(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (e) {
    if (isApiError(e)) return e.status;
    throw e;
  }
}
const SUPER = 'admin@rescue-control.test';
const GAME = 'gameadmin@rescue-control.test';
const SUPPORT = 'support@rescue-control.test';

describe('admin mock — roles', () => {
  it('a player without a platform role gets 403 everywhere', async () => {
    playerCareer();
    expect(await status(adminApi.dashboard())).toBe(403);
    expect(await status(adminApi.users({}))).toBe(403);
    expect(await status(adminApi.audit({}))).toBe(403);
  });

  it('SUPPORT reads everything, may suspend / revoke / annotate, and nothing else', async () => {
    const career = playerCareer();
    signIn(SUPPORT);
    const dashboard = await adminApi.dashboard();
    expect(AdminDashboardDto.safeParse(dashboard).success).toBe(true);
    expect(dashboard.careers).toBe(1);
    const detail = await adminApi.career(career.summary.id);
    expect(detail.creditAdjustmentLimit).toBe('0');

    const body = { amount: '100', reasonCode: 'COMPENSATION', note: 'Support cannot do this' } as const;
    expect(await status(adminApi.adjustCredits(career.summary.id, body))).toBe(403);
    const draftId = adminState(engine).config[0]!.id;
    expect(await status(adminApi.publishConfigVersion(draftId, 'not allowed'))).toBe(403);
    expect(await status(adminApi.createConfigDraft({}))).toBe(403);
    expect(await status(adminApi.setFeatureFlag('referrals', false, 'not allowed'))).toBe(403);
    expect(await status(adminApi.setUserRoles(career.userId, ['SUPPORT'], 'not allowed'))).toBe(403);

    expect((await adminApi.suspendUser(career.userId, 'Chargeback abuse')).status).toBe('SUSPENDED');
    const user = await adminApi.user(career.userId);
    expect(user.suspension).toMatchObject({ reason: 'Chargeback abuse', by: SUPPORT });
    expect(user.sessions).toEqual([]);
    expect(user.audit[0]).toMatchObject({ action: 'user.suspend', reason: 'Chargeback abuse' });
    await adminApi.addUserNote(career.userId, 'Asked for documents');
    expect((await adminApi.user(career.userId)).notes[0]!.text).toBe('Asked for documents');
    expect((await adminApi.reactivateUser(career.userId, 'Documents received')).status).toBe('ACTIVE');
  });

  it('credit adjustments: GAME_ADMIN up to the threshold, SUPER_ADMIN above it', async () => {
    const career = playerCareer();
    const id = career.summary.id;
    signIn(GAME);
    expect((await adminApi.career(id)).creditAdjustmentLimit).toBe('10000');
    const large = { amount: '10001', reasonCode: 'PROMOTION', note: 'Launch campaign' } as const;
    expect(await status(adminApi.adjustCredits(id, large))).toBe(403);
    expect(await status(adminApi.adjustCredits(id, { ...large, amount: '10000' }))).toBe('ok');
    signIn(SUPER);
    expect((await adminApi.career(id)).creditAdjustmentLimit).toBeNull();
    expect(await status(adminApi.adjustCredits(id, large))).toBe('ok');
  });

  it('only SUPER_ADMIN manages roles, and cannot drop their own', async () => {
    const career = playerCareer();
    const me = signIn(SUPER);
    const row = await adminApi.setUserRoles(career.userId, ['SUPPORT'], 'New support agent');
    expect(row.roles).toEqual(['USER', 'SUPPORT']);
    expect(await status(adminApi.setUserRoles(me.user.id, ['SUPPORT'], 'Oops, locking myself out'))).toBe(
      409,
    );
  });
});

describe('admin mock — ledger', () => {
  it('an adjustment is a NEW ledger entry with a reason, audited, and never takes the balance below zero', async () => {
    const career = playerCareer();
    const id = career.summary.id;
    signIn(SUPER);
    const before = JSON.parse(JSON.stringify(career.ledger)) as typeof career.ledger;
    const balance = BigInt(career.summary.credits);

    const result = await adminApi.adjustCredits(id, {
      amount: '-150',
      reasonCode: 'CORRECTION',
      note: 'Duplicate reward removed',
    });
    expect(result.credits).toBe(String(balance - 150n));
    expect(result.entry).toMatchObject({ amount: '-150', balanceAfter: String(balance - 150n) });
    expect(career.ledger).toHaveLength(before.length + 1);
    expect(career.ledger.slice(1)).toEqual(before); // history untouched
    expect(events.some((e) => e.type === 'credits.changed' && e.careerId === id)).toBe(true);

    const page = await adminApi.careerLedger(id);
    expect(page.data[0]!.id).toBe(result.entry.id);
    const audit = await adminApi.audit({ targetId: id });
    expect(audit.data[0]).toMatchObject({
      actor: SUPER,
      action: 'career.credit_adjustment',
      targetType: 'career',
      reason: 'CORRECTION -150: Duplicate reward removed',
    });

    const tooMuch = {
      amount: `-${balance}`,
      reasonCode: 'FRAUD_REVERSAL',
      note: 'Would go negative',
    } as const;
    expect(await status(adminApi.adjustCredits(id, tooMuch))).toBe(422);
    expect(await status(adminApi.adjustCredits(id, { ...tooMuch, amount: '5', note: 'no' }))).toBe(422);
    expect(career.ledger).toHaveLength(before.length + 1);
  });
});

describe('admin mock — config versions', () => {
  it('draft → schema validation → publish bumps the snapshot version and supersedes the previous one; rollback restores it', async () => {
    const career = playerCareer();
    signIn(SUPER);
    expect(engine.snapshot(career).configVersion).toBe(INITIAL_CONFIG_VERSION);
    const schema = await adminApi.configSchema();
    expect(schema).toHaveProperty('properties.economy');

    const draft = await adminApi.createConfigDraft({ note: 'Reward tuning' });
    expect(draft).toMatchObject({ status: 'DRAFT', version: 'mock-2', author: SUPER });
    const economy = draft.content.economy as Record<string, unknown>;
    const invalid = { ...draft.content, economy: { ...economy, rewardMultiplier: 'a lot' } };
    expect(await status(adminApi.saveConfigDraft(draft.id, { content: invalid }))).toBe(422);
    const valid = { ...draft.content, economy: { ...economy, rewardMultiplier: 1.25 } };
    expect((await adminApi.saveConfigDraft(draft.id, { content: valid })).content).toEqual(valid);

    events.length = 0;
    expect(await status(adminApi.publishConfigVersion(draft.id, 'no'))).toBe(422); // reason too short
    const published = await adminApi.publishConfigVersion(draft.id, 'Approved by design');
    expect(published.status).toBe('PUBLISHED');
    const versions = await adminApi.configVersions();
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      ['mock-2', 'PUBLISHED'],
      ['mock-1', 'SUPERSEDED'],
    ]);
    expect(events.find((e) => e.type === 'config.updated')?.payload).toEqual({ configVersion: 'mock-2' });
    expect(SyncSnapshot.parse(engine.snapshot(career)).configVersion).toBe('mock-2');
    expect((await adminApi.version())?.configVersion).toBe('mock-2');
    expect(await status(adminApi.saveConfigDraft(draft.id, { content: valid }))).toBe(409);

    const first = versions.find((v) => v.version === 'mock-1')!;
    await adminApi.rollbackConfigVersion(first.id, 'Reward inflation');
    expect(engine.snapshot(career).configVersion).toBe('mock-1');
    expect((await adminApi.audit({ action: 'config.' })).data.map((a) => a.action)).toEqual([
      'config.rollback',
      'config.publish',
      'config.draft.save',
      'config.draft.create',
    ]);
  });
});

describe('admin mock — flags and world', () => {
  it('a flag change reaches every career live and is audited with its reason', async () => {
    const career = playerCareer();
    signIn(GAME);
    events.length = 0;
    const row = await adminApi.setFeatureFlag('rewardedAds', false, 'Ad provider outage');
    expect(row).toMatchObject({ key: 'rewardedAds', enabled: false });
    const event = events.find((e) => e.type === 'config.updated' && e.careerId === career.summary.id);
    expect(event?.payload).toMatchObject({ featureFlags: { rewardedAds: false } });
    expect(engine.snapshot(career).featureFlags.rewardedAds).toBe(false);
    expect((await adminApi.audit({ targetType: 'feature_flag' })).data[0]).toMatchObject({
      action: 'feature_flag.disable',
      targetId: 'rewardedAds',
      reason: 'Ad provider outage',
    });
    expect(await status(adminApi.setFeatureFlag('nope', true, 'Unknown flag'))).toBe(404);
  });

  it('closures and the weather override are exposed to the game through the world hook', async () => {
    const career = playerCareer();
    signIn(GAME);
    const [lng, lat] = career.facilities[0]!.position;
    const polygon: [number, number][] = [
      [lng - 0.01, lat - 0.01],
      [lng + 0.01, lat - 0.01],
      [lng + 0.01, lat + 0.01],
      [lng - 0.01, lat + 0.01],
    ];
    expect(pointInPolygon([lng, lat], polygon)).toBe(true);
    expect(pointInPolygon([lng + 1, lat], polygon)).toBe(false);

    events.length = 0;
    const closure = await adminApi.createClosure({
      polygon,
      reasonKey: 'admin.world.reasons.ROADWORKS',
      durationSeconds: 600,
      multiplier: 4,
      reason: 'QA: closure around the first station',
    });
    const world = SyncSnapshot.parse(engine.snapshot(career)).world;
    expect(world.closures.at(-1)).toMatchObject({
      id: closure.id,
      multiplier: 4,
      reason: { key: 'admin.world.reasons.ROADWORKS' },
    });
    expect(events.some((e) => e.type === 'world.updated')).toBe(true);
    const through = engine.hooks.travelFactor.reduce((f, h) => f * h(career, [[lng, lat]], 'FIRE_APS'), 1);
    expect(through).toBeGreaterThanOrEqual(4);

    await adminApi.setWeatherOverride({ code: 'STORM', durationSeconds: 600, reason: 'Storm drill' });
    expect(engine.snapshot(career).world.weather.code).toBe('STORM');
    expect((await adminApi.weatherOverride())?.code).toBe('STORM');
    await adminApi.clearWeatherOverride('Drill finished');
    expect(await adminApi.weatherOverride()).toBeNull();

    await adminApi.deleteClosure(closure.id, 'Drill finished');
    expect(await adminApi.closures()).toEqual([]);
    expect(engine.snapshot(career).world.closures.some((c) => c.id === closure.id)).toBe(false);
  });
});

describe('admin mock — incidents and scheduled actions', () => {
  it('spawn → inspect → force-resolve / cancel, each audited; closed incidents stay inspectable', async () => {
    const career = playerCareer();
    const id = career.summary.id;
    signIn(GAME);
    const catalog = await adminApi.catalog();
    const template = catalog.sections.templates!.find((t) => t.requiredLevel === 1)!;
    const first = await adminApi.spawnIncident(id, { templateCode: template.code, reason: 'QA spawn' });
    const second = await adminApi.spawnIncident(id, {
      templateCode: template.code,
      position: [14.21, 42.46],
      reason: 'QA spawn at a position',
    });
    expect(second.position).toEqual([14.21, 42.46]);

    const detail = await adminApi.incident(first.id);
    expect(detail.row).toMatchObject({ careerId: id, closedAt: null });
    expect(detail.scheduledActions.every((a) => a.aggregateId === first.id)).toBe(true);
    expect((await adminApi.incidents({ status: 'ACTIVE', careerId: id })).map((i) => i.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );

    const credits = BigInt(career.summary.credits);
    expect((await adminApi.forceResolveIncident(first.id, 'Stuck after a deploy')).status).toBe('RESOLVED');
    expect(BigInt(career.summary.credits)).toBeGreaterThan(credits); // the reward is paid like a normal resolution
    expect((await adminApi.cancelIncident(second.id, 'Spawned by mistake')).status).toBe('CANCELLED');
    expect(career.incidents.some((i) => i.id === first.id || i.id === second.id)).toBe(false);
    expect((await adminApi.incident(first.id)).row.closedAt).not.toBeNull();
    expect(await status(adminApi.cancelIncident(first.id, 'Already closed'))).toBe(409);
    const actions = (await adminApi.audit({ targetType: 'incident' })).data.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['incident.force_resolve', 'incident.cancel']));
  });

  it('a failed action can be retried and then runs through its normal executor', async () => {
    const career = playerCareer();
    signIn(GAME);
    const vehicle = engine.addVehicle(career, career.vehicles[0]!.typeCode, career.facilities[0]!.id, false);
    const action = engine.findAction(career, ['VEHICLE_DELIVERED'], vehicle.id)!;
    failAction(engine, career.summary.id, action.id, 'Worker crashed');

    const failed = await adminApi.scheduledActions({ status: 'FAILED' });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ id: action.id, status: 'FAILED', lastError: 'Worker crashed' });
    expect((await adminApi.dashboard()).queues.find((q) => q.name === 'scheduled-actions')!.failed).toBe(1);
    const pending = (await adminApi.scheduledActions({ status: 'PENDING' }))[0]!;
    expect(await status(adminApi.retryScheduledAction(pending.id, 'Not retryable yet'))).toBe(409);

    await adminApi.retryScheduledAction(action.id, 'Worker restarted');
    expect(career.vehicles.find((v) => v.id === vehicle.id)!.status).toBe('AVAILABLE');
    expect(await adminApi.scheduledActions({ status: 'FAILED' })).toEqual([]);
  });
});

describe('admin mock — review lists', () => {
  it('geodata, referrals and purchases follow their state rules', async () => {
    signIn(SUPER);
    const releases = await adminApi.geodataReleases();
    const ready = releases.find((r) => r.status === 'READY')!;
    const building = releases.find((r) => r.status === 'BUILDING')!;
    expect(await status(adminApi.publishGeodataRelease(building.id, 'Too early'))).toBe(409);
    await adminApi.publishGeodataRelease(ready.id, 'Molise goes live');
    expect(
      (await adminApi.geodataReleases()).filter((r) => r.status === 'PUBLISHED').map((r) => r.id),
    ).toEqual([ready.id]);
    await adminApi.rollbackGeodataRelease(ready.id, 'Broken hospital positions');
    expect((await adminApi.geodataReleases()).filter((r) => r.status === 'PUBLISHED')).toHaveLength(1);

    const review = (await adminApi.referrals({ status: 'UNDER_REVIEW' }))[0]!;
    expect((await adminApi.invalidateReferral(review.id, 'Same device as the referrer')).status).toBe(
      'INVALIDATED',
    );

    signIn(SUPPORT);
    const paid = (await adminApi.purchases({ status: 'CREDITED' }))[0]!;
    const flagged = await adminApi.markPurchaseForRefundReview(paid.id, 'Customer asked for a refund');
    expect(flagged.refundReview).toMatchObject({ by: SUPPORT, reason: 'Customer asked for a refund' });
    expect(await status(adminApi.markPurchaseForRefundReview(paid.id, 'Twice is not allowed'))).toBe(409);
    expect(await status(adminApi.approveReferral(review.id, 'Support cannot review'))).toBe(403);
  });
});
