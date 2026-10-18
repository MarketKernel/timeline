/**
 * Service worker of the PWA (build/pages/): keeps Timeline working offline once
 * opened, and keeps the chronologies the reader marked "keep offline".
 *
 * build.mjs writes a hash of the page into CACHE, so every deploy changes this
 * file's bytes and the browser installs the new worker. It does not take over
 * on its own: it waits, with the new page in its own cache, while the old one
 * keeps serving the old page. The page's Update button (update.ts) tells it to
 * go ahead; otherwise the browser lets it in once every window is closed.
 *
 * Library files live in a cache of their own, LIBRARY, that no deploy deletes:
 * what the reader kept offline stays kept. They are put there by the page
 * (shelf.ts), and read from there first — those the library lists on another
 * site too, the only requests elsewhere the page's policy lets through.
 */
const CACHE = 'timeline-__CACHE__';
const LIBRARY = 'timeline-library';
const VERSION = '__VERSION__';
const SHELL = ['./', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  // Past the HTTP cache: a page served a few minutes ago may be the previous deploy's.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('timeline-') && key !== CACHE && key !== LIBRARY).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// The page asks a waiting worker which version it brings, and tells it to take over —
// the app's own windows only.
self.addEventListener('message', (event) => {
  if (!(event.source instanceof WindowClient) || !event.source.url.startsWith(self.registration.scope)) return;
  if (event.data === 'version') event.ports[0]?.postMessage(VERSION);
  else if (event.data === 'activate') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const kept = () => caches.open(LIBRARY).then((cache) => cache.match(request, { ignoreSearch: true }));
  if (url.origin !== self.location.origin) {
    event.respondWith(kept().then((file) => file ?? fetch(request)));
    return;
  }
  if (!url.href.startsWith(self.registration.scope)) return;
  // From this worker's own cache only: a waiting worker's, with the next version, is there too.
  const cached = (key, options) => caches.open(CACHE).then((cache) => cache.match(key, options));
  if (request.mode === 'navigate') {
    event.respondWith(cached('./').then((page) => page ?? fetch(request)));
    return;
  }
  if (url.pathname.includes('/library/')) {
    // The shelf's list: fresh when online, the kept copy when not. A file: kept copy first.
    if (url.pathname.endsWith('/index.json')) {
      event.respondWith(fetch(request).catch(() => kept().then((file) => file ?? Response.error())));
    } else {
      event.respondWith(kept().then((file) => file ?? fetch(request)));
    }
    return;
  }
  event.respondWith(cached(request, { ignoreSearch: true }).then((file) => file ?? fetch(request)));
});
