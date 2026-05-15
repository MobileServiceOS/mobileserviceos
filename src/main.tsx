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

// Register service worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swPath = (import.meta.env.BASE_URL || '/') + 'sw.js';
    navigator.serviceWorker.register(swPath).catch((err) => {
      console.warn('[sw] registration failed:', err);
    });
  });
}

// Tell the boot HTML we're alive
if (typeof window.__msosReady === 'function') {
  window.__msosReady();
}
