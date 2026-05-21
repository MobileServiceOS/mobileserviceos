import type { ToastItem, ToastType } from '@/types';
import { uid } from '@/lib/utils';

type Listener = (toasts: ToastItem[]) => void;
let toasts: ToastItem[] = [];
let listeners: Listener[] = [];

function emit() {
  listeners.forEach((l) => l(toasts));
}

export function addToast(msg: string, type: ToastType = 'info'): void {
  const item: ToastItem = { id: uid(), msg, type, ts: Date.now() };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emit();
  }, type === 'error' ? 5000 : 3000);
}

/**
 * Toast with an inline action button. Stays visible longer (8 s) so
 * the operator has time to tap. Tapping the action dismisses the
 * toast immediately.
 */
export function addActionToast(
  msg: string,
  action: { label: string; onTap: () => void },
  type: ToastType = 'info',
): void {
  const id = uid();
  const wrappedTap = (): void => {
    try { action.onTap(); } finally {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    }
  };
  const item: ToastItem = {
    id, msg, type, ts: Date.now(),
    action: { label: action.label, onTap: wrappedTap },
  };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 8000);
}

export function subscribeToasts(l: Listener): () => void {
  listeners.push(l);
  l(toasts);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
}
