import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  /** null = not chosen yet → default: on for desktop, off for touch devices */
  sound: boolean | null;
  reducedMotion: boolean;
  tutorialHints: boolean;
  setSound: (on: boolean) => void;
  setReducedMotion: (on: boolean) => void;
  setTutorialHints: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      sound: null,
      reducedMotion: false,
      tutorialHints: true,
      setSound: (sound) => set({ sound }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setTutorialHints: (tutorialHints) => set({ tutorialHints }),
    }),
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
