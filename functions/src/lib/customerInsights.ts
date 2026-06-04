// functions/src/lib/customerInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  customerInsights — duplicate of src/lib/customerInsights.ts.
//  Functions cannot import from the client tree; the derive logic
//  must stay byte-identical so client-rendered tier badges match
//  server-recomputed values written by SP3 backfill + Task 14 trigger.
// ═══════════════════════════════════════════════════════════════════

export type VipTier = 'Standard' | 'Gold' | 'Platinum';
export type CustomerStatus = 'Active' | 'Inactive';

/** Spec thresholds: $1000 → Gold, $2500 → Platinum. */
export function deriveVipTier(lifetimeRevenue: number | undefined | null): VipTier {
  const rev = Number(lifetimeRevenue ?? 0);
  if (!Number.isFinite(rev) || rev < 1000) return 'Standard';
  if (rev < 2500) return 'Gold';
  return 'Platinum';
}

/** Inactive when last service > 365 days ago. */
export function deriveCustomerStatus(args: { lastJobAt?: string | null }): CustomerStatus {
  if (!args.lastJobAt) return 'Active';
  const last = Date.parse(args.lastJobAt);
  if (!Number.isFinite(last)) return 'Active';
  const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  return last >= twelveMonthsAgo ? 'Active' : 'Inactive';
}
