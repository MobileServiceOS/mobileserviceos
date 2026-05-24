// ─────────────────────────────────────────────────────────────────────
//  Pure presence-time helpers — no Firebase imports.
//  Split out of presence.ts so they're testable via tsx without
//  booting the Firestore SDK.
// ─────────────────────────────────────────────────────────────────────

/**
 * "5 min ago" style relative timestamp from an ISO date.
 * Returns "—" for missing / unparseable input. Caps at "30d+" for
 * very stale presences (anything older is operationally equivalent).
 */
export function presenceRelative(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const delta = Math.max(0, now - t);
  const sec = Math.floor(delta / 1000);
  if (sec < 60)        return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60)        return `${min} min ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)        return `${hr} hr ago`;
  const d   = Math.floor(hr / 24);
  if (d   < 30)        return `${d}d ago`;
  return '30d+ ago';
}

/**
 * True when a presence record is "stale" — older than the freshness
 * threshold (default 30 minutes). The dispatch board uses this to
 * dim a status pill so the dispatcher knows the tech may have
 * forgotten to update.
 */
export function isPresenceStale(
  iso: string | undefined,
  now: number = Date.now(),
  thresholdMs = 30 * 60_000,
): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return now - t > thresholdMs;
}
