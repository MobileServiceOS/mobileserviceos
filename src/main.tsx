import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { setupInstallPrompt } from '@/lib/pwa';
import { addToast } from '@/lib/toast';
import '@/styles/app.css';

setupInstallPrompt();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Service worker registration (relative path to honor Vite base)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((reg) => {
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
      .catch(() => {
        /* offline-first works either way */
      });
  });
}
