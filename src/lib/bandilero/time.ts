// src/lib/bandilero/time.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — time helpers.
//
//  Firestore Timestamp fields (Lead.receivedAt, ReviewRequest.sentAt,
//  CommunicationEvent.sentAt) arrive as Timestamp objects on the client
//  and as { _seconds } / { seconds } shapes elsewhere. tsMillis()
//  normalizes any of those (plus a raw number or ISO string) to epoch
//  millis, or null when it can't.
//
//  All DATE-keyed metrics in MSOS use Job.date (a 'YYYY-MM-DD' service
//  date string, NOT a payment timestamp) and exclude Cancelled jobs —
//  Bandilero matches that convention exactly so its numbers reconcile
//  with the existing Dashboard / Insights.
// ═══════════════════════════════════════════════════════════════════

/** Normalize a Firestore Timestamp / {seconds} / number / ISO to millis. */
export function tsMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof o.toMillis === 'function') {
    const m = o.toMillis();
    return Number.isFinite(m) ? m : null;
  }
  const secs = o.seconds ?? o._seconds;
  if (typeof secs === 'number' && Number.isFinite(secs)) return secs * 1000;
  return null;
}

/** Epoch millis for the start (noon-anchored) of a 'YYYY-MM-DD' date. */
export function dateMillis(dateISO: string): number | null {
  if (!dateISO) return null;
  const t = new Date(dateISO + 'T12:00:00').getTime();
  return Number.isFinite(t) ? t : null;
}

/** ISO date N days before `dateISO` (noon-anchored, local). */
export function addDays(dateISO: string, delta: number): string {
  const dt = new Date(dateISO + 'T12:00:00');
  dt.setDate(dt.getDate() + delta);
  return dt.toLocaleDateString('en-CA');
}

/**
 * Cutoff millis for "the last `windowDays` days up to and including
 * today". A row counts when its millis is >= cutoff.
 */
export function windowCutoffMillis(todayISO: string, windowDays: number): number {
  const start = addDays(todayISO, -(Math.max(0, windowDays) - 1));
  return dateMillis(start) ?? 0;
}
