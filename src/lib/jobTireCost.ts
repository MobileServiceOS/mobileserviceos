// src/lib/jobTireCost.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure tire-cost decision for job save. Extracted verbatim from the
//  three inline branches inside App.tsx::saveJob so the money-critical
//  rule — what a job's stored tireCost becomes for each tire source —
//  is testable in isolation rather than buried in a 380-line callback.
//
//  Invariant (the convention every rollup depends on): the returned
//  value is the TOTAL tire cost for the job (qty already baked in),
//  matching computeFlatPrice / jobCOGS / weekSummary. Callers store it
//  straight onto job.tireCost.
//
//    Inventory          → weighted FIFO plan total (r2), else fallback
//    Bought for this job → tirePurchasePrice (PER-UNIT) × qty (r2),
//                          else fallback
//    Customer supplied   → 0 (customer brought their own)
//    anything else       → fallback (the job's existing tireCost)
// ═══════════════════════════════════════════════════════════════════

import { r2 } from '@/lib/round';
import type { TireSource } from '@/types';

export interface JobTireCostInput {
  tireSource: TireSource | string | undefined;
  /** PER-UNIT purchase price — only used for 'Bought for this job'. */
  tirePurchasePrice?: number | string;
  qty?: number | string;
  /** Weighted FIFO cost of the planned deduction — only used for
   *  'Inventory'. A 0/absent total means nothing was deductible, so the
   *  fallback applies. */
  fifoPlanTotal?: number;
  /** The job's existing tireCost — the value to keep when a source
   *  doesn't compute its own (no stock, no purchase price, etc.). */
  fallbackTireCost?: number | string;
}

/** Resolve a job's stored (TOTAL) tire cost from its tire source. Pure. */
export function computeJobTireCost(input: JobTireCostInput): number {
  const fallback = Number(input.fallbackTireCost || 0);

  if (input.tireSource === 'Inventory') {
    const total = Number(input.fifoPlanTotal || 0);
    return total > 0 ? r2(total) : fallback;
  }

  if (input.tireSource === 'Bought for this job') {
    const qty = Math.max(1, Math.floor(Number(input.qty) || 1));
    return Number(input.tirePurchasePrice)
      ? r2(Number(input.tirePurchasePrice) * qty)
      : fallback;
  }

  if (input.tireSource === 'Customer supplied') return 0;

  return fallback;
}
