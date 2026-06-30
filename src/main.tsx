import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { setupInstallPrompt, watchServiceWorkerUpdates } from '@/lib/pwa';
import { installUploadQueueDrain } from '@/lib/uploadQueue';
import { captureRefCodeFromUrl } from '@/lib/referral';
import { initErrorMonitor } from '@/lib/errorMonitor';
import '@/styles/app.css';

// Install global error + unhandledrejection capture before anything
// else runs, so a crash during early boot is still recorded.
initErrorMonitor();

// ── Stale-bundle self-heal ────────────────────────────────────────
// When the service worker's cached index.html points at deleted asset
// hashes (the deploy happened between cache-fill and the user opening
// the app), Vite's dynamic import for a chunk 404s. The page would
// otherwise sit blank because React never mounted. Vite emits
// `vite:preloadError` for this exact case; we catch it, force-update
// the SW so the new index.html lands, then hard-reload bypassing
// caches. Guard with sessionStorage so we never enter a reload loop
// when the underlying error is something other than stale assets.
window.addEventListener('vite:preloadError', (event) => {
  // eslint-disable-next-line no-console
  console.warn('[main] preload error — likely stale SW bundle', event);
  const KEY = 'msos_stale_bundle_recover_at';
  const now = Date.now();
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (now - last < 30_000) {
    // We already tried within the last 30s; the failure isn't a
    // stale-bundle issue. Let the page show the natural error rather
    // than loop forever.
    return;
  }
  sessionStorage.setItem(KEY, String(now));
  // Best-effort: tell the SW to skipWaiting + drop its caches, then
  // reload. Failure paths still hit the location.reload below so the
  // user gets a fresh shot at booting the new bundle.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      Promise.all(regs.map((r) => r.unregister())).finally(() => {
        if (typeof caches !== 'undefined') {
          caches.keys().then((keys) => {
            Promise.all(keys.map((k) => caches.delete(k))).finally(() => {
              window.location.reload();
            });
          }).catch(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
    }).catch(() => window.location.reload());
  } else {
    window.location.reload();
  }
});

setupInstallPrompt();

// Storage-upload queue drain. Listens for the 'online' edge and
// processes any photo uploads that were stashed in IndexedDB while
// offline. Also drains opportunistically on first load so a tab that
// was closed mid-queue picks up where it left off.
installUploadQueueDrain();

// Capture ?ref=CODE URL parameter as early as possible — before any
// auth redirect can strip it. Persists to localStorage and survives
// the OAuth round-trip. Read back in Onboarding to create the
// referrals/{id} doc when the new business completes setup.
captureRefCodeFromUrl();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}

// Service worker — PRODUCTION ONLY.
//
// We deliberately do NOT register the SW under `npm run dev` or any
// localhost origin. The dev server's HMR / module pipeline doesn't
// match the SW's network-first/cache-first assumptions, and a stale
// dev-registered SW is the most common cause of "stuck on the offline
// screen" recoveries on localhost.
//
// Self-heal: if a previous build (or an old preview session) left a
// registered SW behind on a dev origin, unregister it and purge any
// caches it created so the next reload escapes the offline shell.
const isLocalhost =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]' ||
    location.hostname === '::1');

// Skip the web service worker entirely inside the Capacitor native shell —
// the app is served from the bundled assets there, and a SW + its caches
// would only fight the native WebView. (No-op condition on the web PWA.)
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  if (import.meta.env.PROD && !isLocalhost) {
    // Production registration. Self-healing for poisoned caches:
    //   1. register() then immediately update() to fetch the newest
    //      sw.js (bumped VERSION → its activate handler purges stale
    //      caches).
    //   2. Reload ONCE on `controllerchange` so the page runs against
    //      the fresh worker + bundle. `reloadedForSW` blocks a loop.
    window.addEventListener('load', () => {
      const swPath = (import.meta.env.BASE_URL || '/') + 'sw.js';
      navigator.serviceWorker
        .register(swPath)
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch((err) => {
          console.warn('[sw] registration failed:', err);
        });

      // After registration, watch for new versions and dispatch the
      // update-available event so <UpdateBanner> can prompt a reload.
      watchServiceWorkerUpdates();

      let reloadedForSW = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadedForSW) return;
        reloadedForSW = true;
        window.location.reload();
      });
    });
  } else {
    // Dev / localhost: tear down any leftover SW + caches so the
    // user is never trapped behind a stale worker. Best-effort; every
    // step swallows its own error so a Safari-style restricted SW API
    // never breaks the page load.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const r of regs) {
          r.unregister().catch(() => {});
        }
        if (regs.length > 0) {
          console.info('[sw] unregistered', regs.length, 'leftover worker(s) on dev/localhost');
        }
      })
      .catch(() => {});
    if (typeof caches !== 'undefined') {
      caches
        .keys()
        .then((keys) => {
          for (const k of keys) {
            caches.delete(k).catch(() => {});
          }
        })
        .catch(() => {});
    }
  }
}

// Tell the boot HTML we're alive
if (typeof window.__msosReady === 'function') {
  window.__msosReady();
}
