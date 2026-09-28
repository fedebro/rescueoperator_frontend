import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { PushPayload } from '@/contracts';
import { AUTH, P256DH, SERVER_KEY } from '@/test/push-fakes';
import { SW_NAVIGATE_MESSAGE } from './sw-navigation';
import { WORKER_STATE_CACHE, WORKER_STATE_KEY } from './subscription';

/**
 * `public/sw.js` executed in a simulated service-worker global (node:vm): the real file, the real handlers, with the
 * browser's ServiceWorkerGlobalScope replaced by fakes we can observe.
 */
const SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
const ORIGIN = 'https://game.test';

/** What `showNotification` receives (NotificationOptions + the non-standard fields Chrome reads). */
type ShownOptions = NotificationOptions & {
  renotify?: boolean;
  timestamp?: number;
  data?: { url: string; category: string | null };
};

interface FakeClient {
  url: string;
  focused: boolean;
  visibilityState: 'visible' | 'hidden';
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

function client(
  path: string,
  patch: Partial<Pick<FakeClient, 'focused' | 'visibilityState'>> = {},
): FakeClient {
  const c: FakeClient = {
    url: `${ORIGIN}${path}`,
    focused: false,
    visibilityState: 'hidden',
    ...patch,
    focus: vi.fn(async () => c),
    postMessage: vi.fn(),
    navigate: vi.fn(async (url: string) => ({ ...c, url })),
  };
  return c;
}

function subscription(endpoint: string) {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array([4, 1, 2, 3]).buffer },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
  };
}

function loadWorker(
  opts: {
    windows?: FakeClient[];
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    caches?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const handlers = new Map<string, (event: unknown) => void>();
  const store = new Map<string, Map<string, string>>();
  for (const [name, entries] of Object.entries(opts.caches ?? {}))
    store.set(name, new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])));
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const cache = store.get(name)!;
      return {
        put: async (key: string, response: Response) => void cache.set(String(key), await response.text()),
        match: async (key: string) => (cache.has(key) ? new Response(cache.get(key)) : undefined),
        delete: async (key: string) => cache.delete(key),
        add: async () => undefined,
      };
    }),
    keys: vi.fn(async () => [...store.keys()]),
    delete: vi.fn(async (name: string) => store.delete(name)),
    match: vi.fn(async () => undefined),
  };
  const windows = opts.windows ?? [];
  const clients = {
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async (url: string) => ({ url })),
    claim: vi.fn(async () => undefined),
  };
  const registration = {
    showNotification: vi.fn(async (_title: string, _options: ShownOptions) => undefined),
    pushManager: {
      subscribe: vi.fn(async () => subscription('https://fcm.googleapis.com/fcm/send/renewed')),
    },
  };
  const fetchMock = vi.fn(opts.fetch ?? (async () => new Response('{}', { status: 200 })));
  const scope: Record<string, unknown> = {
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    registration,
    clients,
    caches,
    fetch: fetchMock,
    location: new URL(`${ORIGIN}/sw.js`),
    navigator: { userAgent: 'SwTest/1.0' },
    crypto: { randomUUID: () => 'idem-1' },
    skipWaiting: vi.fn(async () => undefined),
    URL,
    Response,
    Request,
    Headers,
    atob,
    btoa,
    console,
    setTimeout,
    clearTimeout,
  };
  scope.self = scope;
  vm.createContext(scope);
  vm.runInContext(SOURCE, scope, { filename: 'public/sw.js' });

  async function dispatch<T extends Record<string, unknown>>(type: string, init: T = {} as T) {
    const pending: Promise<unknown>[] = [];
    const event = { ...init, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no ${type} handler`);
    handler(event);
    await Promise.all(pending);
    return event;
  }
  const pushData = (payload: unknown) => ({
    json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
    text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  });
  /** The i-th notification shown. */
  const shown = (i = 0) => {
    const call = registration.showNotification.mock.calls[i];
    if (!call) throw new Error(`no notification #${i}`);
    return { title: call[0], options: call[1] };
  };
  return { dispatch, pushData, shown, registration, clients, fetchMock, store, caches, handlers };
}

const payload = (patch: Record<string, unknown> = {}) =>
  PushPayload.parse({
    v: 1,
    category: 'INCIDENT_NEW',
    title: '3 emergenze in attesa',
    body: 'La più grave: Incendio abitazione — Via Roma',
    tag: 'incident-new',
    url: '/game?focus=incident:inc_01J8Z0000000000000000000AA',
    renotify: true,
    requireInteraction: false,
    timestamp: 1_790_000_000_000,
    ...patch,
  });

