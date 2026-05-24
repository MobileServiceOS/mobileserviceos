import { useEffect, useState } from 'react';
import { applyServiceWorkerUpdate } from '@/lib/pwa';

// ─────────────────────────────────────────────────────────────────────
//  UpdateBanner — bottom-anchored prompt that appears when the
//  service worker detects a new app version waiting to activate.
//  Listens for the 'msos:update-available' custom event (dispatched
//  by watchServiceWorkerUpdates in src/lib/pwa.ts).
//
//  Tap "Update" → applyServiceWorkerUpdate posts SKIP_WAITING to the
//  waiting SW. The SW activates, controllerchange fires, main.tsx's
//  one-shot reload kicks the page over to the new version.
//
//  Dismissable via × — survives until the next 'msos:update-available'
//  event. We don't persist dismissal across reloads on purpose: the
//  next page load will re-check and either show again (if user is
//  still behind) or stay quiet (if they've already reloaded).
// ─────────────────────────────────────────────────────────────────────

export function UpdateBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onAvailable = () => setVisible(true);
    window.addEventListener('msos:update-available', onAvailable as EventListener);
    return () => window.removeEventListener('msos:update-available', onAvailable as EventListener);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 12, right: 12,
        bottom: 'calc(72px + env(safe-area-inset-bottom))',  // above bottom-nav
        zIndex: 8000,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'var(--s1)',
        border: '1px solid var(--border)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
        color: 'var(--t1)',
      }}
    >
      <span style={{ fontSize: 16 }} aria-hidden="true">⬆️</span>
      <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>
        A new version is ready.
      </span>
      <button
        type="button"
        className="btn xs primary"
        onClick={applyServiceWorkerUpdate}
        style={{ fontSize: 11 }}
      >
        Update
      </button>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        style={{
          width: 28, height: 28, padding: 0,
          background: 'transparent', border: 'none',
          color: 'var(--t3)', fontSize: 18, cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
