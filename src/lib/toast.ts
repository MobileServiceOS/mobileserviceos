import type { ToastItem, ToastType } from '@/types';
import { uid } from '@/lib/utils';
import { hapticSuccess, hapticError, hapticWarning, hapticLight } from '@/lib/haptics';

type Listener = (toasts: ToastItem[]) => void;
let toasts: ToastItem[] = [];
let listeners: Listener[] = [];

function emit() {
  listeners.forEach((l) => l(toasts));
}

/** Map a toast type to its native-feeling tactile signature so the
 *  operator gets uniform feedback across every flow that surfaces
 *  a toast. */
function hapticFor(type: ToastType): void {
  switch (type) {
    case 'success': hapticSuccess(); break;
    case 'error':   hapticError();   break;
    case 'warn':    hapticWarning(); break;
    default:        hapticLight();
  }
}

export function addToast(msg: string, type: ToastType = 'info'): void {
  const item: ToastItem = { id: uid(), msg, type, ts: Date.now() };
  toasts = [...toasts, item];
  emit();
  hapticFor(type);
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
  hapticFor(type);
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

/**
 * Manual dismiss — clears a specific toast by id. Powers the close
 * button on the ToastHost render. Idempotent; calling with a stale
 * id (already auto-cleared by setTimeout) is a no-op.
 */
export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
