import type { z } from 'zod';
import type {
  AdsStatusDto,
  CreditPackageDto,
  PurchaseDto,
  ReferralDto,
  SpeedupQuote,
  SpeedupTarget,
} from '@/contracts';
import type { SpeedupResult } from '@/contracts';
import { ECONOMY, MANAGERIAL_SCALE } from '../data/catalog';
import { MockError, iso, text, type Action, type MockCareer, type MockEngine } from '../engine';
import { domainState } from './index';

/**
 * Simulation of the business area: credit shop (hosted checkout + webhook), speed-ups of managerial timers,
 * rewarded video and the "two Directors" referral. Mirrors analisi/05 §7–8: balance never negative, purchased credits
 * are consumed last, nothing is available before tutorial + first organic purchase, prices come from the catalog.
 */
type Package = z.infer<typeof CreditPackageDto>;
type Purchase = z.infer<typeof PurchaseDto>;
type AdsStatus = z.infer<typeof AdsStatusDto>;
type Referral = z.infer<typeof ReferralDto>;
type Target = z.infer<typeof SpeedupTarget>;
type InviteStatus = Referral['invited'][number]['status'];

interface AdToken {
  startedAt: number;
  minWatchSeconds: number;
}
export interface MonetizationCareerState {
  purchases: Purchase[];
  /** Part of the balance that was bought; spent only after the earned part (analisi/05 §7.5). */
  purchasedBalance: string;
  ads: {
    dayKey: string;
    watchedToday: number;
    nextAvailableAt: number | null;
    tokens: Record<string, AdToken>;
  };
  referralRewardClaimed: boolean;
  /** Saved card (server: `saved_payment_methods`). The mock skips the hosted setup page and saves it synchronously. */
  savedCard: { status: 'NONE' | 'ACTIVE'; brand: string | null; last4: string | null };
}
interface ReferralRow {
  id: string;
  code: string;
  referrerUserId: string;
  /** null = a simulated friend created by the QA helper (no real account behind it). */
  invitedUserId: string | null;
  invitedName: string;
  status: InviteStatus;
  joinedAt: string;
  missionsDone: number;
  days: string[];
}
interface MonetizationGlobalState {
  codes: Record<string, string>; // code → userId
  referrals: ReferralRow[];
}

export const AD_PROVIDER = 'simulated';
/** Length of the simulated video in game seconds (compressed by the mock speed, never below 2 s of wall time). */
export const SIMULATED_AD_SECONDS = 15;
/** Session-derived completion proof, the mock's stand-in for `SimulatedAdProvider.proofFor` on the server. */
const adProof = (adToken: string): string => `sim-proof-${adToken}`;
/** Where the client parks the invite code after sign-up so the in-browser mock can read it at career creation. */
export const MOCK_INVITE_HANDOFF_KEY = 'rc-invite-code-sent';
/** The catalog defines no one-time offer yet; the rule (bought once → unavailable) is in place for when it does. */
const ONE_TIME_PACKAGES = new Set<string>();
const DEMO_REFERRER = 'demo:';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HIGHLIGHT: Record<string, Package['highlight']> = {
  PACK_S: 'STARTER',
  PACK_M: 'POPULAR',
  PACK_XL: 'BEST_VALUE',
};
/** SpeedupTarget → catalog rate key (`economy.speedup.creditsPerMinute`). REST is the catalog's "RECOVERY" (crew recovery). */
const RATE_KEY: Record<Target, string> = {
  VEHICLE_DELIVERY: 'VEHICLE_DELIVERY',
  SUPPLY_DELIVERY: 'SUPPLY_DELIVERY',
  FACILITY_UPGRADE: 'FACILITY_UPGRADE',
  MAINTENANCE: 'MAINTENANCE',
  TRAINING: 'TRAINING',
  REST: 'RECOVERY',
  ONBOARDING: 'ONBOARDING',
};
const TARGETS = Object.keys(RATE_KEY) as Target[];

