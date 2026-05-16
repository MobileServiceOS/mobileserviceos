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

// Register service worker (PWA).
//
// Self-healing registration: a previously-deployed SW can cache a
// broken bundle. To recover automatically WITHOUT the user having to
// manually clear site data:
//   1. register() then immediately call update() to fetch the newest
//      sw.js (the new SW has a bumped VERSION → its activate handler
//      purges every stale cache).
//   2. Listen for `controllerchange` — fired when a new SW takes
//      control — and reload ONCE so the page runs against the fresh
//      caches/bundle. The `reloadedForSW` guard prevents a reload loop.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swPath = (import.meta.env.BASE_URL || '/') + 'sw.js';
    navigator.serviceWorker
      .register(swPath)
      .then((reg) => {
        // Proactively check for a newer sw.js on every load.
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn('[sw] registration failed:', err);
      });

    let reloadedForSW = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedForSW) return;
      reloadedForSW = true;
      // A new SW just took control — reload so the page is served by
      // the fresh worker with purged caches and the current bundle.
      window.location.reload();
    });
  });
}

// Tell the boot HTML we're alive
if (typeof window.__msosReady === 'function') {
  window.__msosReady();
}
