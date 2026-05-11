import { useEffect, useState } from 'react';
import { applyServiceWorkerUpdate } from '@/lib/pwa';

/**
 * Update banner — shows when a new service worker has finished installing
 * and is waiting to activate. Listens for the `msos:update-available` event
 * dispatched by `setupServiceWorkerUpdates()` in `lib/pwa.ts`.
 *
 * Why a banner instead of auto-reload? Auto-reloading mid-session would
 * drop unsaved form state (e.g. a job in progress). The banner lets the
 * operator finish what they're doing first.
 */
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onAvailable = () => setAvailable(true);
    window.addEventListener('msos:update-available', onAvailable);
    return () => window.removeEventListener('msos:update-available', onAvailable);
  }, []);

  if (!available) return null;

  const apply = () => {
    setApplying(true);
    applyServiceWorkerUpdate();
    // Safety reload if controllerchange doesn't fire within 3s
    setTimeout(() => window.location.reload(), 3000);
  };

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner-inner">
        <div className="update-banner-text">
          <div className="update-banner-title">New version available</div>
          <div className="update-banner-sub">Refresh to get the latest features and fixes</div>
        </div>
        <button
          className="update-banner-btn"
          onClick={apply}
          disabled={applying}
        >
          {applying ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}
