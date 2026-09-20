import { create } from 'zustand';
import { track } from '@/lib/analytics';

/** Chromium's install prompt event (not in lib.dom). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaState {
  /** Captured `beforeinstallprompt` (Chromium, Android, desktop). null = the browser did not offer one. */
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
  setDeferred: (event: BeforeInstallPromptEvent | null) => void;
  setInstalled: () => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  deferred: null,
  installed: false,
  setDeferred: (deferred) => set({ deferred }),
  setInstalled: () => set({ installed: true, deferred: null }),
}));

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iOS/iPadOS Safari has no install prompt: the player must use Share → "Add to Home Screen". */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  // iPadOS 13+ pretends to be a Mac; a Mac with a multi-touch screen does not exist.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export type InstallMode = 'native' | 'ios' | 'unavailable' | 'installed';

export function installMode(input: {
  hasPrompt: boolean;
  installed: boolean;
  standalone: boolean;
  ios: boolean;
}): InstallMode {
  if (input.installed || input.standalone) return 'installed';
  if (input.hasPrompt) return 'native';
  if (input.ios) return 'ios';
  return 'unavailable';
}

/**
 * The service worker of the app (`/sw.js`: offline shell + static asset cache) is registered ONLY in production
 * builds that talk to a real API. In mock mode MSW owns the root-scope worker (`/mockServiceWorker.js`): a second
 * root-scope registration would replace it and silently break every mocked request.
 */
export function shouldRegisterServiceWorker(input: {
  apiMock: boolean;
  nodeEnv: string | undefined;
  supported: boolean;
  secureContext: boolean;
}): boolean {
  return !input.apiMock && input.nodeEnv === 'production' && input.supported && input.secureContext;
}

export async function registerServiceWorker(input: {
  apiMock: boolean;
  nodeEnv: string | undefined;
}): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  const supported = 'serviceWorker' in navigator;
  if (!shouldRegisterServiceWorker({ ...input, supported, secureContext: window.isSecureContext }))
    return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } catch {
    return null; // the game works without it
  }
}

/** Captures the install prompt and the `appinstalled` event. Returns the cleanup. */
export function listenForInstall(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onPrompt = (event: Event) => {
    event.preventDefault(); // no browser mini-infobar: the game offers its own, unobtrusive entry
    usePwaStore.getState().setDeferred(event as BeforeInstallPromptEvent);
  };
  const onInstalled = () => {
    usePwaStore.getState().setInstalled();
    track('pwa_installed');
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

/** Shows the captured native prompt. Resolves with the player's choice (or 'unavailable'). */
export async function promptInstall(
  source: 'hint' | 'settings',
): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const { deferred, setDeferred } = usePwaStore.getState();
  if (!deferred) return 'unavailable';
  track('pwa_install_prompted', { platform: 'native', source });
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  setDeferred(null); // a prompt event can be used once
  if (outcome === 'accepted') track('pwa_install_accepted');
  else track('pwa_install_dismissed', { source: 'native' });
  return outcome;
}
