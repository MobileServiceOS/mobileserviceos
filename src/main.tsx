import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { setupInstallPrompt } from '@/lib/pwa';
import { addToast } from '@/lib/toast';
import '@/styles/app.css';

declare global {
  interface Window {
    __msosReady?: () => void;
    __msosShowError?: (title: string, detail?: string) => void;
  }
}

try {
  setupInstallPrompt();

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Root element #root missing from index.html');
  }

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[main] fatal:', err);
  if (typeof window.__msosShowError === 'function') {
    window.__msosShowError('App failed to start', msg);
  } else {
    document.body.innerHTML =
      '<pre style="color:#f87171;padding:24px;font-family:monospace;">' + msg + '</pre>';
  }
}

// Service worker registration. Compute URL relative to document so it works under /mobileserviceos/
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        reg.update().catch(() => {});
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              addToast('Update available — refresh to apply', 'info', 6000);
            }
          });
        });
      })
      .catch((e) => {
        console.warn('[sw] registration failed (non-fatal):', e);
      });
  });
}
