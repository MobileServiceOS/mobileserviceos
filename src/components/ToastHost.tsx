import { useEffect, useState } from 'react';
import type { ToastItem } from '@/types';
import { subscribeToasts } from '@/lib/toast';

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={'toast ' + t.type}
          style={t.action ? { display: 'flex', alignItems: 'center', gap: 10 } : undefined}
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
        </div>
      ))}
    </div>
  );
}
