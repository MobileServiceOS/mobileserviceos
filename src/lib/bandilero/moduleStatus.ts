// src/lib/bandilero/moduleStatus.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — module Data-Confidence.
//
//  Every intelligence module reports one of three states (data
//  confidence > aesthetics):
//    CONNECTED     — a real data source is flowing and has rows.
//    PARTIAL       — the source exists but is incomplete (some sub-data
//                    missing, e.g. only some jobs are geocoded).
//    NOT_CONNECTED — no data source / no rows.
//
//  Deterministic, derived from real counts + connectivity flags — never
//  fabricated. Distinct from the per-metric confidence state (LIVE/
//  ESTIMATED/NOT_CONNECTED); this is the module roll-up.
// ═══════════════════════════════════════════════════════════════════

export type ModuleStatus = 'CONNECTED' | 'PARTIAL' | 'NOT_CONNECTED';

/** Firestore-backed module: CONNECTED iff it has any rows. */
export function statusFromCount(rows: number): ModuleStatus {
  return rows > 0 ? 'CONNECTED' : 'NOT_CONNECTED';
}

/** Integration-backed module (call/reputation/seo): keyed on connectivity. */
export function statusFromFlag(connected: boolean): ModuleStatus {
  return connected ? 'CONNECTED' : 'NOT_CONNECTED';
}

/**
 * Partial-aware: NOT_CONNECTED when nothing has the data, PARTIAL when
 * some but not all do, CONNECTED when complete. Used by Dispatch
 * (geocoded jobs) and similar.
 */
export function statusPartial(total: number, withData: number): ModuleStatus {
  if (total <= 0 || withData <= 0) return 'NOT_CONNECTED';
  return withData < total ? 'PARTIAL' : 'CONNECTED';
}
