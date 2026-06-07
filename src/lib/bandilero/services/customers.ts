// src/lib/bandilero/services/customers.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Customer service (DETERMINISTIC, no LLM).
//
//  Reuses computeInsights() (src/lib/insights.ts) which derives repeat
//  vs. one-time customers from the real job list. LIVE — Cancelled jobs
//  are excluded upstream by computeInsights.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { computeInsights, type Insights } from '@/lib/insights';
import { type Metric, live } from '../confidence';

export interface RepeatMetrics {
  total: Metric<number>;
  repeat: Metric<number>;
  pct: Metric<number>;
}

/** Repeat-customer metrics from an already-computed Insights bundle. */
export function repeatMetricsFromInsights(ins: Insights, asOf?: string): RepeatMetrics {
  return {
    total: live(ins.repeat.total, 'customers', asOf),
    repeat: live(ins.repeat.repeat, 'customers', asOf),
    pct: live(ins.repeat.pct, 'customers', asOf),
  };
}

/** Convenience: compute repeat metrics straight from jobs. */
export function repeatMetrics(jobs: ReadonlyArray<Job>, settings: Settings, today: string): RepeatMetrics {
  return repeatMetricsFromInsights(computeInsights(jobs, settings, today), today);
}
