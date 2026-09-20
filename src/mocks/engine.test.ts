import { beforeEach, describe, expect, it } from 'vitest';
import {
  IncidentDto,
  IncidentOutcomeDto,
  RealtimeEnvelope,
  SyncSnapshot,
  VehicleDto,
  type RealtimeEnvelope as Envelope,
} from '@/contracts';
import { applyEvent } from '@/lib/realtime/reconcile';
import { MockEngine, MockError, OTP_CODE, TUTORIAL_BONUS, memoryStorage, type MockCareer } from './engine';
import { PESCARA, mockRoute } from './data/pescara';
import { levelForXp, xpThreshold } from './data/catalog';

function world(speed = 1) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  const events: Envelope[] = [];
  let seed = 42;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed,
    emit: (e) => events.push(e),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  const advance = (ms: number, step = 250) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      engine.process();
    }
  };
  const signUp = (email = 'a@example.com', name = 'Director A') => {
    const ch = engine.requestOtp(email);
    return engine.verifyOtp(
      {
        challengeId: ch.challengeId,
        code: OTP_CODE,
        directorName: name,
        acceptTerms: true,
        confirmAge: true,
      },
      'vitest',
    );
  };
  const start = () => {
    const auth = signUp();
    const account = engine.authenticate(`Bearer ${auth.accessToken}`);
    const site = engine.starterSites()[1]!;
    const summary = engine.createCareer(account, { locationId: PESCARA.id, siteId: site.id });
    return { account, career: engine.state.careers[summary.id] as MockCareer };
  };
  return { engine, events, advance, signUp, start, now: () => now };
}

describe('mock auth', () => {
  it('asks new users for a director name, then signs them in', () => {
    const w = world();
    const ch = w.engine.requestOtp('New@Example.com');
    expect(ch.maskedEmail).toMatch(/^ne•+@example\.com$/);
    expect(() => w.engine.verifyOtp({ challengeId: ch.challengeId, code: '000000' }, null)).toThrowError(
      expect.objectContaining({ code: 'OTP_INVALID' }),
    );
    expect(() => w.engine.verifyOtp({ challengeId: ch.challengeId, code: OTP_CODE }, null)).toThrowError(
      expect.objectContaining({ code: 'DIRECTOR_NAME_REQUIRED' }),
    );
    const auth = w.engine.verifyOtp(
      {
        challengeId: ch.challengeId,
        code: OTP_CODE,
        directorName: 'Nuovo',
        acceptTerms: true,
        confirmAge: true,
      },
      null,
    );
    expect(auth.isNewUser).toBe(true);
    expect(w.engine.refresh().user.id).toBe(auth.user.id);
    w.engine.logout();
    expect(() => w.engine.refresh()).toThrow(MockError);
  });
  it('locks the challenge after five wrong codes', () => {
    const w = world();
    const ch = w.engine.requestOtp('x@example.com');
    for (let i = 0; i < 5; i++)
      expect(() => w.engine.verifyOtp({ challengeId: ch.challengeId, code: '111111' }, null)).toThrow();
    expect(() => w.engine.verifyOtp({ challengeId: ch.challengeId, code: OTP_CODE }, null)).toThrowError(
      expect.objectContaining({ code: 'OTP_TOO_MANY_ATTEMPTS' }),
    );
  });
});

