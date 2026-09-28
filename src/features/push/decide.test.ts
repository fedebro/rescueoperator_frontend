import { describe, expect, it } from 'vitest';
import { decidePushAction, deniedHelpFor, pushDeviceStatus, type PushDecisionInput } from './decide';
import { iosSupportsWebPush, iosVersion, type PushEnvironment } from './environment';

const desktop: PushEnvironment = {
  supported: true,
  permission: 'default',
  ios: false,
  iosPushCapable: false,
  standalone: false,
  inApp: false,
  android: false,
  macSafari: false,
};

const input = (
  patch: Partial<PushDecisionInput> = {},
  env: Partial<PushEnvironment> = {},
): PushDecisionInput => ({
  releaseId: 'R2',
  serverEnabled: true,
  env: { ...desktop, ...env },
  tutorialCompleted: true,
  promptedRelease: null,
  optedOut: false,
  ...patch,
});

describe('decidePushAction — the permission flow of D-98', () => {
  it('asks a device whose permission is still "default", once per release', () => {
    expect(decidePushAction(input())).toEqual({ type: 'prompt', variant: 'ask' });
    // Already asked in this release ("Non ora", or the sheet was simply shown): nothing until the next one.
    expect(decidePushAction(input({ promptedRelease: 'R2' }))).toEqual({ type: 'none' });
    // A new build = a new release: asked again.
    expect(decidePushAction(input({ promptedRelease: 'R1' }))).toEqual({ type: 'prompt', variant: 'ask' });
  });

  it('never asks during the tutorial (it asks after it, or at a later session)', () => {
    expect(decidePushAction(input({ tutorialCompleted: false }))).toEqual({ type: 'none' });
    expect(decidePushAction(input({ tutorialCompleted: false }, { permission: 'denied' }))).toEqual({
      type: 'none',
    });
    expect(
      decidePushAction(input({ tutorialCompleted: false }, { ios: true, iosPushCapable: true })),
    ).toEqual({ type: 'none' });
  });

  it('granted: silent (re)subscription, no sheet — even during the tutorial and in an already-asked release', () => {
    expect(decidePushAction(input({}, { permission: 'granted' }))).toEqual({ type: 'sync' });
    expect(
      decidePushAction(input({ tutorialCompleted: false, promptedRelease: 'R2' }, { permission: 'granted' })),
    ).toEqual({ type: 'sync' });
  });

  it('granted but turned off on this device: no silent re-subscription, asked again at the next release', () => {
    expect(
      decidePushAction(input({ optedOut: true, promptedRelease: 'R2' }, { permission: 'granted' })),
    ).toEqual({
      type: 'none',
    });
    expect(
      decidePushAction(input({ optedOut: true, promptedRelease: 'R1' }, { permission: 'granted' })),
    ).toEqual({
      type: 'prompt',
      variant: 'ask',
    });
  });

  it('denied: once per release, a short card on how to allow them again', () => {
    expect(decidePushAction(input({}, { permission: 'denied' }))).toEqual({
      type: 'prompt',
      variant: 'denied',
    });
    expect(decidePushAction(input({ promptedRelease: 'R2' }, { permission: 'denied' }))).toEqual({
      type: 'none',
    });
  });

  it('iPhone / iPad Safari (not installed): explains the Home Screen app; inside the installed app: the real prompt', () => {
    const safari = { ios: true, iosPushCapable: true, supported: false, permission: null };
    expect(decidePushAction(input({}, safari))).toEqual({ type: 'prompt', variant: 'ios-install' });
    expect(decidePushAction(input({ promptedRelease: 'R2' }, safari))).toEqual({ type: 'none' });
    // iOS older than 16.4 has no web push at all, installed or not.
    expect(decidePushAction(input({}, { ...safari, iosPushCapable: false }))).toEqual({ type: 'none' });
    const installed = { ios: true, iosPushCapable: true, standalone: true, supported: true };
    expect(decidePushAction(input({}, { ...installed, permission: 'default' }))).toEqual({
      type: 'prompt',
      variant: 'ask',
    });
    expect(decidePushAction(input({}, { ...installed, permission: 'granted' }))).toEqual({ type: 'sync' });
  });

  it('does nothing without the Push API, inside in-app browsers or when the server has push off', () => {
    expect(decidePushAction(input({}, { supported: false }))).toEqual({ type: 'none' });
    expect(decidePushAction(input({}, { permission: null }))).toEqual({ type: 'none' });
    expect(decidePushAction(input({}, { inApp: true }))).toEqual({ type: 'none' });
    expect(decidePushAction(input({}, { inApp: true, ios: true, iosPushCapable: true }))).toEqual({
      type: 'none',
    });
    expect(decidePushAction(input({ serverEnabled: false }, { permission: 'granted' }))).toEqual({
      type: 'none',
    });
    expect(decidePushAction(input({ serverEnabled: false }))).toEqual({ type: 'none' });
  });
});

describe('pushDeviceStatus — the Settings card', () => {
  const status = (
    patch: Partial<Parameters<typeof pushDeviceStatus>[0]>,
    env: Partial<PushEnvironment> = {},
  ) =>
    pushDeviceStatus({
      serverEnabled: true,
      env: { ...desktop, ...env },
      subscribed: false,
      optedOut: false,
      ...patch,
    });

  it('reports every state of this device', () => {
    expect(status({ serverEnabled: null })).toBe('loading');
    expect(status({ env: null })).toBe('loading');
    expect(status({ serverEnabled: false })).toBe('unavailable');
    expect(status({}, { inApp: true })).toBe('in-app');
    expect(status({}, { ios: true, iosPushCapable: true })).toBe('ios-install');
    expect(status({}, { ios: true, iosPushCapable: false })).toBe('unsupported');
    expect(status({}, { supported: false })).toBe('unsupported');
    expect(status({}, { permission: 'denied' })).toBe('denied');
    expect(status({}, { permission: 'default' })).toBe('off');
    expect(status({ subscribed: true }, { permission: 'granted' })).toBe('on');
    expect(status({ subscribed: null }, { permission: 'granted' })).toBe('loading');
    expect(status({ subscribed: false }, { permission: 'granted' })).toBe('off');
    expect(status({ subscribed: true, optedOut: true }, { permission: 'granted' })).toBe('off');
  });
});

describe('platform details', () => {
  it('reads the iOS version and knows web push arrived with 16.4', () => {
    const ua = (v: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15`;
    expect(iosVersion(ua('17_4'))).toEqual([17, 4]);
    expect(iosVersion('Mozilla/5.0 (iPad; CPU OS 16_3 like Mac OS X)')).toEqual([16, 3]);
    expect(iosSupportsWebPush(ua('16_4'))).toBe(true);
    expect(iosSupportsWebPush(ua('16_3_1'))).toBe(false);
    expect(iosSupportsWebPush(ua('15_8'))).toBe(false);
    expect(iosSupportsWebPush(ua('18_0'))).toBe(true);
    // iPadOS with a desktop-class (Mac) user agent: no version, and every such iPad is recent enough.
    expect(iosSupportsWebPush('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true);
  });

  it('points the "blocked" help at the right settings', () => {
    expect(deniedHelpFor({ ...desktop, ios: true, standalone: true })).toBe('ios-app');
    expect(deniedHelpFor({ ...desktop, android: true, standalone: true })).toBe('android-app');
    expect(deniedHelpFor({ ...desktop, android: true })).toBe('browser');
    expect(deniedHelpFor({ ...desktop, macSafari: true })).toBe('mac-safari');
    expect(deniedHelpFor(desktop)).toBe('browser');
  });
});
