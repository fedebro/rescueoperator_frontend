import { beforeEach, describe, expect, it } from 'vitest';
import {
  AdCompleteResult,
  AdStartResult,
  AdsStatusDto,
  CheckoutResult,
  CreditPackageDto,
  PublicInviteDto,
  PurchaseDto,
  ReferralDto,
  SpeedupQuote,
} from '@/contracts';
import { SpeedupResult } from '@/contracts';
import { MockEngine, MockError, OTP_CODE, memoryStorage, type MockCareer } from '../engine';
import { ECONOMY } from '../data/catalog';
import { PESCARA } from '../data/pescara';
import { installDomains } from './index';
import {
  MOCK_INVITE_HANDOFF_KEY,
  isMonetizationUnlocked,
  monetizationApiOf,
  monetizationState,
  speedupCost,
} from './monetization';

function world(speed = 1) {
  let now = Date.parse('2026-03-01T09:00:00.000Z');
  let seed = 7;
  const engine = new MockEngine({
    storage: memoryStorage(),
    now: () => now,
    speed,
    emit: () => undefined,
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  installDomains(engine);
  const newCareer = (email: string, name: string, ready = true): MockCareer => {
    const ch = engine.requestOtp(email);
    const auth = engine.verifyOtp(
      {
        challengeId: ch.challengeId,
        code: OTP_CODE,
        directorName: name,
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
    const career = engine.state.careers[summary.id]!;
    if (ready) {
      const tutorial = career.incidents.find((i) => i.isTutorial);
      if (tutorial) engine.close(career, tutorial, 'CANCELLED', engine.now());
      engine.advanceTutorial(career, 'DONE');
      engine.credit(career, 20_000, 'ADMIN_ADJUSTMENT');
    }
    return career;
  };
  const organicPurchase = (career: MockCareer) =>
    engine.buyVehicle(career, { vehicleTypeCode: 'FIRE_APS', facilityId: career.facilities[0]!.id });
  return {
    engine,
    api: monetizationApiOf(engine),
    newCareer,
    organicPurchase,
    advance: (ms: number) => {
      now += ms;
      engine.process();
    },
  };
}
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof MockError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
};
const balance = (career: MockCareer) => BigInt(career.summary.credits);

describe('monetization gate', () => {
  it('stays closed until the tutorial is done AND an organic purchase was made', () => {
    const w = world();
    const career = w.newCareer('gate@example.com', 'Gate');
    expect(isMonetizationUnlocked(career)).toBe(false);
    expect(code(() => w.api.checkout(career, { packageId: 'PACK_S', withdrawalWaiverAccepted: true }))).toBe(
      'NOT_UNLOCKED',
    );
    expect(code(() => w.api.adStart(career))).toBe('NOT_UNLOCKED');
    w.organicPurchase(career);
    expect(isMonetizationUnlocked(career)).toBe(true);
    expect(code(() => w.api.adStart(career))).toBe('NO_ERROR');
  });
  it('honours the feature flags', () => {
    const w = world();
    const career = w.newCareer('flag@example.com', 'Flag');
    w.organicPurchase(career);
    w.engine.state.featureFlags.creditShop = false;
    w.engine.state.featureFlags.rewardedAds = false;
    expect(code(() => w.api.checkout(career, { packageId: 'PACK_S', withdrawalWaiverAccepted: true }))).toBe(
      'FEATURE_DISABLED',
    );
    expect(code(() => w.api.adStart(career))).toBe('FEATURE_DISABLED');
    expect(w.api.adsStatus(career).enabled).toBe(false);
  });
});

describe('credit shop', () => {
  let w: ReturnType<typeof world>;
  let career: MockCareer;
  beforeEach(() => {
    w = world();
    career = w.newCareer('shop@example.com', 'Shopper');
    w.organicPurchase(career);
  });
  it('lists the catalog packages with a EUR price, in contract shape', () => {
    const packages = w.api.packages(career);
    expect(packages.map((p) => p.priceMinor)).toEqual(ECONOMY.creditPackages.map((p) => p.priceEurCents));
    for (const p of packages) {
      expect(CreditPackageDto.safeParse(p).success).toBe(true);
      expect(p.currency).toBe('EUR');
    }
  });
  it('requires the withdrawal waiver and a known package', () => {
    expect(code(() => w.api.checkout(career, { packageId: 'PACK_S' }))).toBe('VALIDATION_ERROR');
    expect(code(() => w.api.checkout(career, { packageId: 'NOPE', withdrawalWaiverAccepted: true }))).toBe(
      'PACKAGE_NOT_FOUND',
    );
  });
  it('credits exactly once when the webhook arrives (CREATED → CREDITED, ledger PURCHASE, purchased balance)', () => {
    const before = balance(career);
    const result = w.api.checkout(career, { packageId: 'PACK_M', withdrawalWaiverAccepted: true });
    expect(CheckoutResult.safeParse(result).success).toBe(true);
    expect(result.checkoutUrl).toContain(`/game/credits/mock-checkout?purchase=${result.purchaseId}`);
    expect(w.api.purchases(career)[0]!.status).toBe('CREATED');
    const event = { type: 'checkout.session.completed', data: { purchaseId: result.purchaseId } };
    w.api.webhook(event);
    w.api.webhook(event); // provider retries must not credit twice
    const purchase = w.api.purchases(career)[0]!;
    expect(PurchaseDto.safeParse(purchase).success).toBe(true);
    expect(purchase.status).toBe('CREDITED');
    expect(balance(career) - before).toBe(2800n);
    expect(career.ledger[0]!.entryType).toBe('PURCHASE');
    expect(monetizationState(career).purchasedBalance).toBe('2800');
  });
  it('marks an abandoned checkout FAILED without touching the balance', () => {
    const before = balance(career);
    const { purchaseId } = w.api.checkout(career, { packageId: 'PACK_S', withdrawalWaiverAccepted: true });
    w.api.webhook({ type: 'checkout.session.expired', data: { purchaseId } });
    expect(w.api.purchases(career)[0]!.status).toBe('FAILED');
    expect(balance(career)).toBe(before);
  });
  it('spends earned credits before purchased ones', () => {
    const { purchaseId } = w.api.checkout(career, { packageId: 'PACK_S', withdrawalWaiverAccepted: true });
    w.api.webhook({ type: 'checkout.session.completed', data: { purchaseId } });
    const earned = balance(career) - 1000n;
    w.engine.credit(career, -Number(earned - 10n), 'ADMIN_ADJUSTMENT');
    expect(monetizationState(career).purchasedBalance).toBe('1000');
    w.engine.credit(career, -510, 'ADMIN_ADJUSTMENT');
    expect(monetizationState(career).purchasedBalance).toBe('500');
  });
});

describe('saved card', () => {
  let w: ReturnType<typeof world>;
  let career: MockCareer;
  beforeEach(() => {
    w = world();
    career = w.newCareer('savedcard@example.com', 'Saver');
    w.organicPurchase(career);
  });
  it('has no saved card by default, then saves one and charges it with no checkout redirect', () => {
    expect(w.api.savedPaymentMethod(career)).toMatchObject({ present: false, brand: null, last4: null });
    const saved = w.api.saveCard(career);
    expect(saved.setupUrl).toContain('cardSetup=success');
    expect(w.api.savedPaymentMethod(career)).toMatchObject({ present: true, brand: 'visa', last4: '4242' });

    const before = balance(career);
    const result = w.api.checkoutSaved(career, { packageId: 'PACK_M', withdrawalWaiverAccepted: true });
    expect(result).toMatchObject({ status: 'CHARGED', checkoutUrl: null });
    expect(balance(career) - before).toBe(2800n);
    expect(w.api.purchases(career)[0]).toMatchObject({ status: 'CREDITED', packageId: 'PACK_M' });
  });
  it('refuses to charge a card that was never saved, or one that was removed', () => {
    expect(
      code(() => w.api.checkoutSaved(career, { packageId: 'PACK_S', withdrawalWaiverAccepted: true })),
    ).toBe('NOT_FOUND');
    w.api.saveCard(career);
    w.api.removeSavedCard(career);
    expect(w.api.savedPaymentMethod(career).present).toBe(false);
    expect(
      code(() => w.api.checkoutSaved(career, { packageId: 'PACK_S', withdrawalWaiverAccepted: true })),
    ).toBe('NOT_FOUND');
  });
  it('requires the withdrawal waiver on a saved-card charge too', () => {
    w.api.saveCard(career);
    expect(code(() => w.api.checkoutSaved(career, { packageId: 'PACK_S' }))).toBe('VALIDATION_ERROR');
  });
});

describe('speed-ups', () => {
  it('prices by catalog minutes, with a minimum and a free tail', () => {
    expect(speedupCost('VEHICLE_DELIVERY', ECONOMY.speedup.freeBelowSeconds - 1)).toBe(0);
    expect(speedupCost('VEHICLE_DELIVERY', ECONOMY.speedup.freeBelowSeconds)).toBeGreaterThanOrEqual(
      ECONOMY.speedup.minimumCost,
    );
    expect(speedupCost('VEHICLE_DELIVERY', 600)).toBeGreaterThan(speedupCost('SUPPLY_DELIVERY', 600));
  });
  it('finishes a vehicle delivery through its normal executor and writes a SPEEDUP ledger row', () => {
    const w = world();
    const career = w.newCareer('speed@example.com', 'Speedy');
    const vehicle = w.organicPurchase(career);
    const quote = w.api.speedupQuote(career, 'VEHICLE_DELIVERY', vehicle.id);
    expect(SpeedupQuote.safeParse(quote).success).toBe(true);
    expect(quote.remainingSeconds).toBeGreaterThan(0);
    const before = balance(career);
    const result = w.api.speedup(career, 'VEHICLE_DELIVERY', vehicle.id);
    expect(SpeedupResult.safeParse(result).success).toBe(true);
    expect(result.vehicle?.status).toBe('AVAILABLE');
    expect(before - balance(career)).toBe(BigInt(quote.cost));
    expect(career.ledger[0]!.entryType).toBe('SPEEDUP');
    expect(code(() => w.api.speedup(career, 'VEHICLE_DELIVERY', vehicle.id))).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
  it('refuses when credits are short and leaves the timer running', () => {
    const w = world();
    const career = w.newCareer('poor@example.com', 'Poor');
    const vehicle = w.organicPurchase(career);
    w.engine.credit(career, -Number(balance(career)), 'ADMIN_ADJUSTMENT');
    expect(code(() => w.api.speedup(career, 'VEHICLE_DELIVERY', vehicle.id))).toBe('INSUFFICIENT_CREDITS');
    expect(career.vehicles.find((v) => v.id === vehicle.id)!.status).toBe('IN_DELIVERY');
  });
  it('never accepts an operational target', () => {
    const w = world();
    const career = w.newCareer('ops@example.com', 'Ops');
    expect(code(() => w.api.speedupQuote(career, 'TRAVEL', 'x'))).toBe('VALIDATION_ERROR');
  });
});

describe('rewarded video', () => {
  it('validates the watch time, single-use tokens, cooldown and the daily limit', () => {
    const w = world();
    const career = w.newCareer('ads@example.com', 'Viewer');
    w.organicPurchase(career);
    const start = w.api.adStart(career);
    expect(AdStartResult.safeParse(start).success).toBe(true);
    expect(code(() => w.api.adComplete(career, { adToken: start.adToken }))).toBe('VALIDATION_ERROR');
    w.advance(start.minWatchSeconds * 1000);
    const before = balance(career);
    const done = w.api.adComplete(career, { adToken: start.adToken });
    expect(AdCompleteResult.safeParse(done).success).toBe(true);
    expect(balance(career) - before).toBe(BigInt(ECONOMY.rewardedAds.credits));
    expect(career.ledger[0]!.entryType).toBe('REWARDED_AD');
    expect(done.status.watchedToday).toBe(1);
    expect(done.status.nextAvailableAt).not.toBeNull();
    expect(code(() => w.api.adComplete(career, { adToken: start.adToken }))).toBe('CONFLICT');
    expect(code(() => w.api.adStart(career))).toBe('AD_COOLDOWN');

    for (let i = 1; i < ECONOMY.rewardedAds.dailyLimit; i++) {
      w.advance(ECONOMY.rewardedAds.cooldownSeconds * 1000 + 1000);
      const s = w.api.adStart(career);
      w.advance(s.minWatchSeconds * 1000);
      w.api.adComplete(career, { adToken: s.adToken });
    }
    w.advance(ECONOMY.rewardedAds.cooldownSeconds * 1000 + 1000);
    expect(code(() => w.api.adStart(career))).toBe('AD_LIMIT_REACHED');
    const status = w.api.adsStatus(career);
    expect(AdsStatusDto.safeParse(status).success).toBe(true);
    expect(status.watchedToday).toBe(ECONOMY.rewardedAds.dailyLimit);
    w.advance(24 * 3600_000);
    expect(w.api.adsStatus(career).watchedToday).toBe(0);
  });
});

describe('referral "build your network"', () => {
  const resolveMissions = (w: ReturnType<typeof world>, career: MockCareer, n: number) => {
    for (let i = 0; i < n; i++) {
      const incident = w.engine.spawnIncident(career, 'FIRE_TRASH_BIN', false);
      w.engine.close(career, incident, 'RESOLVED', w.engine.now());
    }
  };
  it('gives every Director a code and resolves it publicly', () => {
    const w = world();
    const career = w.newCareer('ref@example.com', 'Referrer');
    const dto = w.api.referrals(career);
    expect(ReferralDto.safeParse(dto).success).toBe(true);
    expect(dto.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(dto.inviteUrl.endsWith(`/invite/${dto.code}`)).toBe(true);
    expect(PublicInviteDto.parse(w.api.publicInvite(dto.code.toLowerCase()))).toEqual({
      directorName: 'Referrer',
      valid: true,
    });
    expect(w.api.publicInvite('NOPE1234').valid).toBe(false);
  });
  it('rejects self-invites, unknown codes and double registration', () => {
    const w = world();
    const a = w.newCareer('a@example.com', 'Alpha');
    const b = w.newCareer('b@example.com', 'Bravo');
    const c = w.newCareer('c@example.com', 'Charlie');
    expect(w.api.registerInvite(a, w.api.referrals(a).code)).toBe(false);
    expect(w.api.registerInvite(b, 'UNKNOWN1')).toBe(false);
    expect(w.api.registerInvite(b, w.api.referrals(a).code)).toBe(true);
    expect(w.api.registerInvite(b, w.api.referrals(c).code)).toBe(false);
    expect(w.api.referrals(a).invited).toHaveLength(1);
  });
  it('registers the invite parked by the client at career creation', () => {
    const w = world();
    const a = w.newCareer('a2@example.com', 'Alpha Two');
    localStorage.setItem(MOCK_INVITE_HANDOFF_KEY, w.api.referrals(a).code);
    const b = w.newCareer('b2@example.com', 'Bravo Two');
    expect(localStorage.getItem(MOCK_INVITE_HANDOFF_KEY)).toBeNull();
    expect(w.api.referrals(b).myInvitation?.referrerName).toBe('Alpha Two');
  });
  it('activates after 5 missions on 2 distinct days, pays the invited, then the referrer at 2/2 — once', () => {
    const w = world();
    const a = w.newCareer('r@example.com', 'Root');
    const friends = [
      w.newCareer('f1@example.com', 'Friend One'),
      w.newCareer('f2@example.com', 'Friend Two'),
    ];
    const code = w.api.referrals(a).code;
    for (const f of friends) w.api.registerInvite(f, code);
    const rootBefore = balance(a);

    const [f1, f2] = friends as [MockCareer, MockCareer];
    const f1Before = balance(f1);
    resolveMissions(w, f1, 5);
    // five missions on a single day are not enough
    expect(w.api.referrals(f1).myInvitation).toMatchObject({
      missionsDone: 5,
      daysDone: 1,
      status: 'REGISTERED',
    });
    w.advance(24 * 3600_000);
    resolveMissions(w, f1, 1);
    expect(w.api.referrals(f1).myInvitation?.status).toBe('ACTIVATED');
    const reward = (career: MockCareer) =>
      career.ledger
        .filter((l) => l.entryType === 'REFERRAL_BONUS')
        .reduce((s, l) => s + BigInt(l.amount), 0n);
    expect(reward(f1)).toBe(BigInt(ECONOMY.referral.inviteeBonus));
    expect(balance(f1)).toBeGreaterThan(f1Before);
    expect(w.api.referrals(a)).toMatchObject({ activated: 1, rewardClaimed: false });
    expect(reward(a)).toBe(0n);

    resolveMissions(w, f2, 3);
    w.advance(24 * 3600_000);
    resolveMissions(w, f2, 2);
    const dto = w.api.referrals(a);
    expect(dto).toMatchObject({ activated: 2, required: 2, rewardClaimed: true });
    expect(dto.invited.map((i) => i.status)).toEqual(['REWARDED', 'REWARDED']);
    expect(reward(a)).toBe(BigInt(ECONOMY.referral.inviterBonus));
    expect(balance(a) - rootBefore).toBeGreaterThanOrEqual(BigInt(ECONOMY.referral.inviterBonus));
  });
  it('QA helper moves simulated friends through the states and pays once', async () => {
    const w = world();
    const a = w.newCareer('qa@example.com', 'Qa Root');
    w.engine.state.currentSession = { email: 'qa@example.com', sessionId: 'x' };
    await Promise.resolve();
    const simulate = w.engine.qa.simulateInvitee as unknown as (status: string) => string;
    expect(simulate('REGISTERED')).toBe('REGISTERED');
    expect(simulate('ACTIVATED')).toBe('ACTIVATED');
    expect(w.api.referrals(a)).toMatchObject({ activated: 1, rewardClaimed: false });
    expect(simulate('ACTIVATED')).toBe('REWARDED');
    expect(simulate('INVALIDATED')).toBe('INVALIDATED');
    const dto = w.api.referrals(a);
    expect(dto.rewardClaimed).toBe(true);
    expect(dto.invited.map((i) => i.status).sort()).toEqual(['INVALIDATED', 'REWARDED', 'REWARDED']);
    expect(a.ledger.filter((l) => l.entryType === 'REFERRAL_BONUS')).toHaveLength(1);
  });
});
