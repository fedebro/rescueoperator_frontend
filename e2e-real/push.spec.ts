import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { PushPayload } from '../src/contracts/push';
import { trackProblems } from './helpers';

/**
 * Web push on a PRODUCTION build with the real service worker (`/sw.js`, registered because this suite builds with
 * NEXT_PUBLIC_API_MOCK=0). No push service can be reached from a test, so the Chrome DevTools protocol plays its part:
 * `ServiceWorker.deliverPushMessage` hands the worker the decrypted payload exactly as the browser does once the push
 * service delivered it, and `registration.getNotifications()` reads back what the worker showed.
 *
 * Runs in the full Chromium in new headless mode (`channel: 'chromium'`): the default headless shell has no notification
 * platform (its permission always reads "denied" and nothing is ever shown).
 */
test.use({ channel: 'chromium' });
trackProblems();

interface Shown {
  title: string;
  body: string;
  tag: string;
  icon: string;
  badge: string;
  data: unknown;
}

const shown = (page: Page) =>
  page.evaluate(async () =>
    (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
      title: n.title,
      body: n.body,
      tag: n.tag,
      icon: n.icon,
      badge: n.badge,
      data: n.data as unknown,
    })),
  ) as Promise<Shown[]>;

/** The id DevTools gives the page's root-scope registration. */
function registrationIdOf(cdp: CDPSession, origin: string): Promise<string> {
  return new Promise((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const found = registrations.find((r) => r.scopeURL === `${origin}/` && !r.isDeleted);
      if (found) resolve(found.registrationId);
    });
    void cdp.send('ServiceWorker.enable');
  });
}

test('the production service worker shows each push: icon, monochrome badge, tag, deep link', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'real-desktop', 'the service worker is the same in both layouts');
  const origin = new URL(baseURL!).origin;
  await context.grantPermissions(['notifications'], { origin });
  await page.goto('/auth');

  await test.step('the app worker (not MSW) controls the page', async () => {
    const script = await page.evaluate(
      async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null,
    );
    expect(script).toBe(`${origin}/sw.js`);
    expect((await page.request.get('/icons/app/badge-96.png')).ok()).toBe(true);
  });

  const cdp = await context.newCDPSession(page);
  const registrationId = await registrationIdOf(cdp, origin);
  const deliver = (payload: unknown) =>
    cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId,
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  const payload = PushPayload.parse({
    v: 1,
    category: 'INCIDENT_NEW',
    title: '3 emergenze in attesa',
    body: 'La più grave: Incendio abitazione — Via Roma',
    tag: 'incident-new',
    url: '/game?focus=incident:inc_01J8Z0000000000000000000AA',
    renotify: true,
    timestamp: Date.now(),
  });

  await test.step('a push → one notification, as the payload says', async () => {
    await deliver(payload);
    await expect
      .poll(() => shown(page))
      .toEqual([
        {
          title: '3 emergenze in attesa',
          body: 'La più grave: Incendio abitazione — Via Roma',
          tag: 'incident-new',
          icon: `${origin}/icons/app/icon-192.png`,
          badge: `${origin}/icons/app/badge-96.png`,
          data: { url: '/game?focus=incident:inc_01J8Z0000000000000000000AA', category: 'INCIDENT_NEW' },
        },
      ]);
  });

  await test.step('the same tag updates it instead of stacking a second one', async () => {
    await deliver({ ...payload, title: '4 emergenze in attesa', timestamp: Date.now() });
    await expect.poll(async () => (await shown(page)).map((n) => n.title)).toEqual(['4 emergenze in attesa']);
  });

  await test.step('another category is another notification; a foreign link is never kept', async () => {
    await deliver({
      ...payload,
      category: 'INCIDENT_CLOSED',
      tag: 'incident-closed',
      title: '2 interventi conclusi',
      body: '+340 Crediti',
      url: 'https://evil.example/phish',
    });
    await expect.poll(async () => (await shown(page)).length).toBe(2);
    const closed = (await shown(page)).find((n) => n.tag === 'incident-closed');
    expect(closed?.data).toEqual({ url: '/game', category: 'INCIDENT_CLOSED' });
  });

  await test.step('an unreadable payload still shows a notification (every push must)', async () => {
    await deliver('not json');
    await expect.poll(async () => (await shown(page)).some((n) => n.body === 'not json')).toBe(true);
  });
});
