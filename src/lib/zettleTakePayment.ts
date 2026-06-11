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
 * A VALID https URL for opening Zettle. We deliberately do NOT use the
 * `izettle://` custom scheme: from a PWA that throws Safari's
 * "address is invalid" error when the app isn't installed/registered.
 * Zettle also has no public deep link that pre-fills a charge amount, so
 * the operator opens Zettle, charges manually, returns, and taps Sync.
 *
 * On a phone the platform store link hands off to the installed app /
 * its listing; on desktop it opens the Zettle web portal. Either way it
 * is a real https URL, so it never errors.
 */
export function zettleAppUrl(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'https://play.google.com/store/apps/details?id=com.izettle.android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'https://apps.apple.com/app/id920305846';
  }
  return 'https://my.zettle.com';
}

/**
 * Launch the Zettle Go app using the platform-correct method, with a safe
 * fallback so it NEVER throws Safari's "address is invalid" error:
 *
 *   • Android — an `intent://` URL with the Zettle package and a
 *     `browser_fallback_url`. Chrome opens the app if installed, else
 *     follows the fallback. This is the supported Android app-launch.
 *   • iOS / desktop — a valid https URL (App Store listing on iOS, the
 *     Zettle web portal elsewhere). No custom scheme, so no error; on a
 *     device with the app, the universal-link handoff opens it.
 *
 * Zettle publishes no public deep link that pre-fills a charge amount, so
 * the operator types the amount in Zettle, then returns and taps Sync.
 */
export function openZettle(): void {
  if (typeof window === 'undefined') return;
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) {
    const fallback = encodeURIComponent('https://play.google.com/store/apps/details?id=com.izettle.android');
    window.location.href =
      `intent://#Intent;package=com.izettle.android;scheme=izettle;S.browser_fallback_url=${fallback};end`;
    return;
  }
  window.open(zettleAppUrl(), '_blank', 'noopener,noreferrer');
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
