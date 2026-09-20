import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_EVENT_NAMES,
  isAllowedKey,
  isValidEventName,
  sanitizeProps,
  setAnalyticsSink,
  track,
} from './analytics';

afterEach(() => setAnalyticsSink(() => undefined));

describe('analytics catalogue', () => {
  it('lists every event once, as a valid contract name', () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
    for (const name of ANALYTICS_EVENT_NAMES) expect(isValidEventName(name), name).toBe(true);
  });

  it('covers the events of Master Plan §17 and of the two addenda', () => {
    const required = [
      'landing_view',
      'registration_started',
      'otp_verified',
      'career_created',
      'location_selected',
      'hq_selected',
      'first_incident',
      'first_dispatch',
      'first_mission_completed',
      'credits_earned',
      'credits_spent',
      'first_upgrade',
      'referral_shared',
      'referral_activated',
      'credit_purchase_completed',
      'rewarded_ad_completed',
      'account_started',
      'otp_requested',
      'first_mission_started',
      'credit_store_opened',
      'credit_purchase_started',
      'rewarded_ad_offered',
      'ad_landing_view',
      'referral_panel_opened',
      'referral_link_created',
      'referral_signup',
      'referral_rewarded',
      'rescue_report_generated',
      'rescue_report_shared',
      'share_link_opened',
    ];
    for (const name of required) expect(ANALYTICS_EVENT_NAMES, name).toContain(name);
  });
});

describe('PII guard', () => {
  it('keeps ids, codes, enums, numbers and booleans', () => {
    expect(
      sanitizeProps({
        incidentId: 'inc_01J8Z0000000000000000000AA',
        templateCode: 'MED_FALL',
        severity: 4,
        onDuty: true,
        amount: '12500',
        value: null,
        target: 'FACILITY_UPGRADE',
        targetId: 'fac_01:GARAGE_2',
      }),
    ).toEqual({
      incidentId: 'inc_01J8Z0000000000000000000AA',
      templateCode: 'MED_FALL',
      severity: 4,
      onDuty: true,
      amount: '12500',
      value: null,
      target: 'FACILITY_UPGRADE',
      targetId: 'fac_01:GARAGE_2',
    });
  });

  it('drops emails, names, free text and unknown keys', () => {
    expect(
      sanitizeProps({
        email: 'player@example.com',
        directorName: 'Mario Rossi',
        userName: 'mario',
        searchQuery: 'pescara',
        message: 'hello',
        whatever: 'x',
        // allowed keys, unsafe values
        source: 'player@example.com',
        context: 'free text with spaces',
        reason: 'x'.repeat(65),
        count: Number.NaN,
        step: { nested: true },
      }),
    ).toBeUndefined();
  });

  it('matches whole words of a key, not substrings', () => {
    expect(isAllowedKey('context')).toBe(true); // contains "text"
    expect(isAllowedKey('recipientId')).toBe(true); // contains "ip"
    expect(isAllowedKey('directorName')).toBe(false);
    expect(isAllowedKey('emailId')).toBe(false);
    expect(isAllowedKey('ip')).toBe(false);
  });

  it('rejects malformed event names', () => {
    for (const bad of ['', 'A', 'Has Space', 'x'.repeat(65), 'kebab-case', '1st'])
      expect(isValidEventName(bad)).toBe(false);
  });
});

describe('track facade', () => {
  it('forwards to the installed sink and never throws', () => {
    const sink = vi.fn();
    setAnalyticsSink(sink);
    track('level_up', { level: 3 });
    expect(sink).toHaveBeenCalledWith('level_up', { level: 3 });
    setAnalyticsSink(() => {
      throw new Error('boom');
    });
    expect(() => track('level_up', { level: 4 })).not.toThrow();
  });
});
