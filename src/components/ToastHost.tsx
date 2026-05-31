import { useEffect, useState } from 'react';
import type { ToastItem } from '@/types';
import { subscribeToasts, dismissToast } from '@/lib/toast';

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    // Audit a11y P1-1 (2026-05-31): announce async state changes to
    // screen-reader users. role="region" + aria-label gives AT users
    // a landmark to navigate to. Each individual toast then declares
    // role={status|alert} so the message gets read out as it appears.
    <div className="toast-host" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={'toast ' + t.type}
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          // Errors and warnings interrupt the AT reading queue
          // (role="alert" + aria-live="assertive"). Info/success
          // toasts wait politely (role="status" + aria-live="polite")
          // so they don't clobber a user mid-read.
          role={t.type === 'error' || t.type === 'warn' ? 'alert' : 'status'}
          aria-live={t.type === 'error' || t.type === 'warn' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span style={{ flex: 1 }}>{t.msg}</span>
          {t.action && (
            <button
              type="button"
              onClick={t.action.onTap}
              className="btn xs primary"
              style={{ flexShrink: 0 }}
            >
              {t.action.label}
            </button>
          )}
          {/* Manual dismiss — tappable ✕. Sized for gloved field use.
              Sits AFTER the action button so the primary CTA stays
              the visual anchor; the close is a secondary affordance.
              Auto-dismiss still fires from the toast lib's setTimeout
              path; this just lets impatient users clear a stuck
              message blocking the screen. */}
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              opacity: 0.6,
              fontSize: 16,
              lineHeight: 1,
              padding: '6px 8px',
              cursor: 'pointer',
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