describe('mock core loop', () => {
  let w: ReturnType<typeof world>;
  let career: MockCareer;
  beforeEach(() => {
    w = world();
    career = w.start().career;
  });

  it('creates a career with a facility, a vehicle, the starter grant and the tutorial incident — all contract-valid', () => {
    const snap = w.engine.snapshot(career);
    expect(SyncSnapshot.safeParse(snap).success).toBe(true);
    expect(snap.career.credits).toBe('400');
    expect(snap.vehicles).toHaveLength(1);
    expect(snap.incidents).toHaveLength(1);
    expect(snap.incidents[0]!.isTutorial).toBe(true);
    expect(snap.career.tutorial).toEqual({ completed: false, step: 'WELCOME' });
  });

  it('recommends a set, dispatches, moves the vehicle, works the incident and pays the reward exactly once', () => {
    const incident = career.incidents[0]!;
    const options = w.engine.dispatchOptions(career, incident.id);
    expect(options.recommendedVehicleIds).toHaveLength(1);
    expect(options.recommendationCoversRequired).toBe(true);
    w.engine.dispatch(career, incident.id, options.recommendedVehicleIds);
    expect(career.vehicles[0]!.status).toBe('PREPARING');
    expect(() => w.engine.dispatch(career, incident.id, options.recommendedVehicleIds)).toThrowError(
      expect.objectContaining({ code: 'VEHICLE_NOT_AVAILABLE' }),
    );

    w.advance(13_000);
    const moving = career.vehicles[0]!;
    expect(moving.status).toBe('EN_ROUTE');
    expect(VehicleDto.safeParse(moving).success).toBe(true);
    expect(moving.movement!.path.length).toBeGreaterThanOrEqual(3);

    w.advance(Date.parse(moving.movement!.arriveAt) - w.now() + 500);
    expect(career.vehicles[0]!.status).toBe('ON_SCENE');
    const working = career.incidents[0]!;
    expect(working.status).toBe('ON_SCENE');
    expect(working.coverageRatio).toBe(1);
    expect(working.work.ratePerSecond).toBeGreaterThan(0);
    expect(IncidentDto.safeParse(working).success).toBe(true);

    w.advance(Date.parse(working.work.estimatedEndAt!) - w.now() + 500);
    expect(career.incidents).toHaveLength(0);
    expect(career.pendingOutcomes).toHaveLength(1);
    const outcome = career.pendingOutcomes[0]!;
    expect(IncidentOutcomeDto.safeParse(outcome).success).toBe(true);
    expect(outcome.stars).toBeGreaterThanOrEqual(1);
    expect(career.ledger.filter((l) => l.entryType === 'MISSION_REWARD')).toHaveLength(1);
    expect(BigInt(career.summary.credits)).toBe(400n + BigInt(outcome.netCredits) + BigInt(TUTORIAL_BONUS));
    expect(career.vehicles[0]!.status).toBe('RETURNING');
    expect(career.summary.tutorial.step).toBe('OUTCOME');

    w.advance(120_000);
    expect(career.vehicles[0]!.status).toBe('AVAILABLE');
  });

  it('emits a gap-free, valid event stream that rebuilds the server state on the client', () => {
    let client = w.engine.snapshot(career);
    const from = w.events.length;
    const incident = career.incidents[0]!;
    w.engine.dispatch(career, incident.id, [career.vehicles[0]!.id]);
    w.advance(400_000);
    for (const e of w.events.slice(from)) {
      expect(RealtimeEnvelope.safeParse(e).success).toBe(true);
      const r = applyEvent(client, e);
      expect(r.kind, `${e.type}#${e.seq}`).toBe('applied');
      if (r.kind === 'applied') client = r.snapshot;
    }
    const server = w.engine.snapshot(career);
    expect(client.seq).toBe(server.seq);
    expect(client.career).toEqual(server.career);
    expect(client.vehicles).toEqual(server.vehicles);
    expect(client.incidents).toEqual(server.incidents);
  });

  it('recalls a travelling vehicle from its current position', () => {
    const incident = career.incidents[0]!;
    w.engine.dispatch(career, incident.id, [career.vehicles[0]!.id]);
    w.advance(20_000);
    const recalled = w.engine.recall(career, career.vehicles[0]!.id);
    expect(recalled.status).toBe('RETURNING');
    expect(recalled.movement!.purpose).toBe('TO_BASE');
    expect(career.incidents[0]!.status).toBe('PENDING_RESPONSE');
    expect(() => w.engine.recall(career, recalled.id)).toThrowError(
      expect.objectContaining({ code: 'VEHICLE_NOT_RECALLABLE' }),
    );
  });

  it('sells vehicles behind level and credit gates, never going negative', () => {
    const facilityId = career.facilities[0]!.id;
    expect(() => w.engine.buyVehicle(career, { vehicleTypeCode: 'FIRE_AS', facilityId })).toThrowError(
      expect.objectContaining({ code: 'LEVEL_TOO_LOW' }),
    );
    expect(() => w.engine.buyVehicle(career, { vehicleTypeCode: 'EMS_MSB', facilityId })).toThrowError(
      expect.objectContaining({ code: 'NOT_UNLOCKED', details: { requiredLevel: 3 } }),
    );
    career.summary.level = 2;
    expect(() => w.engine.buyVehicle(career, { vehicleTypeCode: 'FIRE_4X4', facilityId })).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_CREDITS' }),
    );
    expect(career.summary.credits).toBe('400');
    career.summary.credits = '1200';
    const bought = w.engine.buyVehicle(career, { vehicleTypeCode: 'FIRE_4X4', facilityId });
    expect(bought.status).toBe('IN_DELIVERY');
    expect(career.summary.credits).toBe('100');
    w.advance(61_000);
    expect(career.vehicles.find((v) => v.id === bought.id)!.status).toBe('AVAILABLE');
  });

  it('builds facility upgrades over time', () => {
    const facilityId = career.facilities[0]!.id;
    career.summary.credits = '2000';
    career.summary.level = 2;
    const before = career.facilities[0]!.capacities.find((c) => c.domain === 'GROUND')!.total;
    w.engine.buyUpgrade(career, facilityId, 'GARAGE');
    expect(
      w.engine.facilityDetail(career, facilityId).availableUpgrades.find((u) => u.code === 'GARAGE')!
        .lockedReason,
    ).toBe('UPGRADE_IN_PROGRESS');
    w.advance(121_000);
    expect(career.facilities[0]!.capacities.find((c) => c.domain === 'GROUND')!.total).toBe(before + 2);
  });

  it('spawns incidents only on duty, after the tutorial, while the player is present', () => {
    w.engine.advanceTutorial(career, 'DONE');
    career.incidents = [];
    w.engine.setDuty(career, false);
    w.advance(200_000);
    expect(career.incidents).toHaveLength(0);
    w.engine.setDuty(career, true);
    for (let i = 0; i < 8; i++) {
      w.engine.touch(career);
      w.advance(30_000);
    }
    expect(career.incidents.length).toBeGreaterThan(0);
  });

  it('catches up after a reload: state persists and due actions run', () => {
    const storage = memoryStorage();
    let now = Date.parse('2026-03-01T09:00:00.000Z');
    const a = new MockEngine({ storage, now: () => now });
    const ch = a.requestOtp('r@example.com');
    const auth = a.verifyOtp(
      {
        challengeId: ch.challengeId,
        code: OTP_CODE,
        directorName: 'Reload',
        acceptTerms: true,
        confirmAge: true,
      },
      null,
    );
    const summary = a.createCareer(a.authenticate(`Bearer ${auth.accessToken}`), {
      locationId: PESCARA.id,
      siteId: a.starterSites()[0]!.id,
    });
    const c = a.state.careers[summary.id]!;
    a.dispatch(c, c.incidents[0]!.id, [c.vehicles[0]!.id]);
    now += 3_600_000; // tab closed for an hour
    const b = new MockEngine({ storage, now: () => now });
    b.process();
    const restored = b.state.careers[summary.id]!;
    expect(restored.incidents).toHaveLength(0);
    expect(restored.pendingOutcomes).toHaveLength(1);
    expect(restored.vehicles[0]!.status).toBe('AVAILABLE');
    expect(b.refresh().user.activeCareerId).toBe(summary.id);
  });
});

describe('mock data helpers', () => {
  it('routes start and end exactly at the requested points', () => {
    const route = mockRoute([14.2, 42.46], [14.23, 42.45], 9);
    expect(route[0]).toEqual([14.2, 42.46]);
    expect(route.at(-1)).toEqual([14.23, 42.45]);
  });
  it('uses the level table from the economy analysis', () => {
    expect(xpThreshold(2)).toBe(100);
    expect(xpThreshold(3)).toBe(260);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(260)).toBe(3);
  });
});