export const monetizationState = (career: MockCareer): MonetizationCareerState =>
  domainState<MonetizationCareerState>(career, 'monetization', () => ({
    purchases: [],
    purchasedBalance: '0',
    ads: { dayKey: '', watchedToday: 0, nextAvailableAt: null, tokens: {} },
    referralRewardClaimed: false,
    savedCard: { status: 'NONE', brand: null, last4: null },
  }));
const globalState = (engine: MockEngine): MonetizationGlobalState =>
  (engine.state.ext.monetization ??= { codes: {}, referrals: [] }) as MonetizationGlobalState;

const dayKey = (ms: number): string => iso(ms).slice(0, 10);
const nextUtcMidnight = (ms: number): number => Date.parse(`${dayKey(ms)}T00:00:00.000Z`) + 86_400_000;
const origin = (): string => globalThis.location?.origin ?? 'https://play.rescue-control.test';

/** Same rule as `useMonetizationUnlocked()` on the client: tutorial done + evidence of an organic purchase. */
export function isMonetizationUnlocked(career: MockCareer): boolean {
  if (!career.summary.tutorial.completed) return false;
  return (
    career.vehicles.length > 1 ||
    career.facilities.length > 1 ||
    career.facilities.some((f) => f.upgrades.length > 0)
  );
}

/**
 * Timer lookup of the binding conventions table (analisi/note-agenti/frontend-depth.md). Travel, intervention, patient
 * transport and towing have no `SpeedupTarget`, so they can never be resolved here.
 */
export function resolveSpeedupAction(
  engine: MockEngine,
  career: MockCareer,
  target: Target,
  targetId: string,
): Action | undefined {
  switch (target) {
    case 'VEHICLE_DELIVERY':
      return engine.findAction(career, ['VEHICLE_DELIVERED'], targetId);
    case 'FACILITY_UPGRADE':
      return targetId.includes(':')
        ? engine.findAction(career, ['UPGRADE_DONE'], targetId.replace(':', '|'))
        : engine.findAction(career, ['FACILITY_READY', 'PROMOTION_DONE'], targetId);
    case 'MAINTENANCE':
      return engine.findAction(career, ['MAINTENANCE_DONE'], targetId);
    case 'SUPPLY_DELIVERY':
      return engine.findAction(career, ['SUPPLY_DELIVERED'], targetId);
    case 'TRAINING':
      return engine.findAction(career, ['TRAINING_DONE'], targetId);
    case 'REST':
      return engine.findAction(career, ['REST_DONE'], targetId);
    case 'ONBOARDING':
      return engine.findAction(career, ['ONBOARDING_DONE'], targetId);
  }
}

/**
 * Pure price rule on the REAL catalog duration. The mock compresses time twice (mock speed × managerial scale of the
 * bundled catalog); callers convert with `catalogSecondsLeft` so prices match what the server would quote.
 */
export function speedupCost(target: Target, remainingCatalogSeconds: number): number {
  const { creditsPerMinute, minimumCost, freeBelowSeconds } = ECONOMY.speedup;
  if (remainingCatalogSeconds < freeBelowSeconds) return 0;
  const perMinute = creditsPerMinute[RATE_KEY[target]] ?? 3;
  return Math.max(minimumCost, Math.ceil((remainingCatalogSeconds / 60) * perMinute));
}
export const catalogSecondsLeft = (wallMs: number, speed: number): number =>
  ((wallMs / 1000) * speed) / MANAGERIAL_SCALE;

