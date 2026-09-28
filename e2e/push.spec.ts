import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { bootCareer, goTo, isMobile, qa, trackProblems } from './helpers';

/**
 * Web push, client side (D-97…D-99): the once-per-release permission sheet, Settings → "Notifiche push", sign-out,
 * presence and the deep links a notification opens. The mock backend implements every push route; what it cannot do is
 * deliver a push — and headless Chromium can neither show a permission prompt nor create a push subscription (there is
 * no push service), and it reports the permission as "denied". So each context gets `fakePush`: a `Notification`
 * permission the test controls and a `PushManager` that hands out subscriptions shaped like real ones. The service
 * worker's own handlers are covered by src/features/push/sw.test.ts and, on a production build, by e2e-real/push.spec.ts.
 */

trackProblems();
test.describe.configure({ timeout: 180_000 });

/** The sheet opens 5 s into a session (then at a calm moment): a negative check waits comfortably past that. */
const PAST_THE_DELAY_MS = 8000;

interface FakePushState {
  permission: NotificationPermission;
  answer: NotificationPermission;
  subscription: { endpoint: string } | null;
  requests: number;
}

/** Installs the fake permission + PushManager in every page of the context (state kept across reloads). */
async function fakePush(
  context: BrowserContext,
  init: { permission: NotificationPermission; answer?: NotificationPermission },
): Promise<void> {
  await context.addInitScript(
    ({ permission, answer }) => {
      const KEY = '__pushFake';
      const P256DH =
        'BDjl9XCbXSiz0K1Rjn4FOWKXj91QpQu-qX558oUWva01BwByVN5yuOeGg9misRBTqtAfXa7bmDQrpV1RJxHb3lk';
      const AUTH = 'UE93ShGK4TBATgCzSBaWUA';
      let saved: FakePushState | null = null;
      try {
        saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as FakePushState | null;
      } catch {
        saved = null;
      }
      const state: FakePushState & { key?: string } = saved ?? {
        permission,
        answer,
        subscription: null,
        requests: 0,
      };
      const save = () => localStorage.setItem(KEY, JSON.stringify(state));
      save();
      const toBytes = (b64: string) =>
        Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const toB64 = (buffer: ArrayBuffer | ArrayBufferView) => {
        const bytes =
          buffer instanceof ArrayBuffer
            ? new Uint8Array(buffer)
            : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        return btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      };
      const make = () => {
        const current = state.subscription;
        if (!current) return null;
        return {
          endpoint: current.endpoint,
          expirationTime: null,
          options: {
            userVisibleOnly: true,
            applicationServerKey: state.key ? toBytes(state.key).buffer : null,
          },
          getKey: (name: string) => toBytes(name === 'p256dh' ? P256DH : AUTH).buffer,
          toJSON: () => ({
            endpoint: current.endpoint,
            expirationTime: null,
            keys: { p256dh: P256DH, auth: AUTH },
          }),
          unsubscribe: async () => {
            state.subscription = null;
            save();
            return true;
          },
        };
      };
      if (typeof Notification !== 'undefined') {
        Object.defineProperty(Notification, 'permission', {
          configurable: true,
          get: () => state.permission,
        });
        Notification.requestPermission = (async (callback?: (p: NotificationPermission) => void) => {
          state.requests += 1;
          state.permission = state.answer;
          save();
          callback?.(state.permission);
          return state.permission;
        }) as typeof Notification.requestPermission;
      }
      if (typeof PushManager !== 'undefined') {
        PushManager.prototype.getSubscription = async function () {
          return make() as unknown as PushSubscription;
        };
        PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
          if (state.permission !== 'granted')
            throw new DOMException('Registration failed', 'NotAllowedError');
          state.key = toB64(options!.applicationServerKey as ArrayBuffer);
          state.subscription = {
            endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`,
          };
          save();
          return make() as unknown as PushSubscription;
        };
      }
    },
    { permission: init.permission, answer: init.answer ?? 'granted' },
  );
}

const fakeState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('__pushFake') ?? 'null') as FakePushState);

interface MockSubscription {
  endpoint: string;
  platform: string;
  keys: { p256dh: string; auth: string };
}
const subscriptions = (page: Page) => qa<MockSubscription[]>(page, 'pushSubscriptions');
/** Every push subscription the mock backend holds, whatever the session (after a sign-out there is none). */
const allSubscriptions = (page: Page) =>
  page.evaluate(() =>
    Object.values(
      (
        window as unknown as {
          __rcMock: { state: { careers: Record<string, { ext: { push?: { subscriptions: unknown[] } } }> } };
        }
      ).__rcMock.state.careers,
    ).flatMap((c) => c.ext.push?.subscriptions ?? []),
  );

const sheet = (page: Page) => page.getByTestId('push-prompt');

test.describe('the permission sheet (once per release, never during the tutorial)', () => {
  test('after the tutorial: "Attiva notifiche" asks the browser and registers this device', async ({
    page,
    context,
  }, info) => {
    await fakePush(context, { permission: 'default', answer: 'granted' });
    await bootCareer(page, info.project.name, { tutorialDone: false, pushPrompt: true });

    await test.step('nothing during the tutorial', async () => {
      await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'WELCOME');
      await page.waitForTimeout(PAST_THE_DELAY_MS);
      await expect(sheet(page)).toHaveCount(0);
    });

    await test.step('the tutorial ends → the sheet, a few seconds later', async () => {
      await page.getByTestId('tutorial-skip').click();
      await expect(page.getByTestId('tutorial')).toHaveCount(0);
      const dialog = page.getByRole('dialog', { name: 'Non perdere nessuna emergenza' });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expect(dialog).toHaveAttribute('data-variant', 'ask');
      await expect(
        dialog.getByText('Nuove chiamate ed emergenze che stanno per scadere senza mezzi'),
      ).toBeVisible();
      await expect(dialog.getByText('Interventi conclusi, con l’esito e i Crediti guadagnati')).toBeVisible();
      await dialog.getByTestId('push-prompt-enable').click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByTestId('toast').filter({ hasText: 'Notifiche attive su questo dispositivo' }),
      ).toBeVisible();
    });

    await test.step('the device is registered: the browser prompt ran once, the server has the subscription', async () => {
      expect((await fakeState(page)).requests).toBe(1);
      await expect.poll(async () => (await subscriptions(page)).length).toBe(1);
      const [subscription] = await subscriptions(page);
      expect(subscription!.platform).toBe('BROWSER');
      expect(subscription!.endpoint).toBe((await fakeState(page)).subscription!.endpoint);
      expect(subscription!.keys.auth).toHaveLength(22);
    });

    await test.step('granted: never asked again (not even at the next release)', async () => {
      await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('rc-push') ?? '{}') as {
          state: Record<string, unknown>;
        };
        saved.state.promptedRelease = 'an-older-release';
        localStorage.setItem('rc-push', JSON.stringify(saved));
      });
      await page.reload();
      await expect(page.getByTestId('topbar')).toBeVisible();
      await page.waitForTimeout(PAST_THE_DELAY_MS);
      await expect(sheet(page)).toHaveCount(0);
      expect(await subscriptions(page)).toHaveLength(1);
    });
  });

  test('"Non ora": not again in this release, asked again at the next one', async ({
    page,
    context,
  }, info) => {
    await fakePush(context, { permission: 'default' });
    await bootCareer(page, info.project.name, { pushPrompt: true });
    await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
    await sheet(page).getByTestId('push-prompt-later').click();
    await expect(sheet(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('topbar')).toBeVisible();
    await page.waitForTimeout(PAST_THE_DELAY_MS);
    await expect(sheet(page)).toHaveCount(0);

    // The next deploy: this device last saw the sheet in an older release.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('rc-push') ?? '{}') as { state: Record<string, unknown> };
      saved.state.promptedRelease = 'an-older-release';
      localStorage.setItem('rc-push', JSON.stringify(saved));
    });
    await page.reload();
    await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
    await expect(sheet(page)).toHaveAttribute('data-variant', 'ask');
    expect((await fakeState(page)).requests).toBe(0);
    expect(await subscriptions(page)).toHaveLength(0);
  });

  test('blocked in the browser: once per release, how to allow them again', async ({
    page,
    context,
  }, info) => {
    await fakePush(context, { permission: 'denied' });
    await bootCareer(page, info.project.name, { pushPrompt: true });
    const card = page.getByRole('dialog', { name: 'Notifiche bloccate' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId('push-denied-help')).toContainText('Notifiche → Consenti');
    await expect(card.getByTestId('push-prompt-enable')).toHaveCount(0);
    await card.getByRole('button', { name: 'Ho capito' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('topbar')).toBeVisible();
    await page.waitForTimeout(PAST_THE_DELAY_MS);
    await expect(sheet(page)).toHaveCount(0);

    // Settings says the same, and the switch cannot fight the browser.
    await goTo(page, 'Impostazioni', true);
    const settings = page.getByTestId('push-settings');
    await expect(settings).toHaveAttribute('data-status', 'denied');
    await expect(settings.getByTestId('push-device-toggle')).toBeDisabled();
    await expect(settings.getByTestId('push-denied-help')).toBeVisible();
  });
});

test('iPhone Safari: the sheet explains the Home Screen app (web push lives there)', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'one iOS user agent run is enough');
  const context = await browser.newContext({
    ...devices['iPhone 14'],
    // Web push arrived with iOS 16.4 (the descriptor says 16.0, where the game rightly stays silent).
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  });
  const page = await context.newPage();
  await page.route(/tiles\.openfreemap\.org/, (route) => route.abort());
  try {
    await bootCareer(page, info.project.name, { pushPrompt: true });
    const card = page.getByRole('dialog', { name: 'Notifiche su iPhone e iPad' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId('ios-install-steps').getByRole('listitem')).toHaveCount(4);
    await expect(card).toContainText('Aggiungi alla schermata Home');
    await card.getByRole('button', { name: 'Ho capito' }).click();
    await expect(card).toHaveCount(0);

    await goTo(page, 'Impostazioni', true);
    const settings = page.getByTestId('push-settings');
    await expect(settings).toHaveAttribute('data-status', 'ios-install');
    await settings.getByTestId('push-ios-install').click();
    await expect(page.getByRole('dialog', { name: 'Installa su iPhone e iPad' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Settings: already allowed → subscribed silently; test push, categories, quiet hours, off on this device', async ({
  page,
  context,
}, info) => {
  await fakePush(context, { permission: 'granted' });
  await bootCareer(page, info.project.name);
  // No sheet at all: the device registers itself.
  await expect.poll(async () => (await subscriptions(page)).length, { timeout: 20_000 }).toBe(1);
  await expect(sheet(page)).toHaveCount(0);

  await goTo(page, 'Impostazioni', true);
  const card = page.getByTestId('push-settings');
  await expect(card).toHaveAttribute('data-status', 'on', { timeout: 20_000 });
  await expect(card.getByTestId('push-status')).toHaveText('Attive');

  await test.step('a test push', async () => {
    await card.getByTestId('push-test').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Notifica di prova inviata' })).toBeVisible();
    expect(await qa<{ sent: number }[]>(page, 'pushTests')).toEqual([expect.objectContaining({ sent: 1 })]);
  });

  await test.step('categories (account-wide), saved on the server', async () => {
    const economy = card.getByTestId('push-category-toggle-ECONOMY');
    await expect(economy).toHaveAttribute('aria-checked', 'false');
    await expect(card.getByTestId('push-category-toggle-INCIDENT_NEW')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await economy.click();
    await expect(economy).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(async () => {
        const prefs = await qa<{ categories: { code: string; enabled: boolean }[] }>(page, 'pushPreferences');
        return prefs.categories.find((c) => c.code === 'ECONOMY')?.enabled;
      })
      .toBe(true);
  });

  await test.step('quiet hours in the device time zone', async () => {
    await card.getByTestId('push-quiet-toggle').click();
    await card.getByTestId('push-quiet-start').fill('22:30');
    await card.getByTestId('push-quiet-end').fill('06:45');
    await card.getByTestId('push-quiet-end').blur();
    await expect(card.getByTestId('push-quiet-zone')).toContainText('Europe/Rome');
    await expect
      .poll(async () => (await qa<{ quietHours: unknown }>(page, 'pushPreferences')).quietHours)
      .toEqual({ enabled: true, start: '22:30', end: '06:45', timeZone: 'Europe/Rome' });
  });

  await test.step('off on this device: the server forgets it and a reload does not re-subscribe', async () => {
    await card.getByTestId('push-device-toggle').click();
    await expect(card).toHaveAttribute('data-status', 'off');
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Notifiche disattivate su questo dispositivo' }),
    ).toBeVisible();
    await expect.poll(async () => (await subscriptions(page)).length).toBe(0);
    expect((await fakeState(page)).subscription).toBeNull();
    await page.reload();
    await expect(page.getByTestId('push-settings')).toHaveAttribute('data-status', 'off', {
      timeout: 20_000,
    });
    await page.waitForTimeout(3000);
    expect(await subscriptions(page)).toHaveLength(0);
  });

  await test.step('and back on from the same switch', async () => {
    await page.getByTestId('push-device-toggle').click();
    await expect(page.getByTestId('push-settings')).toHaveAttribute('data-status', 'on');
    await expect.poll(async () => (await subscriptions(page)).length).toBe(1);
  });
});

test('sign-out takes this device’s subscription with it', async ({ page, context }, info) => {
  await fakePush(context, { permission: 'granted' });
  await bootCareer(page, info.project.name);
  await expect.poll(async () => (await subscriptions(page)).length, { timeout: 20_000 }).toBe(1);
  await goTo(page, 'Impostazioni', true);
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect.poll(async () => (await allSubscriptions(page)).length).toBe(0);
  await expect.poll(async () => (await fakeState(page)).subscription).toBeNull();
});

test('presence: the game tells the server whether it is on screen', async ({ page }, info) => {
  await bootCareer(page, info.project.name);
  const presence = () => qa<{ visible: boolean; reports: number }>(page, 'pushPresence');
  await expect.poll(async () => (await presence()).visible).toBe(true);
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  await expect.poll(async () => (await presence()).visible).toBe(false);
  await setVisibility('visible');
  await expect.poll(async () => (await presence()).visible).toBe(true);
});

test.describe('deep links (what a notification opens)', () => {
  test('incident, vehicle and facility open their inspector; the URL is cleaned', async ({ page }, info) => {
    await bootCareer(page, info.project.name, { credits: 20_000 });
    await qa(page, 'quiet');
    const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 4);
    const career = await qa<{ vehicles: { id: string }[]; facilities: { id: string }[] }>(page, 'career');

    await page.goto(`/game?focus=incident:${incidentId}`);
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
    await expect(page).toHaveURL(/\/game$/);
    if (isMobile(page)) await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-snap', 'half');

    await page.goto(`/game?focus=vehicle:${career.vehicles[0]!.id}`);
    await expect(page.getByTestId('vehicle-inspector')).toBeVisible();
    await expect(page).toHaveURL(/\/game$/);

    await page.goto(`/game?focus=facility:${career.facilities[0]!.id}`);
    await expect(page.getByTestId('facility-inspector')).toBeVisible();
    await expect(page).toHaveURL(/\/game$/);

    // An incident that is already over: nothing to select, a short notice instead.
    await page.goto('/game?focus=incident:inc_01J8Z0000000000000000000ZZ');
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Questa emergenza si è già conclusa.' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/game$/);
  });

  test('a notification clicked while the game is open: the service worker’s message navigates in place', async ({
    page,
  }, info) => {
    await bootCareer(page, info.project.name);
    await qa(page, 'quiet');
    const incidentId = await qa<string>(page, 'spawn', 'MED_FALL', 4);
    await goTo(page, 'Flotta');
    await expect(page).toHaveURL(/\/game\/fleet$/);
    // What public/sw.js posts to the focused game window (`rc:navigate`); no reload of the game.
    await page.evaluate((id) => {
      (window as unknown as { __marker: boolean }).__marker = true;
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'rc:navigate', url: `/game?focus=incident:${id}` } }),
      );
    }, incidentId);
    await expect(page.getByTestId('incident-inspector')).toHaveAttribute('data-incident-id', incidentId);
    await expect(page).toHaveURL(/\/game$/);
    expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(true);
    // A message pointing elsewhere is ignored.
    await page.evaluate(() =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'rc:navigate', url: 'https://evil.example/' } }),
      ),
    );
    await expect(page).toHaveURL(/\/game$/);
  });

  test('a major incident opens its coordination view', async ({ page }, info) => {
    await bootCareer(page, info.project.name, { level: 9, credits: 20_000 });
    await qa(page, 'quiet');
    await page.addLocatorHandler(page.getByTestId('family-unlock'), async () => {
      await page.getByTestId('family-unlock').getByRole('button', { name: 'Più tardi' }).click();
    });
    const started = await qa<{ majorId: string }>(page, 'startMajor', 'MAJ_RESIDENTIAL_FIRE', {
      targetVehicles: 12,
    });
    await page.getByTestId('major-alert-close').click();
    await expect(page.getByTestId('major-alert')).toHaveCount(0);
    await page.goto(`/game?focus=major:${started.majorId}`);
    await expect(page.getByTestId('major-inspector').last()).toBeVisible();
    await expect(page).toHaveURL(/\/game$/);
  });
});
