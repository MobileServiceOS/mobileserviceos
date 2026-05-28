import { useEffect, useState } from 'react';
import type { ToastItem } from '@/types';
import { subscribeToasts, dismissToast } from '@/lib/toast';

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={'toast ' + t.type}
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
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