export interface MonetizationApi {
  packages(career: MockCareer): Package[];
  checkout(career: MockCareer, body: Record<string, unknown>): { purchaseId: string; checkoutUrl: string };
  purchases(career: MockCareer): Purchase[];
  webhook(body: Record<string, unknown>): { received: true };
  savedPaymentMethod(career: MockCareer): {
    present: boolean;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
  };
  saveCard(career: MockCareer): { setupUrl: string };
  removeSavedCard(career: MockCareer): void;
  checkoutSaved(
    career: MockCareer,
    body: Record<string, unknown>,
  ): { status: 'CHARGED' | 'REQUIRES_CHECKOUT' | 'DECLINED'; purchaseId: string; checkoutUrl: string | null };
  speedupQuote(career: MockCareer, target: unknown, targetId: unknown): z.infer<typeof SpeedupQuote>;
  speedup(career: MockCareer, target: unknown, targetId: unknown): z.infer<typeof SpeedupResult>;
  adsStatus(career: MockCareer): AdsStatus;
  adStart(career: MockCareer): {
    adToken: string;
    minWatchSeconds: number;
    provider: string;
    providerConfig: Record<string, unknown>;
  };
  adComplete(career: MockCareer, body: Record<string, unknown>): { credited: string; status: AdsStatus };
  referrals(career: MockCareer): Referral;
  publicInvite(code: string): { directorName: string; valid: boolean };
  registerInvite(career: MockCareer, code: string): boolean;
}
const apis = new WeakMap<MockEngine, MonetizationApi>();
export function monetizationApiOf(engine: MockEngine): MonetizationApi {
  const api = apis.get(engine);
  if (!api) throw new Error('monetization domain not installed');
  return api;
}

