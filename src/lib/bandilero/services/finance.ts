// src/lib/bandilero/services/finance.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Finance service (DETERMINISTIC, no LLM).
//
//  Reuses the canonical MSOS profit primitives so Bandilero can't drift
//  from Dashboard / Payouts:
//    • jobGrossProfit  (src/lib/utils.ts) — per-job revenue − directCost
//    • businessNetProfit (src/lib/expenseCalc.ts) — jobs profit − expenses
//
//  Range filtering is on Job.date (inclusive, 'YYYY-MM-DD' string compare,
//  which is chronologically correct for ISO dates), Completed jobs only.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { jobGrossProfit } from '@/lib/utils';
import { businessNetProfit } from '@/lib/expenseCalc';
import { type Metric, live } from '../confidence';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function completedInRange(jobs: ReadonlyArray<Job>, startISO: string, endISO: string): Job[] {
  return (jobs || []).filter(
    (j) => j.status === 'Completed' && !!j.date && j.date >= startISO && j.date <= endISO,
  );
}

/** Σ gross profit across completed jobs in [startISO, endISO]. LIVE. */
export function grossProfitForRange(
  jobs: ReadonlyArray<Job>,
  settings: Settings,
  startISO: string,
  endISO: string,
): Metric<number> {
  const sum = round2(
    completedInRange(jobs, startISO, endISO).reduce((t, j) => t + jobGrossProfit(j, settings), 0),
  );
  return live(sum, 'jobs', endISO);
}

/**
 * Business net profit for [startISO, endISO] = jobs gross profit minus
 * expenses (one-time + job-linked + prorated recurring), via the shared
 * businessNetProfit(). Inventory is treated as already-in-jobs (default)
 * to avoid double-subtracting per-unit COGS. LIVE.
 */
export function netProfitForRange(
  jobs: ReadonlyArray<Job>,
  settings: Settings,
  startISO: string,
  endISO: string,
): Metric<number> {
  const jobsProfitSum = completedInRange(jobs, startISO, endISO).reduce(
    (t, j) => t + jobGrossProfit(j, settings),
    0,
  );
  const net = round2(
    businessNetProfit({
      jobsProfitSum,
      expenses: settings.expenses || [],
      startISO,
      endISO,
    }),
  );
  return live(net, 'jobs+expenses', endISO);
}
