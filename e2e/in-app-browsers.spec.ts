import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * In-app browsers (03 §3 #7): campaign traffic lands in TikTok's and Instagram's web views. Their user agents are emulated
 * on a phone — Android ones on the Pixel project (Chromium, like Android's WebView), iOS ones on the iPhone project
 * (WebKit, like WKWebView) — together with what those views take away from a page: pop-ups (`window.open` gives
 * nothing), vibration (none on iOS), audio (a refused AudioContext, the strictest case: the major siren must stay silent,
 * never break the alert) and, for Instagram, sessionStorage. The critical path must hold: sign-in with the e-mail code
 * (surviving the reload these views do when the player comes back from the mail app), the map, the bottom sheet, a
 * dispatch, a major alert. Safe-area insets and the real dynamic toolbars can only be checked on a device (see the notes).
 */
trackProblems();

const UA = {
  tiktok: {
    android:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 trill_350104 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/35.1.4 ByteLocale/it Region/IT BytedanceWebview/d8a21c6',
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/it Region/IT isDarkMode/1 WKWebView/1 BytedanceWebview/d8a21c6',
  },
  instagram: {
    android:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; it_IT; 609396452)',
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,2; iOS 17_5; it_IT; it; scale=3.00; 1179x2556; 609396452)',
  },
} as const;

/** What the web view of `app` looks like to the page, installed before any script of the page runs. */
async function asInAppBrowser(
  page: Page,
  info: TestInfo,
  app: keyof typeof UA,
  opts: { blockSessionStorage?: boolean } = {},
): Promise<void> {
  const ios = info.project.name === 'iphone';
  await page.addInitScript(
    ({ userAgent, ios, blockSessionStorage }) => {
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => userAgent, configurable: true });
      // Pop-ups are swallowed by the host app.
      window.open = () => null;
      // No vibration API on iOS.
      if (ios) Reflect.deleteProperty(Navigator.prototype, 'vibrate');
      // Audio refused outright (the strictest autoplay policy): every cue must fail silently.
      const Refused = function () {
        throw new DOMException('Audio is not allowed in this web view', 'NotAllowedError');
      } as unknown as typeof AudioContext;
      window.AudioContext = Refused;
      (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = Refused;
      if (blockSessionStorage)
        Object.defineProperty(window, 'sessionStorage', {
          configurable: true,
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          },
        });
    },
    { userAgent: UA[app][ios ? 'ios' : 'android'], ios, blockSessionStorage: !!opts.blockSessionStorage },
  );
}

/** The page fits the view: the shell is exactly as tall as the viewport (dvh), nothing scrolls sideways. */
async function expectFitsTheView(page: Page): Promise<void> {
  const fit = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(fit.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(fit.width);
  expect(fit.scrollHeight, 'no page taller than the view').toBeLessThanOrEqual(fit.height + 1);
}

test.beforeEach(({ page }) => {
  test.skip(!isMobile(page), 'in-app browsers are phone web views');
});

test('TikTok: the e-mail code survives the reload after the mail app, and the new player gets in', async ({
  page,
}, info) => {
  await asInAppBrowser(page, info, 'tiktok');
  const email = `tiktok.${info.project.name}.${Date.now()}@example.com`;
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'Entra in centrale' })).toBeVisible();
  await expectFitsTheView(page);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Inviami il codice' }).click();
  await expect(page.getByRole('heading', { name: 'Controlla la posta' })).toBeVisible();

  // The player switches to the mail app; the web view reloads the page when they come back.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Controlla la posta' })).toBeVisible();
  await page.getByTestId('otp-0').click();
  await page.keyboard.type('123456');
  // A new player: the director's name and the two consents, then the start of the career.
  await expect(page.getByRole('heading', { name: 'Benvenuto, Direttore' })).toBeVisible();
  await page.getByLabel('Nome del Direttore').fill(`TT ${Date.now() % 100000}`);
  await page.getByRole('checkbox').nth(0).click();
  await page.getByRole('checkbox').nth(1).click();
  await page.getByRole('button', { name: 'Crea il mio account' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  // The pending code is forgotten once used: a later visit to /auth starts from the e-mail.
  expect(await page.evaluate(() => sessionStorage.getItem('rc-otp-pending'))).toBeNull();
});

test('Instagram without sessionStorage: sign-in still works, the map, the sheet and a dispatch hold', async ({
  page,
}, info) => {
  await asInAppBrowser(page, info, 'instagram', { blockSessionStorage: true });
  await test.step('the e-mail code sign-in works without sessionStorage (it is simply not kept)', async () => {
    await page.goto('/auth');
    await page.getByLabel('Email').fill(`insta.${info.project.name}.${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Inviami il codice' }).click();
    await expect(page.getByRole('heading', { name: 'Controlla la posta' })).toBeVisible();
    await page.getByTestId('otp-0').click();
    await page.keyboard.type('123456');
    await expect(page.getByRole('heading', { name: 'Benvenuto, Direttore' })).toBeVisible();
  });
  await bootCareer(page, info.project.name, { level: 5, credits: 5000 });
  await qa(page, 'quiet');
  await expectFitsTheView(page);
  await expect(page.getByTestId('map')).toHaveAttribute('data-ready', 'true');
  const id = await qa<string>(page, 'spawn', 'FIRE_TRASH_BIN', 2);
  const sheet = page.getByTestId('bottom-sheet');
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
  await expect(page.getByTestId('bottom-nav')).toBeInViewport({ ratio: 1 });
  await page.locator(`[data-testid="incident-card"][data-incident-id="${id}"]`).click();
  await expect(page.getByTestId('incident-inspector')).toBeVisible();
  await page.getByTestId('send-recommended').click();
  await expect(page.getByTestId('assigned-vehicle').first()).toBeVisible();
  await expectFitsTheView(page);

  // No "Add to Home Screen" inside another app: the settings say how to install instead.
  await goTo(page, 'Impostazioni', true);
  const install = page.getByTestId('install-app-setting');
  await expect(install.getByTestId('install-app-hint')).toHaveAttribute('data-mode', 'in-app');
  await expect(install.getByTestId('install-app-hint')).toContainText('Apri nel browser');
  await expect(install.getByRole('button', { name: 'Installa' })).toBeDisabled();
});

test('TikTok: a major incident alert without audio nor vibration — silent, never broken', async ({
  page,
}, info) => {
  await asInAppBrowser(page, info, 'tiktok');
  await bootCareer(page, info.project.name, { level: 8, credits: 5000 });
  await qa(page, 'quiet');
  // A first tap, as a player's: the audio unlock runs and meets the refused AudioContext.
  await page.getByTestId('sheet-handle').tap();
  await qa(page, 'addVehicles', 'FIRE_APS', 4);
  await qa(page, 'staffAll');
  await qa(page, 'startMajor', 'MAJ_RESIDENTIAL_FIRE', { targetVehicles: 6 });
  const alert = page.getByTestId('major-alert');
  await expect(alert).toBeVisible();
  await expect(page.getByTestId('major-alert-title')).toContainText('MAXI-EMERGENZA');
  await page.getByTestId('major-alert-open').click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId('major-inspector')).toBeVisible();
  // Nothing opened a window, nothing threw (trackProblems checks the page errors).
  expect(page.context().pages()).toHaveLength(1);
});