export function installMonetization(engine: MockEngine): void {
  const flag = (key: string): boolean => engine.state.featureFlags[key] === true;
  const requireOpen = (career: MockCareer, flagKey: string): void => {
    if (!flag(flagKey)) throw new MockError(403, 'FEATURE_DISABLED', `Feature ${flagKey} is disabled`);
    if (!isMonetizationUnlocked(career))
      throw new MockError(403, 'NOT_UNLOCKED', 'Available after the tutorial and the first organic purchase');
  };
  const accountOf = (userId: string) => Object.values(engine.state.users).find((u) => u.user.id === userId);
  const careerOfUser = (userId: string): MockCareer | undefined =>
    Object.values(engine.state.careers).find((c) => c.userId === userId);

  /* ───────────── shop ───────────── */
  const packages = (career: MockCareer): Package[] => {
    const bought = new Set(
      monetizationState(career)
        .purchases.filter((p) => p.status === 'PAID' || p.status === 'CREDITED')
        .map((p) => p.packageId),
    );
    return [...ECONOMY.creditPackages]
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        id: p.code,
        credits: String(p.credits),
        bonusCredits: '0',
        priceMinor: p.priceEurCents,
        currency: 'EUR',
        label: text(`creditPackage.${p.code}.name`),
        highlight: HIGHLIGHT[p.code] ?? 'NONE',
        oneTime: ONE_TIME_PACKAGES.has(p.code),
        available: !ONE_TIME_PACKAGES.has(p.code) || !bought.has(p.code),
      }));
  };
  const checkout: MonetizationApi['checkout'] = (career, body) => {
    requireOpen(career, 'creditShop');
    if (body.withdrawalWaiverAccepted !== true)
      throw new MockError(422, 'VALIDATION_ERROR', 'The withdrawal waiver must be accepted', {
        fields: ['withdrawalWaiverAccepted'],
      });
    const pack = packages(career).find((p) => p.id === body.packageId);
    if (!pack) throw new MockError(404, 'PACKAGE_NOT_FOUND', 'Unknown package');
    if (!pack.available) throw new MockError(409, 'CONFLICT', 'Package not available any more');
    const purchase: Purchase = {
      id: engine.id('pur'),
      packageId: pack.id,
      credits: String(BigInt(pack.credits) + BigInt(pack.bonusCredits)),
      priceMinor: pack.priceMinor,
      currency: pack.currency,
      status: 'CREATED',
      createdAt: iso(engine.now()),
      completedAt: null,
    };
    monetizationState(career).purchases.unshift(purchase);
    engine.save();
    return {
      purchaseId: purchase.id,
      checkoutUrl: `${origin()}/game/credits/mock-checkout?purchase=${encodeURIComponent(purchase.id)}`,
    };
  };
  /** Simulated payment-provider webhook. Idempotent per purchase, like `payment_webhook_events` on the server. */
  const webhook: MonetizationApi['webhook'] = (body) => {
    const data = (body.data ?? {}) as Record<string, unknown>;
    const purchaseId = String(data.purchaseId ?? '');
    const career = Object.values(engine.state.careers).find((c) =>
      monetizationState(c).purchases.some((p) => p.id === purchaseId),
    );
    if (!career) throw new MockError(404, 'NOT_FOUND', 'Unknown purchase');
    const state = monetizationState(career);
    const purchase = state.purchases.find((p) => p.id === purchaseId)!;
    const patch = (next: Partial<Purchase>) => {
      Object.assign(purchase, next);
    };
    if (purchase.status !== 'CREATED') return { received: true };
    if (body.type === 'checkout.session.completed') {
      patch({ status: 'PAID' });
      engine.credit(career, Number(purchase.credits), 'PURCHASE');
      state.purchasedBalance = String(BigInt(state.purchasedBalance) + BigInt(purchase.credits));
      patch({ status: 'CREDITED', completedAt: iso(engine.now()) });
      engine.notify(career, {
        category: 'ECONOMY',
        title: text('notifications.purchaseCredited', { credits: purchase.credits }),
        action: { kind: 'NONE', targetId: null },
      });
    } else {
      patch({ status: 'FAILED', completedAt: iso(engine.now()) });
    }
    engine.save();
    return { received: true };
  };
  // Earned credits are spent first: the purchased part can never exceed what is left of the balance.
  engine.hooks.creditsChanged.push((career, amount) => {
    if (amount >= 0) return;
    const state = monetizationState(career);
    const balance = BigInt(career.summary.credits);
    if (BigInt(state.purchasedBalance) > balance) state.purchasedBalance = String(balance);
  });

  /* ───────────── saved card ─────────────
   * The mock skips the hosted `mode: 'setup'` Checkout page (there is no card to enter) and saves the fake card
   * synchronously; the client still reads `setupUrl` and navigates there, landing straight on the success state.
   */
  const savedPaymentMethod: MonetizationApi['savedPaymentMethod'] = (career) => {
    const card = monetizationState(career).savedCard;
    return {
      present: card.status === 'ACTIVE',
      brand: card.brand,
      last4: card.last4,
      expMonth: card.status === 'ACTIVE' ? 12 : null,
      expYear: card.status === 'ACTIVE' ? new Date(engine.now()).getFullYear() + 3 : null,
    };
  };
  const saveCard: MonetizationApi['saveCard'] = (career) => {
    requireOpen(career, 'creditShop');
    monetizationState(career).savedCard = { status: 'ACTIVE', brand: 'visa', last4: '4242' };
    engine.save();
    return { setupUrl: `${origin()}/game/credits?cardSetup=success` };
  };
  const removeSavedCard: MonetizationApi['removeSavedCard'] = (career) => {
    monetizationState(career).savedCard = { status: 'NONE', brand: null, last4: null };
    engine.save();
  };
  const checkoutSaved: MonetizationApi['checkoutSaved'] = (career, body) => {
    requireOpen(career, 'creditShop');
    if (body.withdrawalWaiverAccepted !== true)
      throw new MockError(422, 'VALIDATION_ERROR', 'The withdrawal waiver must be accepted', {
        fields: ['withdrawalWaiverAccepted'],
      });
    const state = monetizationState(career);
    if (state.savedCard.status !== 'ACTIVE')
      throw new MockError(404, 'NOT_FOUND', 'Saved payment method not found');
    const pack = packages(career).find((p) => p.id === body.packageId);
    if (!pack) throw new MockError(404, 'PACKAGE_NOT_FOUND', 'Unknown package');
    if (!pack.available) throw new MockError(409, 'CONFLICT', 'Package not available any more');
    const credits = String(BigInt(pack.credits) + BigInt(pack.bonusCredits));
    const purchase: Purchase = {
      id: engine.id('pur'),
      packageId: pack.id,
      credits,
      priceMinor: pack.priceMinor,
      currency: pack.currency,
      status: 'CREATED',
      createdAt: iso(engine.now()),
      completedAt: null,
    };
    state.purchases.unshift(purchase);
    // The mock always confirms off-session (no SCA simulation): good enough for dev/demo purposes.
    engine.credit(career, Number(credits), 'PURCHASE');
    state.purchasedBalance = String(BigInt(state.purchasedBalance) + BigInt(credits));
    Object.assign(purchase, { status: 'CREDITED', completedAt: iso(engine.now()) });
    engine.save();
    return { status: 'CHARGED', purchaseId: purchase.id, checkoutUrl: null };
  };

  /* ───────────── speed-ups ───────────── */
  const parseTarget = (target: unknown, targetId: unknown): { target: Target; targetId: string } => {
    if (typeof target !== 'string' || !TARGETS.includes(target as Target) || typeof targetId !== 'string')
      throw new MockError(422, 'VALIDATION_ERROR', 'Unknown speed-up target', { fields: ['target'] });
    return { target: target as Target, targetId };
  };
  const quote = (career: MockCareer, rawTarget: unknown, rawId: unknown) => {
    const { target, targetId } = parseTarget(rawTarget, rawId);
    const action = resolveSpeedupAction(engine, career, target, targetId);
    if (!action) throw new MockError(409, 'INVALID_STATE_TRANSITION', 'Nothing is running for this target');
    const remainingMs = Math.max(0, action.dueAt - engine.now());
    return {
      action,
      quote: {
        target,
        targetId,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        cost: String(speedupCost(target, catalogSecondsLeft(remainingMs, engine.speed))),
      },
    };
  };
  const speedup: MonetizationApi['speedup'] = (career, rawTarget, rawId) => {
    const { action, quote: q } = quote(career, rawTarget, rawId);
    const cost = Number(q.cost);
    if (cost > 0) engine.credit(career, -cost, 'SPEEDUP');
    engine.completeNow(career, action);
    engine.save();
    const facilityId = q.targetId.split(':')[0];
    return {
      target: q.target,
      targetId: q.targetId,
      cost: q.cost,
      career: career.summary,
      vehicle: q.target === 'VEHICLE_DELIVERY' ? career.vehicles.find((v) => v.id === q.targetId) : undefined,
      facility:
        q.target === 'FACILITY_UPGRADE' ? career.facilities.find((f) => f.id === facilityId) : undefined,
    };
  };

  /* ───────────── rewarded video ───────────── */
  const adsStatus = (career: MockCareer): AdsStatus => {
    const { ads } = monetizationState(career);
    const now = engine.now();
    if (ads.dayKey !== dayKey(now)) Object.assign(ads, { dayKey: dayKey(now), watchedToday: 0 });
    const cooling = ads.nextAvailableAt !== null && ads.nextAvailableAt > now;
    return {
      enabled: flag('rewardedAds'),
      provider: AD_PROVIDER,
      reward: String(ECONOMY.rewardedAds.credits),
      dailyLimit: ECONOMY.rewardedAds.dailyLimit,
      watchedToday: ads.watchedToday,
      nextAvailableAt: cooling ? iso(ads.nextAvailableAt!) : null,
      resetsAt: iso(nextUtcMidnight(now)),
    };
  };
  const adStart: MonetizationApi['adStart'] = (career) => {
    requireOpen(career, 'rewardedAds');
    const status = adsStatus(career);
    if (status.watchedToday >= status.dailyLimit)
      throw new MockError(429, 'AD_LIMIT_REACHED', 'Daily limit reached', { resetsAt: status.resetsAt });
    if (status.nextAvailableAt)
      throw new MockError(429, 'AD_COOLDOWN', 'Cooldown running', {
        nextAvailableAt: status.nextAvailableAt,
      });
    const minWatchSeconds = Math.max(2, Math.round(SIMULATED_AD_SECONDS / engine.speed));
    const adToken = engine.id('adt');
    // Only the latest token stays valid: a new start voids an abandoned one.
    monetizationState(career).ads.tokens = { [adToken]: { startedAt: engine.now(), minWatchSeconds } };
    engine.save();
    // Like the server's SimulatedAdProvider: the proof is derived from the session, never invented by the client,
    // and `adComplete` refuses anything else. Keeps the mock honest about the PROOF_MISMATCH path.
    return {
      adToken,
      minWatchSeconds,
      provider: AD_PROVIDER,
      providerConfig: { simulated: true, proof: adProof(adToken) },
    };
  };
  const adComplete: MonetizationApi['adComplete'] = (career, body) => {
    const { ads } = monetizationState(career);
    const token = typeof body.adToken === 'string' ? ads.tokens[body.adToken] : undefined;
    if (!token) throw new MockError(409, 'CONFLICT', 'Ad token unknown or already used');
    if (body.providerProof !== undefined && body.providerProof !== adProof(String(body.adToken)))
      throw new MockError(400, 'VALIDATION_ERROR', 'The ad completion could not be verified', {
        fields: ['providerProof'],
      });
    // 500 ms of tolerance for timer drift between the player and the server clock.
    if (engine.now() - token.startedAt < token.minWatchSeconds * 1000 - 500)
      throw new MockError(422, 'VALIDATION_ERROR', 'The video was not watched to the end', {
        fields: ['adToken'],
      });
    const before = adsStatus(career);
    if (before.watchedToday >= before.dailyLimit)
      throw new MockError(429, 'AD_LIMIT_REACHED', 'Daily limit reached', { resetsAt: before.resetsAt });
    ads.tokens = {};
    ads.watchedToday += 1;
    ads.nextAvailableAt = engine.now() + engine.dur(ECONOMY.rewardedAds.cooldownSeconds);
    engine.credit(career, ECONOMY.rewardedAds.credits, 'REWARDED_AD');
    engine.save();
    return { credited: String(ECONOMY.rewardedAds.credits), status: adsStatus(career) };
  };

  /* ───────────── referral ───────────── */
  const codeOf = (userId: string): string => {
    const g = globalState(engine);
    const existing = Object.entries(g.codes).find(([, owner]) => owner === userId);
    if (existing) return existing[0];
    let code = '';
    do {
      code = Array.from(
        { length: 8 },
        () => CODE_ALPHABET[Math.floor(engine.random() * CODE_ALPHABET.length)],
      ).join('');
    } while (g.codes[code]);
    g.codes[code] = userId;
    return code;
  };
  const { inviterBonus, inviteeBonus, requiredActivatedReferrals, activation } = ECONOMY.referral;
  const isActivated = (r: ReferralRow) => r.status === 'ACTIVATED' || r.status === 'REWARDED';

  /** Pays the referrer once the required number of invited Directors is activated (ledger REFERRAL_BONUS). */
  const settleReferrer = (referrerUserId: string): void => {
    const career = careerOfUser(referrerUserId);
    if (!career) return;
    const state = monetizationState(career);
    const rows = globalState(engine).referrals.filter((r) => r.referrerUserId === referrerUserId);
    if (!state.referralRewardClaimed && rows.filter(isActivated).length >= requiredActivatedReferrals) {
      state.referralRewardClaimed = true;
      engine.credit(career, inviterBonus, 'REFERRAL_BONUS');
      engine.notify(career, {
        category: 'ECONOMY',
        priority: 'IMPORTANT',
        title: text('notifications.referralRewarded', { credits: inviterBonus }),
      });
    }
    if (state.referralRewardClaimed)
      for (const r of rows) if (r.status === 'ACTIVATED') r.status = 'REWARDED';
  };
  /** Activation rule D-47: N resolved missions on at least M distinct days → invited bonus, then the referrer side. */
  const activateIfReady = (row: ReferralRow): void => {
    if (row.status !== 'REGISTERED') return;
    if (row.missionsDone < activation.resolvedIncidents || row.days.length < activation.distinctDays) return;
    row.status = 'ACTIVATED';
    const invitedCareer = row.invitedUserId ? careerOfUser(row.invitedUserId) : undefined;
    if (invitedCareer) {
      engine.credit(invitedCareer, inviteeBonus, 'REFERRAL_BONUS');
      engine.notify(invitedCareer, {
        category: 'ECONOMY',
        title: text('notifications.referralWelcome', { credits: inviteeBonus }),
      });
    }
    settleReferrer(row.referrerUserId);
  };
  const registerInvite: MonetizationApi['registerInvite'] = (career, rawCode) => {
    const g = globalState(engine);
    const code = rawCode.trim().toUpperCase();
    const referrerUserId = g.codes[code];
    // Unknown code, self-invite or a Director who was already invited: silently ignored (never blocks sign-up).
    if (!referrerUserId || referrerUserId === career.userId) return false;
    if (g.referrals.some((r) => r.invitedUserId === career.userId)) return false;
    g.referrals.push({
      id: engine.id('ref'),
      code,
      referrerUserId,
      invitedUserId: career.userId,
      invitedName: career.summary.directorName,
      status: 'REGISTERED',
      joinedAt: iso(engine.now()),
      missionsDone: 0,
      days: [],
    });
    const referrer = careerOfUser(referrerUserId);
    if (referrer) engine.emit(referrer, 'credits.changed', { credits: referrer.summary.credits });
    return true;
  };
  const referrals = (career: MockCareer): Referral => {
    const g = globalState(engine);
    const code = codeOf(career.userId);
    const mine = g.referrals.filter((r) => r.referrerUserId === career.userId);
    const invitation = g.referrals.find((r) => r.invitedUserId === career.userId);
    return {
      code,
      inviteUrl: `${origin()}/invite/${code}`,
      required: requiredActivatedReferrals,
      activated: Math.min(requiredActivatedReferrals, mine.filter(isActivated).length),
      rewardReferrer: String(inviterBonus),
      rewardInvited: String(inviteeBonus),
      rewardClaimed: monetizationState(career).referralRewardClaimed,
      activation: {
        missionsRequired: activation.resolvedIncidents,
        distinctDaysRequired: activation.distinctDays,
      },
      invited: mine.map((r) => ({ directorName: r.invitedName, status: r.status, joinedAt: r.joinedAt })),
      myInvitation: invitation
        ? {
            referrerName: invitation.referrerUserId.startsWith(DEMO_REFERRER)
              ? invitation.referrerUserId.slice(DEMO_REFERRER.length)
              : (accountOf(invitation.referrerUserId)?.user.directorName ?? '—'),
            missionsDone: Math.min(invitation.missionsDone, activation.resolvedIncidents),
            daysDone: Math.min(invitation.days.length, activation.distinctDays),
            status: invitation.status,
          }
        : null,
    };
  };
  const publicInvite: MonetizationApi['publicInvite'] = (rawCode) => {
    const owner = globalState(engine).codes[rawCode.trim().toUpperCase()];
    const account = owner ? accountOf(owner) : undefined;
    return account && account.status === 'ACTIVE'
      ? { directorName: account.user.directorName, valid: true }
      : { directorName: '', valid: false };
  };

  engine.hooks.careerCreated.push((career) => {
    codeOf(career.userId);
    // The core mock handlers do not forward `attribution.referralCode` of the OTP request, so the in-browser mock reads
    // the code the client parked after sign-up (see features/monetization/invite-code.ts).
    try {
      const code = globalThis.localStorage?.getItem(MOCK_INVITE_HANDOFF_KEY);
      if (code) {
        registerInvite(career, code);
        globalThis.localStorage?.removeItem(MOCK_INVITE_HANDOFF_KEY);
      }
    } catch {
      /* storage unavailable: no invite */
    }
  });
  engine.hooks.incidentClosed.push((career, _incident, status) => {
    if (status !== 'RESOLVED') return;
    const row = globalState(engine).referrals.find((r) => r.invitedUserId === career.userId);
    if (!row || row.status !== 'REGISTERED') return;
    row.missionsDone += 1;
    const today = dayKey(engine.now());
    if (!row.days.includes(today)) row.days.push(today);
    activateIfReady(row);
  });

  apis.set(engine, {
    packages,
    checkout,
    purchases: (career) => monetizationState(career).purchases,
    webhook,
    savedPaymentMethod,
    saveCard,
    removeSavedCard,
    checkoutSaved,
    speedupQuote: (career, target, targetId) => quote(career, target, targetId).quote,
    speedup,
    adsStatus,
    adStart,
    adComplete,
    referrals,
    publicInvite,
    registerInvite,
  });

  /* ───────────── QA helpers ───────────── */
  let friendCounter = 0;
  /**
   * Adds a simulated invited Director in the given state (or moves the oldest REGISTERED one forward when
   * `status` is ACTIVATED and one exists). Goes through the same activation/reward code as real invitees.
   */
  const simulateInvitee = ((status: InviteStatus = 'REGISTERED', name?: string) => {
    const career = engine.qa.career();
    const g = globalState(engine);
    const code = codeOf(career.userId);
    let row =
      status === 'ACTIVATED'
        ? g.referrals.find(
            (r) => r.referrerUserId === career.userId && r.status === 'REGISTERED' && !r.invitedUserId,
          )
        : undefined;
    if (!row) {
      friendCounter += 1;
      row = {
        id: engine.id('ref'),
        code,
        referrerUserId: career.userId,
        invitedUserId: null,
        invitedName: name ?? `Direttore Demo ${g.referrals.length + friendCounter}`,
        status: 'REGISTERED',
        joinedAt: iso(engine.now()),
        missionsDone: 0,
        days: [],
      };
      g.referrals.push(row);
    }
    if (status === 'ACTIVATED' || status === 'REWARDED') {
      row.missionsDone = activation.resolvedIncidents;
      row.days = Array.from({ length: activation.distinctDays }, (_, i) =>
        dayKey(engine.now() - i * 86_400_000),
      );
      activateIfReady(row);
    } else if (status === 'INVALIDATED') row.status = 'INVALIDATED';
    engine.emit(career, 'credits.changed', { credits: career.summary.credits, career: career.summary });
    engine.save();
    return row.status;
  }) as never;
  /** Makes the current Director an invited one (simulated referrer) with the given progress. */
  const simulateInvitedBy = ((referrerName = 'Direttore Amico', missionsDone = 0, daysDone = 0) => {
    const career = engine.qa.career();
    const g = globalState(engine);
    g.referrals = g.referrals.filter((r) => r.invitedUserId !== career.userId);
    const row: ReferralRow = {
      id: engine.id('ref'),
      code: 'DEMOCODE',
      referrerUserId: `${DEMO_REFERRER}${referrerName}`,
      invitedUserId: career.userId,
      invitedName: career.summary.directorName,
      status: 'REGISTERED',
      joinedAt: iso(engine.now()),
      missionsDone,
      days: Array.from({ length: daysDone }, (_, i) => dayKey(engine.now() - i * 86_400_000)),
    };
    g.referrals.push(row);
    activateIfReady(row);
    engine.emit(career, 'credits.changed', { credits: career.summary.credits, career: career.summary });
    engine.save();
    return row.status;
  }) as never;
  /** Ends the rewarded-video cooldown (and optionally resets today's counter). */
  const resetAds = ((resetDay = false) => {
    const { ads } = monetizationState(engine.qa.career());
    ads.nextAvailableAt = null;
    if (resetDay) ads.watchedToday = 0;
    engine.save();
  }) as never;
  // `installQa` runs after the domains and replaces `engine.qa`: attach once it exists.
  const attach = () => Object.assign(engine.qa, { simulateInvitee, simulateInvitedBy, resetAds });
  if (engine.qa) attach();
  else queueMicrotask(attach);
}
