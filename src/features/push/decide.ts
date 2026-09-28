import type { PushEnvironment } from './environment';

/**
 * The in-game sheets of the permission flow (D-98):
 *  - `ask`: "Non perdere nessuna emergenza" → "Attiva notifiche" (the browser's own prompt, from that tap) / "Non ora";
 *  - `denied`: the browser blocks notifications for the site — how to allow them again in its settings;
 *  - `ios-install`: iPhone / iPad Safari — web push only works in the app added to the Home Screen.
 */
export type PushPromptVariant = 'ask' | 'denied' | 'ios-install';

export type PushAction =
  /** Nothing to do on this device (push off on the server, unsupported, already asked in this release, tutorial…). */
  | { type: 'none' }
  /** Permission granted: make sure this device is subscribed and the server knows it — silently, no UI. */
  | { type: 'sync' }
  /** Show one sheet (at a calm moment of the session). */
  | { type: 'prompt'; variant: PushPromptVariant };

export interface PushDecisionInput {
  /** The running build (`RELEASE_ID`). */
  releaseId: string;
  /** `GET /push/config` → `enabled`. */
  serverEnabled: boolean;
  env: PushEnvironment;
  /** The career's tutorial is over: the sheet never interrupts it. */
  tutorialCompleted: boolean;
  /** Release in which this device last showed one of the sheets. */
  promptedRelease: string | null;
  /** The player turned push off on this device from Settings: no silent re-subscription. */
  optedOut: boolean;
}

const NONE: PushAction = { type: 'none' };

/**
 * One decision per game session and per change of its inputs. Every device that has not enabled push is asked once per
 * release — whatever the reason (never asked, "Non ora", blocked, turned off in Settings) — after the tutorial.
 */
export function decidePushAction(input: PushDecisionInput): PushAction {
  const { env } = input;
  if (!input.serverEnabled || env.inApp) return NONE;
  const mayPrompt = input.tutorialCompleted && input.promptedRelease !== input.releaseId;
  // iPhone / iPad outside the installed app: Safari has no Push API there at all — explain the Home Screen app instead.
  if (env.ios && !env.standalone)
    return env.iosPushCapable && mayPrompt ? { type: 'prompt', variant: 'ios-install' } : NONE;
  if (!env.supported || env.permission === null) return NONE;
  if (env.permission === 'granted' && !input.optedOut) return { type: 'sync' };
  if (!mayPrompt) return NONE;
  return { type: 'prompt', variant: env.permission === 'denied' ? 'denied' : 'ask' };
}

/** What the Settings card says about this device. */
export type PushDeviceStatus =
  'loading' | 'unavailable' | 'in-app' | 'ios-install' | 'unsupported' | 'denied' | 'on' | 'off';

export function pushDeviceStatus(input: {
  /** null while `GET /push/config` is loading. */
  serverEnabled: boolean | null;
  env: PushEnvironment | null;
  /** null while the browser's subscription is being read. */
  subscribed: boolean | null;
  optedOut: boolean;
}): PushDeviceStatus {
  const { env } = input;
  if (input.serverEnabled === null || env === null) return 'loading';
  if (!input.serverEnabled) return 'unavailable';
  if (env.inApp) return 'in-app';
  if (env.ios && !env.standalone) return env.iosPushCapable ? 'ios-install' : 'unsupported';
  if (!env.supported || env.permission === null) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  if (env.permission === 'granted' && !input.optedOut) {
    if (input.subscribed === null) return 'loading';
    return input.subscribed ? 'on' : 'off';
  }
  return 'off';
}

/** Which "allow notifications again" instructions fit this device. */
export type DeniedHelp = 'ios-app' | 'android-app' | 'mac-safari' | 'browser';

export function deniedHelpFor(env: PushEnvironment): DeniedHelp {
  if (env.ios) return 'ios-app';
  if (env.android && env.standalone) return 'android-app';
  if (env.macSafari) return 'mac-safari';
  return 'browser';
}
