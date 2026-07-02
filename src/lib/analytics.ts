// src/lib/analytics.ts
// ═══════════════════════════════════════════════════════════════════
//  PRIVACY-FIRST, FIRST-PARTY, AGGREGATE-ONLY product analytics.
//
//  Honors the privacy policy ("not used for tracking, no third-party
//  ad/tracking SDKs"):
//    • No third-party SDK, no cookies, no cross-site tracking, no device
//      IDs — nothing leaves the project's own Firebase.
//    • NO PII and NO per-user linkage. We write ANONYMOUS DAILY COUNTERS
//      only: analytics/{YYYY-MM-DD} → { counts: { <event>: N, ... } }.
//      You can see "42 jobs logged, 7 payouts locked-views, 2 checkouts
//      started today" — never who did what.
//    • Best-effort + fire-and-forget: never throws, never blocks the UI.
//    • PRODUCTION ONLY — no-ops in dev, tests, and the Node runner.
//
//  Conversion funnel: pair these behavioral counts with the existing
//  per-business `settings.subscriptionStatus` (free / trialing / active)
//  to see signup → activation → paywall interest → checkout → paid,
//  without tracking individuals.
// ═══════════════════════════════════════════════════════════════════
import { doc, setDoc, serverTimestamp, increment } from 'firebase/firestore';
import { _db } from '@/lib/firebase';

export type AnalyticsEvent =
  | 'signup_completed'        // onboarding finished (new operator activated)
  | 'job_logged'             // a job was saved (core activation signal)
  | 'invoice_sent'           // a branded/plain invoice or estimate went out
  | 'locked_feature_viewed'  // a free user saw a paid feature's locked state (+ which)
  | 'upgrade_cta_clicked'    // they tapped an upgrade CTA
  | 'checkout_started';      // Stripe Checkout was launched (+ plan)

// Vite replaces import.meta.env.PROD with a literal at build time; it's
// true only in the deployed production bundle (false in dev/tests, and
// import.meta.env is undefined in the Node test runner → guarded).
const IS_PROD = ((import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD) === true;

function dayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Build the Firestore counter key: `event` or `event__detail` (sanitized). */
export function analyticsKey(event: AnalyticsEvent, detail?: string): string {
  if (!detail) return event;
  const clean = detail.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 48);
  return clean ? `${event}__${clean}` : event;
}

/**
 * Record one anonymous event as a daily counter increment. Fire-and-forget:
 * safe to call from anywhere, never awaits, never throws. `detail` is an
 * optional low-cardinality label (e.g. the feature key or plan) — never PII.
 */
export function track(event: AnalyticsEvent, detail?: string): void {
  try {
    if (!IS_PROD || !_db || typeof window === 'undefined') return;
    const day = dayKey();
    void setDoc(
      doc(_db, 'analytics', day),
      { date: day, counts: { [analyticsKey(event, detail)]: increment(1) }, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch(() => { /* analytics must never surface an error */ });
  } catch {
    /* analytics must never break the app */
  }
}
