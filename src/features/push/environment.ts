import { env } from '@/lib/env';
import { isInAppBrowser } from '@/features/platform/in-app-browser';
import { isIosDevice, isStandalone, shouldRegisterServiceWorker } from '@/features/platform/pwa';

/** What this device can do with web push, read from the browser (never from the account). */
export interface PushEnvironment {
  /** Service worker + Push API + Notification API, in a secure context, in a build that has a service worker. */
  supported: boolean;
  /** `Notification.permission`; null when the Notification API does not exist here. */
  permission: NotificationPermission | null;
  /** iPhone / iPad (iPadOS included, it pretends to be a Mac). */
  ios: boolean;
  /**
   * iOS / iPadOS 16.4+: web push works there, but only inside the app added to the Home Screen. True when the version
   * cannot be read (iPadOS reports a Mac user agent — and every iPad that does is recent enough).
   */
  iosPushCapable: boolean;
  /** Running as the installed app (display-mode standalone). */
  standalone: boolean;
  /** Inside TikTok / Instagram / Facebook…: no push and no install there. */
  inApp: boolean;
  /** Android (the "blocked" help points at the system settings of the installed app). */
  android: boolean;
  /** Safari on a Mac (its site settings live in Safari → Settings → Websites). */
  macSafari: boolean;
}

/** iOS version from an iPhone / iPad user agent (`… CPU iPhone OS 17_4 like Mac OS X …`), null when absent. */
export function iosVersion(userAgent: string): [number, number] | null {
  const match = /(?:iPhone|iPad|iPod)[^)]*?\bOS (\d+)[_.](\d+)/.exec(userAgent);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Web push for Home Screen apps arrived with iOS / iPadOS 16.4. */
export function iosSupportsWebPush(userAgent: string): boolean {
  const version = iosVersion(userAgent);
  if (!version) return true;
  const [major, minor] = version;
  return major > 16 || (major === 16 && minor >= 4);
}

export function readPushEnvironment(): PushEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return {
      supported: false,
      permission: null,
      ios: false,
      iosPushCapable: false,
      standalone: false,
      inApp: false,
      android: false,
      macSafari: false,
    };
  const ua = navigator.userAgent;
  const hasWorker = 'serviceWorker' in navigator;
  // In mock mode MSW's worker owns the root scope and carries the subscription; otherwise only builds that register
  // `/sw.js` (production, real API) can ever receive a push — `next dev` against a real API cannot.
  const workerExpected =
    env.apiMock ||
    shouldRegisterServiceWorker({
      apiMock: env.apiMock,
      nodeEnv: process.env.NODE_ENV,
      supported: hasWorker,
      secureContext: window.isSecureContext,
    });
  const hasNotification = 'Notification' in window;
  const ios = isIosDevice(ua, navigator.maxTouchPoints);
  return {
    supported:
      hasWorker && hasNotification && 'PushManager' in window && window.isSecureContext && workerExpected,
    permission: hasNotification ? Notification.permission : null,
    ios,
    iosPushCapable: ios && iosSupportsWebPush(ua),
    standalone: isStandalone(),
    inApp: isInAppBrowser(ua),
    android: /Android/i.test(ua),
    macSafari:
      !ios && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox/.test(ua),
  };
}
