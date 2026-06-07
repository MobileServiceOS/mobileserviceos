// src/lib/bandilero/services/revenue.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Revenue service (DETERMINISTIC, no LLM).
//
//  Every value traces to real jobs. Matches the existing app
//  convention exactly: revenue counts only status === 'Completed'
//  jobs, keyed on Job.date (the 'YYYY-MM-DD' service date), Cancelled
//  excluded by virtue of the Completed filter. Reconciles with
//  Dashboard's todayTotals / weekSummary.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';
import { type Metric, live } from '../confidence';
import { addDays } from '../time';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const isCompleted = (j: Job): boolean => j.status === 'Completed';

/** Sum of completed-job revenue for a single 'YYYY-MM-DD' date. LIVE. */
export function revenueForDate(jobs: ReadonlyArray<Job>, dateISO: string): Metric<number> {
  const total = round2(
    (jobs || [])
      .filter((j) => isCompleted(j) && j.date === dateISO)
      .reduce((t, j) => t + (Number(j.revenue) || 0), 0),
  );
  return live(total, 'jobs', dateISO);
}

export interface RevenueComparison {
  today: Metric<number>;
  yesterday: Metric<number>;
  /** Percent change today vs yesterday, or null when undefined (no
   *  yesterday baseline). */
  deltaPct: number | null;
}

/** Revenue today vs yesterday + delta %. Both legs LIVE. */
export function revenueTodayVsYesterday(jobs: ReadonlyArray<Job>, today: string): RevenueComparison {
  const todayM = revenueForDate(jobs, today);
  const yesterdayM = revenueForDate(jobs, addDays(today, -1));
  const t = todayM.value ?? 0;
  const y = yesterdayM.value ?? 0;
  const deltaPct = y > 0 ? round2(((t - y) / y) * 100) : null;
  return { today: todayM, yesterday: yesterdayM, deltaPct };
}

export interface DayRevenue {
  date: string;
  revenue: number;
}

/** Daily completed-revenue series for the last `days` days (oldest → newest). */
export function dailyRevenueSeries(jobs: ReadonlyArray<Job>, today: string, days: number): DayRevenue[] {
  const n = Math.max(1, Math.floor(days));
  // Bucket once: O(jobs), then read per day.
  const byDate = new Map<string, number>();
  for (const j of jobs || []) {
    if (!isCompleted(j) || !j.date) continue;
    byDate.set(j.date, (byDate.get(j.date) || 0) + (Number(j.revenue) || 0));
  }
  const out: DayRevenue[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ date: d, revenue: round2(byDate.get(d) || 0) });
  }
  return out;
}

/**
 * Mean ticket across completed jobs with positive revenue. Used as the
 * basis for the missed-call lost-revenue ESTIMATE. Returns 0 when there
 * are no qualifying jobs (caller decides whether the estimate is even
 * meaningful — a 0 avg ticket yields a $0 estimate, not a fake number).
 */
export function averageTicket(jobs: ReadonlyArray<Job>): number {
  const completed = (jobs || []).filter((j) => isCompleted(j) && (Number(j.revenue) || 0) > 0);
  if (completed.length === 0) return 0;
  const sum = completed.reduce((t, j) => t + (Number(j.revenue) || 0), 0);
  return round2(sum / completed.length);
}
