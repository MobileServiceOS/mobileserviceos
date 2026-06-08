// src/lib/paymentMethodMemory.ts
// ═══════════════════════════════════════════════════════════════════
//  Remembers the operator's last-used Mark-Paid method so the command
//  center defaults to it instead of always 'cash'. One fewer chip tap on
//  every non-cash job — and most operators collect the same way each time
//  (a Zelle shop is a Zelle shop). localStorage-backed and defensively
//  guarded: private-mode / disabled-storage throws degrade to "no memory"
//  (falls back to cash), never an error.
// ═══════════════════════════════════════════════════════════════════

import type { PaymentMethod } from '@/types';

const KEY = 'msos_last_payment_method';
const VALID: readonly PaymentMethod[] = [
  'cash', 'card', 'zelle', 'venmo', 'cashapp', 'check', 'apple_pay', 'google_pay', 'other',
];

/** The last method the operator marked a job paid with, or null if unknown. */
export function getLastPaymentMethod(): PaymentMethod | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && (VALID as readonly string[]).includes(v) ? (v as PaymentMethod) : null;
  } catch {
    return null;
  }
}

/** Persist the method just used so the next Mark Paid defaults to it. */
export function setLastPaymentMethod(method: PaymentMethod): void {
  try {
    window.localStorage.setItem(KEY, method);
  } catch {
    /* storage unavailable — memory is best-effort */
  }
}
