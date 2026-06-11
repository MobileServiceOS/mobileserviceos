// src/lib/zettleTakePayment.ts
// ═══════════════════════════════════════════════════════════════════
//  Client helpers for the in-job "Take Payment with Zettle" flow.
//
//  Reality check: Zettle is card-PRESENT. There is no API to charge a
//  card from inside MSOS — the payment is taken on the Zettle reader /
//  Zettle Go app. So this flow is:
//    1. openZettleApp()        — best-effort app-switch to Zettle Go.
//    2. (operator charges the customer there.)
//    3. syncZettlePayments()   — pulls the new purchase in; the server
//                                matcher (persistAndMatch) auto-marks the
//                                job Paid when the amount lines up.
//
//  No real-time webhook is required for this — the operator taps Sync.
//  All security/role checks live on the callable (owner/admin only).
// ═══════════════════════════════════════════════════════════════════

import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

export type ZettleRange = '30' | '90' | '365';

export interface ZettleImportResult {
  imported: number;
  matched: number;
  review: number;
  pages: number;
}

/** Functions instance that connects to the local emulator only in a dev
 *  build served from localhost with the emulator flag set. Mirrors the
 *  helper in ZettleSettingsSection so callable behavior is identical. */
export function emulatorAwareFunctions() {
  const fns = getFunctions();
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const useEmu =
    env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1';
  if (useEmu) {
    try { connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch { /* already connected */ }
  }
  return fns;
}

/**
 * Best-effort app-switch to Zettle Go so the operator can charge the card.
 * There is no public deep link that pre-fills an amount, so we just open
 * the app (the operator types the amount). Returns false when we can't
 * launch it (e.g. desktop) so the caller can show the manual instruction.
 */
export function openZettleApp(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isMobile = /iphone|ipad|ipod|android/i.test(ua);
  if (!isMobile) return false;
  // Zettle Go registers the izettle:// scheme on both platforms. If the
  // app isn't installed the navigation simply no-ops; the caller's
  // fallback copy ("Take payment in the Zettle app, then sync") covers it.
  try {
    window.location.href = 'izettle://';
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull recent Zettle purchases and run them through the server matcher.
 * A matched purchase auto-marks its job Paid (paymentSource:'zettle').
 * Uses a 9-minute client timeout because a real back-fill paginates the
 * Purchase API + matches each payment, which exceeds the 70s callable
 * default. Re-running is safe — imports dedupe by Zettle purchase id.
 */
export async function syncZettlePayments(
  businessId: string,
  range: ZettleRange = '30',
): Promise<ZettleImportResult> {
  const fn = httpsCallable<{ businessId: string; range: ZettleRange }, ZettleImportResult>(
    emulatorAwareFunctions(),
    'importZettlePayments',
    { timeout: 540_000 },
  );
  const { data } = await fn({ businessId, range });
  return data;
}
