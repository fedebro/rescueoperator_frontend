/*
 * Rescue Control service worker — offline shell + static asset cache + web push. Deliberately small:
 *  - navigations: network first; when the network fails the precached /offline page is served;
 *  - static assets (hashed Next.js build files, fonts, icons, brand): cache first;
 *  - EVERYTHING else is left to the browser: API calls (any origin), realtime, map tiles, the manifest,
 *    and the MSW worker are never cached nor intercepted. Game state is server-authoritative.
 *  - web push (D-97…D-99): `push` shows the notification of the payload (`PushPayload`, contracts/push.ts);
 *    `notificationclick` brings a game window to the front on the right incident / major / vehicle / facility (or opens
 *    one); `pushsubscriptionchange` renews a subscription the push service rotated and tells the server.
 * Registered only in production builds that use a real API (see src/features/platform/pwa.ts).
 */
const VERSION = 'rc-sw-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline';
const NOTIFICATION_ICON = '/icons/app/icon-192.png';
/** Monochrome (alpha-only) glyph for the Android status bar. */
const NOTIFICATION_BADGE = '/icons/app/badge-96.png';
const PRECACHE = [
  '/brand/logo-stacked.svg',
  '/brand/logo-horizontal.svg',
  '/favicon.svg',
  NOTIFICATION_ICON,
  '/icons/app/icon-512.png',
  NOTIFICATION_BADGE,
];
const STATIC_PREFIXES = ['/_next/static/', '/icons/', '/brand/'];
const STATIC_FILES = ['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png'];
const NEVER = ['/mockServiceWorker.js', '/sw.js', '/api/', '/manifest.webmanifest'];
/** Where a notification without a (valid) link leads. */
const GAME_HOME = '/game';
/** Message a focused game window receives to open a link client-side (src/features/push/sw-navigation.tsx). */
const NAVIGATE_MESSAGE = 'rc:navigate';
/**
 * What the page stored for `pushsubscriptionchange` (src/features/push/subscription.ts, same names): the API base, the
 * career, the server key and the platform. Kept across versions (not a `${VERSION}-*` cache).
 */
const PUSH_STATE_CACHE = 'rc-push-state';
const PUSH_STATE_KEY = '/__rc/push-state';

const isStatic = (url) =>
  STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) || STATIC_FILES.includes(url.pathname);
const isExcluded = (url) => NEVER.some((p) => url.pathname === p || url.pathname.startsWith(p));

