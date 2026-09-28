/**
 * In-app browsers: the web views that open a link inside TikTok, Instagram, Facebook… — where marketing traffic lands
 * (03 §3 #7). They are WebKit (iOS) or the system WebView (Android) under the host app's own chrome, which means: no
 * "Add to Home Screen" (the PWA install flow cannot work there), usually no service worker on iOS, pop-ups blocked, audio
 * only after a gesture, no vibration on iOS, and the page may be reloaded when the player switches to the mail app to read
 * the sign-in code. The game handles each of these on its own; this module only tells them apart for what depends on it.
 */
export type InAppBrowser = 'tiktok' | 'instagram' | 'facebook' | 'other';

const RULES: readonly [InAppBrowser, RegExp][] = [
  // TikTok: "musical_ly" (the historic bundle), "BytedanceWebview", "TikTok", "trill" (TikTok Lite / some regions).
  ['tiktok', /musical_ly|BytedanceWebview|\bTikTok\b|\btrill_/i],
  ['instagram', /\bInstagram\b/i],
  ['facebook', /\bFBAN\/|\bFBAV\/|\bFB_IAB\b|\bFBIOS\b/],
  // Other common in-app views: LinkedIn, Snapchat, Line, X/Twitter's in-app browser.
  ['other', /LinkedInApp|Snapchat|\bLine\/\d|Twitter for/i],
];

/** Which in-app browser this user agent belongs to, null for a regular browser (or an installed PWA). */
export function inAppBrowserOf(userAgent: string): InAppBrowser | null {
  for (const [name, pattern] of RULES) if (pattern.test(userAgent)) return name;
  return null;
}

export const isInAppBrowser = (userAgent: string): boolean => inAppBrowserOf(userAgent) !== null;
