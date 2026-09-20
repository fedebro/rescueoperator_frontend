import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureInviteCodeFromUrl,
  inviteAttribution,
  readInviteCode,
  rememberInviteCode,
  settleInviteCode,
} from './invite-code';
import { formatPrice } from './money';
import { copyText, nativeShare, shareIntentUrl } from './share';
import { speedupInvalidations } from './speedup-button';
import { getRewardedAdProvider, registerRewardedAdProvider } from './ads/provider';

describe('formatPrice', () => {
  it('always renders the currency, from minor units', () => {
    expect(formatPrice(499, 'EUR', 'it')).toMatch(/4,99\s€/);
    expect(formatPrice(1999, 'EUR', 'en')).toBe('€19.99');
    expect(formatPrice(500, 'JPY', 'en')).toBe('¥500');
  });
});

describe('invite code hand-off', () => {
  beforeEach(() => localStorage.clear());
  it('remembers a valid code (upper-cased) and exposes it as OTP attribution', () => {
    expect(captureInviteCodeFromUrl('?utm_source=x&ref=abcd2345')).toBe('ABCD2345');
    expect(inviteAttribution()).toEqual({ attribution: { referralCode: 'ABCD2345' } });
  });
  it('rejects malformed codes and expires after 30 days', () => {
    expect(rememberInviteCode('a b')).toBe(false);
    expect(rememberInviteCode('x'.repeat(17))).toBe(false);
    expect(inviteAttribution()).toEqual({});
    rememberInviteCode('GOODCODE', 0);
    expect(readInviteCode(29 * 24 * 3600_000)).toBe('GOODCODE');
    expect(readInviteCode(31 * 24 * 3600_000)).toBeNull();
  });
  it('is consumed at sign-in; parked for the mock backend only for a new user', () => {
    rememberInviteCode('GOODCODE');
    settleInviteCode(false);
    expect(readInviteCode()).toBeNull();
    expect(localStorage.getItem('rc-invite-code-sent')).toBeNull();
    rememberInviteCode('GOODCODE');
    settleInviteCode(true);
    expect(readInviteCode()).toBeNull();
    expect(localStorage.getItem('rc-invite-code-sent')).toBe('GOODCODE');
  });
});

describe('share helpers', () => {
  const payload = { title: 'Titolo', text: 'Vieni a giocare & vinci', url: 'https://x.test/invite/ABCD2345' };
  afterEach(() => vi.unstubAllGlobals());
  it('builds encoded intents for every fallback channel', () => {
    expect(shareIntentUrl('whatsapp', payload)).toBe(
      `https://wa.me/?text=${encodeURIComponent(`${payload.text} ${payload.url}`)}`,
    );
    expect(shareIntentUrl('telegram', payload)).toContain(`url=${encodeURIComponent(payload.url)}`);
    expect(shareIntentUrl('email', payload)).toMatch(/^mailto:\?subject=Titolo&body=/);
  });
  it('reports unsupported / dismissed / shared from the Web Share API', async () => {
    expect(await nativeShare(payload)).toBe('unsupported');
    const share = vi.fn().mockResolvedValueOnce(undefined);
    vi.stubGlobal('navigator', { share });
    expect(await nativeShare(payload)).toBe('shared');
    share.mockRejectedValueOnce(new DOMException('closed', 'AbortError'));
    expect(await nativeShare(payload)).toBe('dismissed');
    share.mockRejectedValueOnce(new Error('boom'));
    expect(await nativeShare(payload)).toBe('unsupported');
  });
  it('copies through the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });
});

describe('speed-up invalidations', () => {
  it('always refreshes the economy and adds the domain root of the target', () => {
    const keys = (target: Parameters<typeof speedupInvalidations>[1], id = 'x') =>
      speedupInvalidations('car_1', target, id).map((k) => k.join('/'));
    expect(keys('TRAINING')).toEqual(
      expect.arrayContaining(['career/car_1/economy/balance', 'career/car_1/personnel']),
    );
    expect(keys('SUPPLY_DELIVERY')).toContain('career/car_1/inventory');
    expect(keys('MAINTENANCE')).toContain('career/car_1/maintenance');
    expect(keys('FACILITY_UPGRADE', 'fac_1:GARAGE')).toContain('career/car_1/facility/fac_1');
  });
});

describe('rewarded ad provider registry', () => {
  it('plugs and unplugs a provider by id', async () => {
    const provider = {
      id: 'acme',
      isAvailable: () => true,
      show: async () => ({ completed: true, proof: 'p' }),
    };
    const off = registerRewardedAdProvider(provider);
    expect(getRewardedAdProvider('acme')).toBe(provider);
    off();
    expect(getRewardedAdProvider('acme')).toBeUndefined();
  });
});