async function precacheOfflineShell() {
  const shell = await caches.open(SHELL_CACHE);
  const response = await fetch(OFFLINE_URL, { cache: 'reload', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`offline shell: ${response.status}`);
  const html = await response.clone().text();
  await shell.put(OFFLINE_URL, response);
  // The page must render without the network: cache the build assets (CSS, fonts, chunks) its HTML links.
  const assets = new Set(PRECACHE);
  for (const match of html.matchAll(/["'(](\/_next\/static\/[^"')\s\\]+)/g)) assets.add(match[1]);
  const statics = await caches.open(STATIC_CACHE);
  await Promise.all(
    [...assets].map((asset) =>
      statics.add(asset).catch(() => undefined /* a missing optional asset must not fail the install */),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheOfflineShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION) && k !== PUSH_STATE_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isExcluded(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? Response.error();
      }),
    );
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

/* ───────────────────────────── web push ───────────────────────────── */

/** A same-origin in-app path (`/game?focus=incident:inc_…`); anything else falls back to the game. */
function gamePath(raw) {
  try {
    const url = new URL(typeof raw === 'string' && raw ? raw : GAME_HOME, self.location.origin);
    if (url.origin !== self.location.origin) return GAME_HOME;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return GAME_HOME;
  }
}

function eventTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Title + options of the notification for one push. Tolerant on purpose: a payload that cannot be read still shows a
 * notification (every push must show one — `userVisibleOnly`), never a crash.
 */
function notificationFor(data) {
  let payload = {};
  if (data) {
    try {
      payload = data.json();
    } catch {
      try {
        payload = { body: data.text() };
      } catch {
        payload = {};
      }
    }
  }
  if (!payload || typeof payload !== 'object') payload = {};
  const tag = typeof payload.tag === 'string' && payload.tag ? payload.tag : undefined;
  return {
    title: typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Rescue Control',
    options: {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag,
      // A newer push with the same tag replaces the older one; `renotify` makes it alert again (needs a tag).
      renotify: Boolean(tag && payload.renotify === true),
      requireInteraction: payload.requireInteraction === true,
      timestamp: eventTime(payload.timestamp),
      data: {
        url: gamePath(payload.url),
        category: typeof payload.category === 'string' ? payload.category : null,
      },
    },
  };
}

self.addEventListener('push', (event) => {
  const { title, options } = notificationFor(event.data);
  event.waitUntil(self.registration.showNotification(title, options));
});

const sameOrigin = (href) => {
  try {
    return new URL(href).origin === self.location.origin;
  } catch {
    return false;
  }
};
const isGameWindow = (client) => {
  try {
    return new URL(client.url).pathname.startsWith(GAME_HOME);
  } catch {
    return false;
  }
};

/**
 * Brings the game to the front on `path`: an open game window is focused and told to navigate (client-side — the
 * game keeps its state); another page of the site is navigated; with no window at all, a new one opens.
 */
async function openFromNotification(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((c) =>
    sameOrigin(c.url),
  );
  const rank = (c) => (isGameWindow(c) ? 4 : 0) + (c.focused ? 2 : 0) + (c.visibilityState === 'visible' ? 1 : 0);
  const client = windows.sort((a, b) => rank(b) - rank(a))[0];
  if (!client) return self.clients.openWindow(target);
  let focused = client;
  try {
    focused = (await client.focus()) || client;
  } catch {
    /* focusing can be refused: the navigation below still happens */
  }
  if (isGameWindow(focused)) {
    focused.postMessage({ type: NAVIGATE_MESSAGE, url: path });
    return focused;
  }
  if (typeof focused.navigate === 'function') {
    try {
      return await focused.navigate(target);
    } catch {
      /* a window this worker does not control cannot be navigated */
    }
  }
  return self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openFromNotification(gamePath(data.url)));
});

async function readPushState() {
  try {
    const cache = await caches.open(PUSH_STATE_CACHE);
    const response = await cache.match(PUSH_STATE_KEY);
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

async function writePushState(state) {
  try {
    const cache = await caches.open(PUSH_STATE_CACHE);
    await cache.put(
      PUSH_STATE_KEY,
      new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch {
    /* the game re-sends the subscription at its next start anyway */
  }
}

function urlBase64ToBytes(value) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const newRequestId = () =>
  self.crypto && typeof self.crypto.randomUUID === 'function'
    ? self.crypto.randomUUID()
    : `sw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** A fresh access token from the refresh cookie (the same call the page makes); null when signed out or offline. */
async function accessToken(apiBase) {
  try {
    const response = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body && body.data && typeof body.data.accessToken === 'string' ? body.data.accessToken : null;
  } catch {
    return null;
  }
}

/**
 * The push service replaced (or expired) the subscription: subscribe again with the server's key and register the new
 * endpoint for the career, dropping the old one. Any failure is left to the game, which re-sends its subscription at
 * the next start (upsert by endpoint).
 */
async function renewSubscription(event) {
  const state = await readPushState();
  if (!state || !state.apiBase || !state.careerId) return;
  const old = event.oldSubscription || null;
  let subscription = event.newSubscription || null;
  if (!subscription) {
    const key =
      (old && old.options && old.options.applicationServerKey) ||
      (state.vapidPublicKey ? urlBase64ToBytes(state.vapidPublicKey) : null);
    if (!key) return;
    subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  const token = await accessToken(state.apiBase);
  if (!token) return;
  const json = subscription.toJSON();
  const url = `${state.apiBase}/careers/${encodeURIComponent(state.careerId)}/push/subscriptions`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { ...headers, 'Idempotency-Key': newRequestId() },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      expirationTime: typeof json.expirationTime === 'number' ? json.expirationTime : null,
      platform: state.platform === 'PWA' ? 'PWA' : 'BROWSER',
      userAgent: String((self.navigator && self.navigator.userAgent) || '').slice(0, 255),
    }),
  });
  if (!response.ok) return;
  if (old && old.endpoint && old.endpoint !== json.endpoint)
    await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
      headers,
      body: JSON.stringify({ endpoint: old.endpoint }),
    }).catch(() => undefined);
  await writePushState({ ...state, endpoint: json.endpoint });
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(renewSubscription(event).catch(() => undefined));
});
