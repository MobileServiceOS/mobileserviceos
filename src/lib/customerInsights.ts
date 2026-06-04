// src/lib/customerInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure derive helpers used by:
//    - upsertCustomerFromJob (SP1)
//    - CustomerInsightsCard  (SP3)
//    - onJobWriteCustomerRollup Cloud Function (SP3)
//
//  Spec: §"VIP tier derivation", §"customerStatus derivation"
// ═══════════════════════════════════════════════════════════════════

/**
 * Revenue-tier badge. Boundaries match the spec exactly:
 *   Standard:  $0 – $999
 *   Gold:      $1,000 – $2,499
 *   Platinum:  $2,500+
 * Negative input defensively returns Standard.
 */
export function deriveVipTier(lifetimeRevenue: number): 'Standard' | 'Gold' | 'Platinum' {
  if (!Number.isFinite(lifetimeRevenue) || lifetimeRevenue < 1000) return 'Standard';
  if (lifetimeRevenue >= 2500) return 'Platinum';
  return 'Gold';
}

/**
 * Status derivation. v1 returns Active / Inactive only; the manual
 * 'VIP', 'Fleet', 'Archived' values are operator-set on the doc and
 * are returned unchanged by callers that pre-check them. Inactive is
 * defined as no job in the last 12 months.
 */
export function deriveCustomerStatus(
  args: { lastJobAt?: string },
): 'Active' | 'Inactive' {
  if (!args.lastJobAt) return 'Active';
  const last = Date.parse(args.lastJobAt);
  if (!Number.isFinite(last)) return 'Active';
  const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  return last >= twelveMonthsAgo ? 'Active' : 'Inactive';
}

// ─── Mode-over-bounded-jobs helpers (SP3) ────────────────────────
// Used by CustomerInsightsCard for the 3 "computed live" metrics.
// Input is the bounded (limit 100) recent-jobs array per spec
// §"Insights jobs-load bound" — callers MUST NOT pass unbounded jobs.

type JobLite = {
  vehicleMakeModel?: string;
  tireSize?: string;
  service?: string;
};

function _mode<T extends string>(values: Array<T | undefined | null>): T | null {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

export function computeMostCommonVehicle(jobs: JobLite[]): string | null {
  return _mode(jobs.map(j => j.vehicleMakeModel));
}
export function computeMostCommonTireSize(jobs: JobLite[]): string | null {
  return _mode(jobs.map(j => j.tireSize));
}
export function computeMostCommonServiceType(jobs: JobLite[]): string | null {
  return _mode(jobs.map(j => j.service));
}

// ─── VIP tier progress (SP3) ─────────────────────────────────────
// Returns the next-tier hint rendered under the VIP badge.
// Spec §"Progress-to-next-tier UX (v2 — review-pass)".

export interface VipProgress {
  nextTier: 'Gold' | 'Platinum' | null;
  remaining: number;
}

export function deriveVipProgress(lifetimeRevenue: number): VipProgress {
  const rev = Number.isFinite(lifetimeRevenue) ? Math.max(0, lifetimeRevenue) : 0;
  if (rev < 1000)  return { nextTier: 'Gold',     remaining: 1000 - rev };
  if (rev < 2500)  return { nextTier: 'Platinum', remaining: 2500 - rev };
  return { nextTier: null, remaining: 0 };
}
