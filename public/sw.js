// Mobile Service OS — Service Worker
// Strategy: cache-first for app shell, network-first for Firebase/CDN, stale-while-revalidate for icons.

const VERSION = 'msos-v1.1.0';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  './',
  './index.html',
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
  './icons/favicon.ico'
];

// Install: pre-cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches, claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => !n.startsWith(VERSION)).map(n => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

// Listen for skip-waiting messages from page
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Fetch handler
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Firebase / Google APIs / auth — always network
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

  // CDN libs (jsdelivr, cdnjs, unpkg) — stale-while-revalidate
  const isCDN =
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isCDN) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const fetchPromise = fetch(req).then(res => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Same-origin navigation requests → return index.html (SPA shell)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then(r => r || caches.match('./'))
      )
    );
    return;
  }

  // Default: cache-first for shell assets, network fallback to cache
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // Cache successful responses for our origin
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
