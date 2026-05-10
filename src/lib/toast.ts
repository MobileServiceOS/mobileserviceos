import type { ToastItem, ToastType } from '@/types';
import { uid } from '@/lib/utils';

type ToastListener = (items: ToastItem[]) => void;

let listeners: ToastListener[] = [];
let items: ToastItem[] = [];

export function addToast(msg: string, type: ToastType = 'success', ms = 3000): void {
  const t: ToastItem = { id: uid(), msg, type, ts: Date.now() };
  items = [...items, t];
  listeners.forEach((fn) => fn(items));
  setTimeout(() => {
    items = items.filter((x) => x.id !== t.id);
    listeners.forEach((fn) => fn(items));
  }, ms);
}

export function subscribe(fn: ToastListener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}
