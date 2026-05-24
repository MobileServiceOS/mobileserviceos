// Mobile Service OS — Service Worker
// ════════════════════════════════════════════════════════════════════
// Caching strategy (deploy-safe + offline-loadable):
//   - HTML navigations  → NETWORK-FIRST, AND cache the successful
//     response. Offline → serve the cached navigation so the app
//     actually LOADS without network. The cached index.html points
//     at hashed JS/CSS bundles that we ALSO cache on first load, so
//     the matched pair (index + its bundles) is always co-cached.
//     Worst case after a deploy: an offline user runs the previous
//     version. On next online load, both index.html AND the new
//     bundles refresh together — no "stale shell pointing at deleted
//     bundles" trap, because the cache always serves the chunks the
//     cached shell actually requested.
//   - Hashed JS/CSS      → NETWORK-FIRST with cache write on success
//     so the matching set is always present alongside index.html.
//   - Static icons/manifest → cache-first (safe: stable filenames).
//   - Firebase / Google APIs → network-first (never serve stale auth).
//   - Font / script CDNs → stale-while-revalidate.
//
// CRITICAL: bump VERSION on every deploy that changes caching behavior.
// The activate handler deletes every cache whose name doesn't start
// with the current VERSION — that is the ONLY mechanism that evicts a
// poisoned cache from a previously-broken deploy. If VERSION never
// changes, stale caches live forever.
// ════════════════════════════════════════════════════════════════════

// Bumped to v5 — app-shell now cached on navigation success so the
// app loads offline. Evicts the v4 cache that never stored index.html.
const VERSION = 'msos-v5';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

// Pre-cache ONLY stable, non-hashed static assets. NEVER pre-cache
// index.html or hashed JS — those change every deploy.
const SHELL_ASSETS = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-rounded-192.png',
  './icons/icon-rounded-512.png',
  './icons/icon-180.png',
  './icons/icon-152.png',
  './icons/icon-144.png',
  './icons/icon-96.png',
  './icons/icon-72.png',
  './icons/favicon-32.png',
  './icons/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      // skipWaiting → the new SW activates immediately instead of
      // waiting for every tab to close. Combined with the VERSION
      // bump + activate-purge, this guarantees a poisoned cache is
      // evicted on the very next page load.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Is this request for a JavaScript or CSS asset? Vite emits these with
// content-hashed filenames under /assets/. We treat them network-first
// so a deploy is picked up instantly and a poisoned cache can never
// shadow a fresh bundle.
function isHashedAsset(url) {
  return (
    url.pathname.includes('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.mjs')
  );
}

// `event.respondWith()` requires a Response (or a Promise resolving to
// one). `caches.match()` resolves to undefined on a miss, and any
// `.catch(() => caches.match(req))` therefore risks resolving the
// outer promise to undefined → "Failed to convert value to 'Response'"
// TypeError + the FetchEvent surfacing as a network error. This helper
// guarantees a real Response for every fallback path.
function offlineResponse() {
  return new Response('', { status: 504, statusText: 'Service Worker Offline' });
}

// `caches.match()` coerced to always resolve to a Response. Use this
// anywhere we'd previously written `.catch(() => caches.match(req))`.
function safeCacheMatch(req) {
  return caches.match(req).then((r) => r || offlineResponse());
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  const isFirebase =
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebasestorage.app') ||
    url.hostname.includes('cloudfunctions.net') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('gstatic.com');

  if (isFirebase) {
    event.respondWith(fetch(req).catch(() => safeCacheMatch(req)));
    return;
  }

  const isCDN =
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isCDN) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const fetchPromise = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            // If the network throws and there's no cached copy, fall
            // through to a synthetic offline Response so respondWith
            // never sees an undefined value.
            .catch(() => cached || offlineResponse());
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── Same-origin HTML navigation ──────────────────────────────────
  // NETWORK-FIRST + cache the successful response under '/' so the
  // app actually loads offline on subsequent visits. The cached
  // shell points at hashed bundles that ALSO get cached on first
  // request (see hashed-asset handler below), so the pair is always
  // co-resident. After a deploy, the next online navigation refreshes
  // both halves together — no stale-shell trap.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put('/', clone));
          }
          return res;
        })
        .catch(() =>
          caches.match('/').then((cached) =>
            cached ||
          new Response(
            '<!doctype html><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<title>Offline \u2014 Mobile Service OS</title>' +
              '<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center;color:#333">' +
              '<h2>You\u2019re offline</h2>' +
              '<p>Open the app once with a connection so it can install. ' +
              'After that, it works offline.</p>' +
              '<button onclick="location.reload()" ' +
              'style="margin-top:12px;padding:10px 20px;border-radius:8px;' +
              'border:1px solid #c8a44a;background:#c8a44a;color:#fff;font-size:15px">' +
              'Retry</button></body>',
            { status: 200, headers: { 'Content-Type': 'text/html' } }
          )
          )
        )
    );
    return;
  }

  // ── Same-origin hashed JS / CSS ──────────────────────────────────
  // NETWORK-FIRST. The content hash in the filename is the version;
  // a fresh deploy always requests a new filename. Cache is written
  // only as an offline fallback, never served when the network works.
  if (url.origin === self.location.origin && isHashedAsset(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => safeCacheMatch(req))
    );
    return;
  }

  // ── Same-origin other static assets (icons, manifest, etc.) ──────
  // Cache-first is safe here — these have stable filenames that don't
  // change between deploys.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // Background refresh so a changed icon eventually updates.
          fetch(req)
            .then((res) => {
              if (res && res.status === 200) {
                caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, res.clone()));
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone));
            }
            return res;
          })
          .catch(() => safeCacheMatch(req));
      })
    );
  }
});
