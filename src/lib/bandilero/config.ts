// src/lib/bandilero/config.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — tenant-tunable thresholds.
//
//  Stored at businesses/{bid}/bandilero/config. ABSENCE is not an error:
//  resolveConfig() falls back to documented defaults (never a fabricated
//  value), and clamps any out-of-range stored value. This keeps the
//  module working for every tenant with zero setup, while allowing an
//  operator (or a future Settings panel) to tune it.
// ═══════════════════════════════════════════════════════════════════

export interface BandileroConfig {
  /** Trailing window (days) for windowed metrics (missed calls, reviews). */
  windowDays: number;
  /** A customer is "new" if their first job was within this many days. */
  newCustomerDays: number;
  /** Week-over-week revenue drop (%) that triggers a decline risk. */
  revenueDeclinePct: number;
}

export const DEFAULT_CONFIG: BandileroConfig = {
  windowDays: 7,
  newCustomerDays: 30,
  revenueDeclinePct: 15,
};

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Merge a stored (possibly partial / absent / invalid) config doc with
 *  the defaults, clamping to safe ranges. */
export function resolveConfig(doc?: Partial<BandileroConfig> | null): BandileroConfig {
  return {
    windowDays: clampInt(doc?.windowDays, DEFAULT_CONFIG.windowDays, 1, 90),
    newCustomerDays: clampInt(doc?.newCustomerDays, DEFAULT_CONFIG.newCustomerDays, 1, 365),
    revenueDeclinePct: clampInt(doc?.revenueDeclinePct, DEFAULT_CONFIG.revenueDeclinePct, 1, 100),
  };
}
