import { describe, expect, it } from 'vitest';
import { inAppBrowserOf, isInAppBrowser } from './in-app-browser';
import { installMode } from './pwa';

/** Real user agents of the in-app browsers where campaign traffic lands (2026), and two regular browsers. */
const USER_AGENTS = {
  tiktokIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/it Region/IT isDarkMode/1 WKWebView/1 BytedanceWebview/d8a21c6',
  tiktokAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 trill_350104 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/35.1.4 ByteLocale/it Region/IT BytedanceWebview/d8a21c6',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,2; iOS 17_5; it_IT; it; scale=3.00; 1179x2556; 609396452)',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; it_IT; 609396452)',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/466.0.0.34.107;FBBV/620000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/it_IT;FBOP/5]',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
};

describe('in-app browsers', () => {
  it('recognises TikTok, Instagram and Facebook on both platforms, never a regular browser', () => {
    expect(inAppBrowserOf(USER_AGENTS.tiktokIos)).toBe('tiktok');
    expect(inAppBrowserOf(USER_AGENTS.tiktokAndroid)).toBe('tiktok');
    expect(inAppBrowserOf(USER_AGENTS.instagramIos)).toBe('instagram');
    expect(inAppBrowserOf(USER_AGENTS.instagramAndroid)).toBe('instagram');
    expect(inAppBrowserOf(USER_AGENTS.facebookIos)).toBe('facebook');
    expect(isInAppBrowser(USER_AGENTS.safariIphone)).toBe(false);
    expect(isInAppBrowser(USER_AGENTS.chromeAndroid)).toBe(false);
  });

  it('never offers the install flow inside another app (no "Add to Home Screen" there)', () => {
    const none = { hasPrompt: false, installed: false, standalone: false, ios: false };
    expect(installMode({ ...none, ios: true, inApp: true })).toBe('in-app');
    expect(installMode({ ...none, hasPrompt: true, inApp: true })).toBe('in-app');
    // Opened from the home screen it is simply installed.
    expect(installMode({ ...none, standalone: true, inApp: true })).toBe('installed');
    expect(installMode({ ...none, ios: true })).toBe('ios');
  });
});
