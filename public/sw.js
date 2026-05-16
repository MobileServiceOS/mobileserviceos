// Mobile Service OS — Service Worker
// ════════════════════════════════════════════════════════════════════
// Caching strategy (deploy-safe):
//   - HTML navigations  → NETWORK-FIRST, never cached. A stale
//     index.html points at hashed JS bundles that no longer exist
//     after a deploy → "No JavaScript loaded". So HTML always comes
//     fresh from the network; offline shows a minimal fallback.
//   - Hashed JS/CSS      → NETWORK-FIRST. Vite content-hashes these
//     (index-AbC123.js); the filename itself is the cache key. Serving
//     a cached bundle that the current index.html doesn't reference is
//     pointless and risks version skew. Network-first keeps deploys
//     instant; the cache is only an offline fallback.
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

// Bumped to v3 — evicts caches from the broken react-router-dom build.
const VERSION = 'msos-v3';
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
    event.respondWith(fetch(req).catch(() => caches.match(req)));
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
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── Same-origin HTML navigation ──────────────────────────────────
  // NETWORK-FIRST and NEVER cached. A cached index.html points at
  // hashed bundles that are deleted on the next deploy → broken boot.
  // Offline → a minimal inline fallback page (not a stale app shell).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            '<!doctype html><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<title>Offline \u2014 Mobile Service OS</title>' +
              '<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center;color:#333">' +
              '<h2>You\u2019re offline</h2>' +
              '<p>Mobile Service OS needs a connection to load. ' +
              'Reconnect and try again.</p>' +
              '<button onclick="location.reload()" ' +
              'style="margin-top:12px;padding:10px 20px;border-radius:8px;' +
              'border:1px solid #c8a44a;background:#c8a44a;color:#fff;font-size:15px">' +
              'Retry</button></body>',
            { status: 200, headers: { 'Content-Type': 'text/html' } }
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
        .catch(() => caches.match(req))
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
          .catch(() => caches.match(req));
      })
    );
  }
});