describe('sw.js — push', () => {
  it('shows the notification of the payload with icon, monochrome badge, tag, renotify and the deep link', async () => {
    const sw = loadWorker();
    await sw.dispatch('push', { data: sw.pushData(payload()) });
    expect(sw.registration.showNotification).toHaveBeenCalledTimes(1);
    const { title, options } = sw.shown();
    expect(title).toBe('3 emergenze in attesa');
    expect(options).toMatchObject({
      body: 'La più grave: Incendio abitazione — Via Roma',
      icon: '/icons/app/icon-192.png',
      badge: '/icons/app/badge-96.png',
      tag: 'incident-new',
      renotify: true,
      requireInteraction: false,
      timestamp: 1_790_000_000_000,
      data: { url: '/game?focus=incident:inc_01J8Z0000000000000000000AA', category: 'INCIDENT_NEW' },
    });
  });

  it('keeps the start of a major on screen until touched (requireInteraction)', async () => {
    const sw = loadWorker();
    await sw.dispatch('push', {
      data: sw.pushData(payload({ category: 'MAJOR', tag: 'major-mjr', requireInteraction: true })),
    });
    expect(sw.shown().options.requireInteraction).toBe(true);
  });

  it('never sets renotify without a tag (Chrome would throw), and survives unreadable payloads', async () => {
    const sw = loadWorker();
    await sw.dispatch('push', { data: sw.pushData({ title: 'Senza tag', renotify: true, body: 'x' }) });
    const noTag = sw.shown().options;
    expect(noTag.tag).toBeUndefined();
    expect(noTag.renotify).toBe(false);

    await sw.dispatch('push', { data: sw.pushData('not json at all') });
    expect(sw.shown(1)).toMatchObject({
      title: 'Rescue Control',
      options: { body: 'not json at all', data: { url: '/game' } },
    });

    await sw.dispatch('push', { data: null });
    expect(sw.shown(2).title).toBe('Rescue Control');
  });

  it('only ever links inside the game (another origin falls back to /game)', async () => {
    const sw = loadWorker();
    await sw.dispatch('push', { data: sw.pushData(payload({ url: 'https://evil.example/phish' })) });
    expect(sw.shown().options.data?.url).toBe('/game');
  });

  it('accepts an ISO timestamp too', async () => {
    const sw = loadWorker();
    await sw.dispatch('push', {
      data: sw.pushData({ ...payload(), timestamp: '2026-09-28T10:00:00.000Z' }),
    });
    expect(sw.shown().options.timestamp).toBe(Date.parse('2026-09-28T10:00:00.000Z'));
  });
});

describe('sw.js — notificationclick', () => {
  const click = (url: string) => ({ notification: { data: { url }, close: vi.fn() } });
  const link = '/game?focus=vehicle:veh_01J8Z0000000000000000000AA';

  it('focuses the open game window and tells it where to go (client-side, no reload)', async () => {
    const other = client('/auth', { focused: true, visibilityState: 'visible' });
    const game = client('/game/fleet');
    const sw = loadWorker({ windows: [other, game] });
    const event = await sw.dispatch('notificationclick', click(link));
    expect(event.notification.close).toHaveBeenCalled();
    expect(game.focus).toHaveBeenCalled();
    expect(game.postMessage).toHaveBeenCalledWith({ type: SW_NAVIGATE_MESSAGE, url: link });
    expect(other.focus).not.toHaveBeenCalled();
    expect(sw.clients.openWindow).not.toHaveBeenCalled();
  });

  it('prefers the focused / visible game window among several', async () => {
    const background = client('/game');
    const front = client('/game', { focused: true, visibilityState: 'visible' });
    const sw = loadWorker({ windows: [background, front] });
    await sw.dispatch('notificationclick', click(link));
    expect(front.postMessage).toHaveBeenCalled();
    expect(background.postMessage).not.toHaveBeenCalled();
  });

  it('navigates another page of the site, or opens a new window when none is open', async () => {
    const auth = client('/auth');
    const sw = loadWorker({ windows: [auth] });
    await sw.dispatch('notificationclick', click(link));
    expect(auth.navigate).toHaveBeenCalledWith(`${ORIGIN}${link}`);

    const empty = loadWorker({ windows: [] });
    await empty.dispatch('notificationclick', click(link));
    expect(empty.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}${link}`);
  });

  it('opens a window when the page cannot be navigated (not controlled by this worker)', async () => {
    const uncontrolled = client('/auth');
    uncontrolled.navigate.mockRejectedValueOnce(new TypeError('not controlled'));
    const sw = loadWorker({ windows: [uncontrolled] });
    await sw.dispatch('notificationclick', click(link));
    expect(sw.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}${link}`);
  });

  it('a foreign or missing link opens the game home', async () => {
    const sw = loadWorker({ windows: [] });
    await sw.dispatch('notificationclick', click('https://evil.example/x'));
    await sw.dispatch('notificationclick', { notification: { data: null, close: vi.fn() } });
    expect(sw.clients.openWindow.mock.calls).toEqual([[`${ORIGIN}/game`], [`${ORIGIN}/game`]]);
  });
});

