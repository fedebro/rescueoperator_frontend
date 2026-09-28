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

/** `in-app`: inside TikTok / Instagram / Facebook… — installing needs the real browser (in-app-browser.ts). */
export type InstallMode = 'native' | 'ios' | 'unavailable' | 'installed' | 'in-app';

export function installMode(input: {
  hasPrompt: boolean;
  installed: boolean;
  standalone: boolean;
  ios: boolean;
  /** Inside another app's web view: no "Add to Home Screen" there, whatever the platform says. */
  inApp?: boolean;
}): InstallMode {
  if (input.installed || input.standalone) return 'installed';
  if (input.inApp) return 'in-app';
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

let reloadedForUpdate = false;

/**
 * `public/sw.js` calls `skipWaiting()` on install and `clients.claim()` on activate, so a new version takes over
 * immediately — but the tab that's already open keeps running the OLD html/js in memory until it reloads. Without
 * this, a player who leaves the game open for days behind a PWA icon never actually gets the update they think
 * they have. Game state is server-authoritative (the reload itself is already covered by the core-loop e2e test),
 * so a full reload the instant a new worker takes control is safe, not just convenient.
 */
export function watchForUpdates(registration: ServiceWorkerRegistration): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const onControllerChange = () => {
    if (reloadedForUpdate) return; // a broken deploy must not reload-loop the player forever
    reloadedForUpdate = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  // The browser only checks for a new sw.js on its own around normal navigations, which a long-lived game tab
  // (installed as a PWA, left open for a session) may not do for a long time — ask it directly instead.
  const checkForUpdate = () => void registration.update().catch(() => undefined);
  const onVisibility = () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000);
  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(interval);
  };
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
