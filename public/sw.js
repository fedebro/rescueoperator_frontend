/*
 * Rescue Control service worker — offline shell + static asset cache. Deliberately small:
 *  - navigations: network first; when the network fails the precached /offline page is served;
 *  - static assets (hashed Next.js build files, fonts, icons, brand): cache first;
 *  - EVERYTHING else is left to the browser: API calls (any origin), realtime, map tiles, the manifest,
 *    and the MSW worker are never cached nor intercepted. Game state is server-authoritative.
 * Registered only in production builds that use a real API (see src/features/platform/pwa.ts).
 */
const VERSION = 'rc-sw-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline';
const PRECACHE = [
  '/brand/logo-stacked.svg',
  '/brand/logo-horizontal.svg',
  '/favicon.svg',
  '/icons/app/icon-192.png',
  '/icons/app/icon-512.png',
];
const STATIC_PREFIXES = ['/_next/static/', '/icons/', '/brand/'];
const STATIC_FILES = ['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png'];
const NEVER = ['/mockServiceWorker.js', '/sw.js', '/api/', '/manifest.webmanifest'];

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
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
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
