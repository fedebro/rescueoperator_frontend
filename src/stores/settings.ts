import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Sound cues are grouped so that a player can keep operational alerts while muting UI feedback (or the reverse). */
export type SoundCategory = 'alerts' | 'feedback';

interface SettingsState {
  /** null = not chosen yet → default: on for desktop, off for touch devices */
  sound: boolean | null;
  /** Master volume 0…1 applied to every synthesised cue. */
  soundVolume: number;
  /** New incidents, escalations, critical notifications, failures. */
  soundAlerts: boolean;
  /** Arrivals, success, level up, purchases, UI confirmations. */
  soundFeedback: boolean;
  reducedMotion: boolean;
  tutorialHints: boolean;
  /**
   * Product analytics consent. null = never asked → treated as OFF (the sign-up flow has no analytics consent,
   * so nothing is collected until the player opts in from Settings).
   */
  analyticsConsent: boolean | null;
  /** The one-time "install the app" hint was dismissed (or the app was installed). */
  installHintDismissed: boolean;
  setSound: (on: boolean) => void;
  setSoundVolume: (volume: number) => void;
  setSoundCategory: (category: SoundCategory, on: boolean) => void;
  setReducedMotion: (on: boolean) => void;
  setTutorialHints: (on: boolean) => void;
  setAnalyticsConsent: (on: boolean) => void;
  dismissInstallHint: () => void;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      sound: null,
      soundVolume: 0.7,
      soundAlerts: true,
      soundFeedback: true,
      reducedMotion: false,
      tutorialHints: true,
      analyticsConsent: null,
      installHintDismissed: false,
      setSound: (sound) => set({ sound }),
      setSoundVolume: (volume) => set({ soundVolume: clamp01(volume) }),
      setSoundCategory: (category, on) =>
        set(category === 'alerts' ? { soundAlerts: on } : { soundFeedback: on }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setTutorialHints: (tutorialHints) => set({ tutorialHints }),
      setAnalyticsConsent: (analyticsConsent) => set({ analyticsConsent }),
      dismissInstallHint: () => set({ installHintDismissed: true }),
    }),
    // Version stays 1: the new keys are additive and the default shallow merge fills them for old saves.
    { name: 'rc-settings', version: 1 },
  ),
);

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

/** Sound is opt-in on mobile (in-app webviews autoplay policies, public places), on by default on desktop. */
export function soundEnabled(setting: boolean | null): boolean {
  return setting ?? !isTouchDevice();
}

/** Analytics is strictly opt-in: only an explicit `true` enables collection. */
export function analyticsAllowed(setting: boolean | null): boolean {
  return setting === true;
}
