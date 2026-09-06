/*
 * The service worker.
 *
 * What it does, and — more importantly — what it deliberately does not.
 *
 * It caches the application shell: the stylesheet, the script bundles, the icons
 * and one offline page. That is what makes an installed app open instantly and
 * say something sensible when there is no connection.
 *
 * It never caches a page that carries financial figures, and it never serves one
 * from a cache. 02-FINANCIAL-RULES.md § אינווריאנטים is explicit that a stale
 * snapshot is not a basis for a decision, and a cached balance is exactly that: a
 * number that was true once, presented as if it were true now. Every navigation
 * goes to the network; when the network is not there, the honest offline page is
 * shown instead of yesterday's money.
 *
 * Nothing is ever posted anywhere. There is no background sync, no push
 * subscription and no analytics — those need a server this product does not have,
 * and adding a listener that quietly does nothing would be a claim rather than a
 * capability.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';

/** Only these are worth having before they are asked for. */
const PRECACHE = [OFFLINE_URL, '/icon.svg', '/icon-maskable.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` bypasses the HTTP cache: an install should fetch the current
      // shell, not whatever the browser happened to keep.
      .then((cache) =>
        cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))),
      )
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** True for the requests it is safe to keep a copy of. */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/icon-maskable.svg' ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // A write must reach the server or fail visibly. Queueing one to replay later
  // would mean a family thinking an expense was recorded when it was not.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // An export is generated from the current data. A cached one is a file of old
  // numbers with today's date on it.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached !== undefined) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