describe('sw.js — pushsubscriptionchange', () => {
  const state = {
    apiBase: 'https://api.test/api/v1',
    careerId: 'car_01J8Z0000000000000000000AA',
    vapidPublicKey: SERVER_KEY,
    platform: 'PWA',
    endpoint: 'https://fcm.googleapis.com/fcm/send/old',
  };
  const api = (refreshStatus = 200) =>
    vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh'))
        return new Response(JSON.stringify({ data: { accessToken: 'fresh-token' } }), {
          status: refreshStatus,
        });
      if (url.endsWith('/push/subscriptions'))
        return new Response(JSON.stringify({ data: { id: 'psb_x' } }), { status: 201 });
      return new Response('{}', { status: 404 });
    });

  it('re-subscribes with the server key, registers the new endpoint and drops the old one', async () => {
    const fetch = api();
    const sw = loadWorker({ fetch, caches: { [WORKER_STATE_CACHE]: { [WORKER_STATE_KEY]: state } } });
    await sw.dispatch('pushsubscriptionchange', {
      oldSubscription: subscription(state.endpoint),
      newSubscription: null,
    });
    expect(sw.registration.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe('https://api.test/api/v1/auth/refresh');
    expect(calls[0]![1]).toMatchObject({ method: 'POST', credentials: 'include' });
    const [postUrl, post] = calls[1]!;
    expect(postUrl).toBe('https://api.test/api/v1/careers/car_01J8Z0000000000000000000AA/push/subscriptions');
    expect(post.method).toBe('POST');
    expect(post.headers).toMatchObject({ Authorization: 'Bearer fresh-token', 'Idempotency-Key': 'idem-1' });
    expect(JSON.parse(String(post.body))).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/renewed',
      keys: { p256dh: P256DH, auth: AUTH },
      expirationTime: null,
      platform: 'PWA',
      userAgent: 'SwTest/1.0',
    });
    const [deleteUrl, del] = calls[2]!;
    expect(deleteUrl).toBe(postUrl);
    expect(del.method).toBe('DELETE');
    expect(JSON.parse(String(del.body))).toEqual({ endpoint: state.endpoint });
    const saved = JSON.parse(sw.store.get(WORKER_STATE_CACHE)!.get(WORKER_STATE_KEY)!) as typeof state;
    expect(saved.endpoint).toBe('https://fcm.googleapis.com/fcm/send/renewed');
  });

  it('uses the new subscription the browser already made, when it hands one over', async () => {
    const fetch = api();
    const sw = loadWorker({ fetch, caches: { [WORKER_STATE_CACHE]: { [WORKER_STATE_KEY]: state } } });
    await sw.dispatch('pushsubscriptionchange', {
      oldSubscription: null,
      newSubscription: subscription('https://fcm.googleapis.com/fcm/send/given'),
    });
    expect(sw.registration.pushManager.subscribe).not.toHaveBeenCalled();
    const body = JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as {
      endpoint: string;
    };
    expect(body.endpoint).toBe('https://fcm.googleapis.com/fcm/send/given');
    expect(fetch).toHaveBeenCalledTimes(2); // no old endpoint to drop
  });

  it('signed out (refresh refused) or never set up: leaves it to the game’s next start', async () => {
    const refused = api(401);
    const sw = loadWorker({
      fetch: refused,
      caches: { [WORKER_STATE_CACHE]: { [WORKER_STATE_KEY]: state } },
    });
    await sw.dispatch('pushsubscriptionchange', { oldSubscription: subscription(state.endpoint) });
    expect(refused).toHaveBeenCalledTimes(1);

    const fetch = api();
    const blank = loadWorker({ fetch });
    await blank.dispatch('pushsubscriptionchange', { oldSubscription: subscription(state.endpoint) });
    expect(fetch).not.toHaveBeenCalled();
    expect(blank.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('sw.js — lifecycle', () => {
  it('a new version drops the old caches but keeps what the push flow stored', async () => {
    const sw = loadWorker({
      caches: {
        'rc-sw-v1-shell': {},
        'rc-sw-v1-static': {},
        'rc-sw-v2-static': {},
        [WORKER_STATE_CACHE]: { [WORKER_STATE_KEY]: { careerId: 'x' } },
      },
    });
    await sw.dispatch('activate');
    expect(sw.caches.delete.mock.calls.map((c) => c[0]).sort()).toEqual([
      'rc-sw-v1-shell',
      'rc-sw-v1-static',
    ]);
    expect(sw.store.has(WORKER_STATE_CACHE)).toBe(true);
    expect(sw.clients.claim).toHaveBeenCalled();
  });

  it('still never touches API calls, the MSW worker or other origins', () => {
    expect(SOURCE).toContain("'/mockServiceWorker.js'");
    expect(SOURCE).toContain("'/api/'");
    expect(SOURCE).toContain('url.origin !== self.location.origin');
    expect(SOURCE).toMatch(/const VERSION = 'rc-sw-v\d+'/);
  });
});
