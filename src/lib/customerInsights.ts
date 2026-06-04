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
