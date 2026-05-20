import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { setupInstallPrompt } from '@/lib/pwa';
import { captureRefCodeFromUrl } from '@/lib/referral';
import '@/styles/app.css';

setupInstallPrompt();

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

if ('serviceWorker' in navigator) {
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
