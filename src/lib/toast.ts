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

export function subscribeToasts(l: Listener): () => void {
  listeners.push(l);
  l(toasts);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
}
