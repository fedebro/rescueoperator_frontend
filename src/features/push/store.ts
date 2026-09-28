import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PushPlatform } from '@/contracts';

/** The last successful `POST …/push/subscriptions` from this device. */
export interface PushSyncRecord {
  endpoint: string;
  careerId: string;
  /**
   * BROWSER or PWA when it was sent. On Android the tab and the installed app share storage AND the subscription: opening
   * the installed app re-sends it so the server knows it is the app. Optional: records written before it existed.
   */
  platform?: PushPlatform;
  /** Epoch ms. */
  at: number;
}

interface PushMemoryState {
  /** Release (`RELEASE_ID`) in which this device last showed a permission sheet: at most one per release (D-98). */
  promptedRelease: string | null;
  /** Push turned off on this device from Settings: a granted permission must not re-subscribe it silently. */
  optedOut: boolean;
  /** What the server was last told about this device (a re-sync is skipped while it is fresh). */
  synced: PushSyncRecord | null;
  markPrompted: (releaseId: string) => void;
  setOptedOut: (optedOut: boolean) => void;
  setSynced: (record: PushSyncRecord | null) => void;
}

/** Per-device memory of the push flow (localStorage `rc-push`). Never holds anything personal. */
export const usePushStore = create<PushMemoryState>()(
  persist(
    (set) => ({
      promptedRelease: null,
      optedOut: false,
      synced: null,
      markPrompted: (promptedRelease) => set({ promptedRelease }),
      setOptedOut: (optedOut) => set({ optedOut }),
      setSynced: (synced) => set({ synced }),
    }),
    { name: 'rc-push', version: 1 },
  ),
);
