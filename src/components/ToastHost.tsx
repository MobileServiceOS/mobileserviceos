import { useEffect, useState } from 'react';
import type { ToastItem } from '@/types';
import { subscribeToasts } from '@/lib/toast';

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.type}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
