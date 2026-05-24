// src/lib/insights.ts
// ═══════════════════════════════════════════════════════════════════
//  Business analytics — pure derivation layer for the Insights page.
//
//  Everything is computed live from the job list. No stored
//  analytics, no migration. One entry point, computeInsights(),
//  so the page does a single call. Pure + side-effect free —
//  unit-tested in tests/insights.test.ts.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings, ExpenseCategory } from '@/types';
import { EXPENSE_CATEGORY_LABELS } from '@/types';
import { jobGrossProfit, resolvePaymentStatus, getWeekStart } from '@/lib/utils';
import { deriveCustomerProfiles } from '@/lib/customers';
import {
  expenseTotalsInRange,
  monthlyRecurringTotal,
  businessNetProfit,
} from '@/lib/expenseCalc';

export interface WeekPoint {
  weekStart: string;
  revenue: number;
  profit: number;
}
export interface ServiceStat {
  service: string;
  revenue: number;
  profit: number;
  count: number;
}
export interface SourceStat {
  source: string;
  revenue: number;
  count: number;
}
export interface CityStat {
  city: string;
  profit: number;
  count: number;
}
export type AgingBucket = '0-7d' | '8-30d' | '31-60d' | '60d+';
export interface AgingRow {
  bucket: AgingBucket;
  count: number;
  total: number;
}
export interface DailyJobStats {
  /** Created today, cancelled jobs excluded. */
  jobsToday: number;
  /** Created this week so far (week-anchor → today), cancelled excluded. */
  jobsThisWeek: number;
  /** Mean jobs/day across the 8-week trend window
   *  (total non-cancelled jobs ÷ 56). */
  avgPerDay: number;
  /** The single date in the current week with the most jobs.
   *  null when the week has no jobs. */
  bestDayThisWeek: { date: string; count: number } | null;
  /** Service with the most jobs today. null when no jobs today. */
  busiestServiceToday: { service: string; count: number } | null;
}

export interface CategoryStat {
  category: ExpenseCategory;
  label: string;
  total: number;
}

export interface ExpensePoint {
  weekStart: string;
  total: number;
}

export interface ExpenseAnalysis {
  /** Spend by category over the 8-week window, sorted desc.
   *  Only includes non-recurring buckets (one_time / job_linked /
   *  inventory) — recurring carries no category in legacy data. */
  topCategoriesByCost: CategoryStat[];
  /** Sum of active recurring expenses per month. */
  monthlyRecurringBurden: number;
  /** Weekly TOTAL expense (job COGS + non-recurring + recurring
   *  prorated) for each of the last 8 weeks. Zero-filled. Sorted
   *  oldest → newest to match revenueTrend. */
  weeklyExpenseTrend: ExpensePoint[];
  /** Business net profit summed across the 8-week trend window:
   *  jobs gross profit minus expenses (per businessNetProfit()). */
  netProfit8w: number;
}

export interface Insights {
  /** Last 8 weeks, oldest → newest, zero-filled. */
  revenueTrend: WeekPoint[];
  /** Service types ranked by total profit, highest first. */
  topServices: ServiceStat[];
  /** Lead sources ranked by total revenue, highest first. */
  topSources: SourceStat[];
  /** Cities ranked by total profit, highest first. */
  topCities: CityStat[];
  repeat: { total: number; repeat: number; pct: number };
  /** Unpaid jobs bucketed by age. Always all 4 buckets, in order. */
  unpaidAging: AgingRow[];
  /** Today + this-week job counts + busiest service + best day. */
  dailyJobs: DailyJobStats;
  /** Expense breakdown over the 8-week window. */
  expenseAnalysis: ExpenseAnalysis;
}

const TREND_WEEKS = 8;

/** Days between two YYYY-MM-DD dates (a - b), floored, non-negative. */
function daysBetween(a: string, b: string): number {
  const ta = new Date(a + 'T12:00:00').getTime();
  const tb = new Date(b + 'T12:00:00').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.max(0, Math.floor((ta - tb) / 86_400_000));
}

function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 7) return '0-7d';
  if (ageDays <= 30) return '8-30d';
  if (ageDays <= 60) return '31-60d';
  return '60d+';
}

export function computeInsights(
  jobs: ReadonlyArray<Job>,
  settings: Settings,
  today: string,
): Insights {
  const list = jobs || [];
  const weekStartDay =
    typeof settings.workWeekStartDay === 'number' ? settings.workWeekStartDay : 1;

  // ── Revenue trend — last 8 weeks, zero-filled ───────────────────
  // Build the 8 expected week-start keys ending with this week, so
  // a quiet week still renders as a zero bar (stable chart).
  const thisWeek = getWeekStart(today, weekStartDay);
  const weekKeys: string[] = [];
  {
    const d = new Date(thisWeek + 'T12:00:00');
    for (let i = TREND_WEEKS - 1; i >= 0; i--) {
      const w = new Date(d);
      w.setDate(w.getDate() - i * 7);
      weekKeys.push(w.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
    }
  }
  const trendMap = new Map<string, WeekPoint>();
  for (const k of weekKeys) trendMap.set(k, { weekStart: k, revenue: 0, profit: 0 });

  // ── Single pass for the rankings + trend ────────────────────────
  const svc = new Map<string, ServiceStat>();
  const src = new Map<string, SourceStat>();
  const cty = new Map<string, CityStat>();
  const aging = new Map<AgingBucket, AgingRow>([
    ['0-7d', { bucket: '0-7d', count: 0, total: 0 }],
    ['8-30d', { bucket: '8-30d', count: 0, total: 0 }],
    ['31-60d', { bucket: '31-60d', count: 0, total: 0 }],
    ['60d+', { bucket: '60d+', count: 0, total: 0 }],
  ]);

  for (const j of list) {
    const revenue = Number(j.revenue || 0);
    const profit = jobGrossProfit(j, settings);

    // Trend — only weeks inside the 8-week window count.
    if (j.date) {
      const wk = getWeekStart(j.date, weekStartDay);
      const point = trendMap.get(wk);
      if (point) {
        point.revenue += revenue;
        point.profit += profit;
      }
    }

    // Top services — by profit.
    const sName = (j.service || '').trim() || 'Other';
    const s = svc.get(sName) || { service: sName, revenue: 0, profit: 0, count: 0 };
    s.revenue += revenue; s.profit += profit; s.count += 1;
    svc.set(sName, s);

    // Top lead sources — by revenue.
    const srcName = (j.source || '').trim() || 'Unknown';
    const so = src.get(srcName) || { source: srcName, revenue: 0, count: 0 };
    so.revenue += revenue; so.count += 1;
    src.set(srcName, so);

    // Top cities — by profit.
    const cName =
      (j.city || '').trim() ||
      (j.fullLocationLabel || '').trim() ||
      (j.area || '').trim();
    if (cName) {
      const c = cty.get(cName) || { city: cName, profit: 0, count: 0 };
      c.profit += profit; c.count += 1;
      cty.set(cName, c);
    }

    // Unpaid aging.
    if (resolvePaymentStatus(j) !== 'Paid' && j.date) {
      const row = aging.get(bucketFor(daysBetween(today, j.date)));
      if (row) { row.count += 1; row.total += revenue; }
    }
  }

  // ── Repeat-customer rate ────────────────────────────────────────
  const profiles = deriveCustomerProfiles(list, settings);
  const repeatCount = profiles.filter((p) => p.isRepeat).length;
  const total = profiles.length;

  // ── Daily job stats (Phase 5) ───────────────────────────────────
  // Cancelled jobs are deliberately excluded so they can't inflate
  // today / this-week / busiest-service counts.
  const liveJobs = list.filter((j) => j.status !== 'Cancelled');
  const todayJobs    = liveJobs.filter((j) => j.date === today);
  const thisWeekJobs = liveJobs.filter((j) => j.date && getWeekStart(j.date, weekStartDay) === thisWeek);

  // Best day this week — count by date, pick max.
  const dayCounts = new Map<string, number>();
  for (const j of thisWeekJobs) dayCounts.set(j.date, (dayCounts.get(j.date) || 0) + 1);
  let bestDay: { date: string; count: number } | null = null;
  for (const [date, count] of dayCounts) {
    if (!bestDay || count > bestDay.count) bestDay = { date, count };
  }

  // Busiest service today.
  const todayServices = new Map<string, number>();
  for (const j of todayJobs) {
    const s = (j.service || '').trim() || 'Other';
    todayServices.set(s, (todayServices.get(s) || 0) + 1);
  }
  let busiestService: { service: string; count: number } | null = null;
  for (const [service, count] of todayServices) {
    if (!busiestService || count > busiestService.count) busiestService = { service, count };
  }

  // Trend-window job count for avg / day.
  const trendJobsCount = liveJobs.filter((j) => j.date && weekKeys.includes(getWeekStart(j.date, weekStartDay))).length;
  const avgPerDay = trendJobsCount / (TREND_WEEKS * 7);

  const dailyJobs: DailyJobStats = {
    jobsToday: todayJobs.length,
    jobsThisWeek: thisWeekJobs.length,
    avgPerDay,
    bestDayThisWeek: bestDay,
    busiestServiceToday: busiestService,
  };

  // ── Expense analysis (Phase 5) ──────────────────────────────────
  const expenses = settings.expenses || [];
  const earliestKey = weekKeys[0];
  const latestKey = weekKeys[weekKeys.length - 1];
  // 8-week window range = first week's start through today, inclusive.
  // End at `today` (not the synthetic end-of-week) so we don't claim
  // future days yet to happen.
  const range8w = expenseTotalsInRange(expenses, earliestKey, today);

  // Top categories: filter to non-zero, sort desc.
  const topCategoriesByCost: CategoryStat[] = (Object.keys(range8w.byCategory) as ExpenseCategory[])
    .map((cat) => ({
      category: cat,
      label: EXPENSE_CATEGORY_LABELS[cat],
      total: range8w.byCategory[cat],
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // Weekly expense trend — one bucket per week in the 8-week window.
  const weeklyExpenseTrend: ExpensePoint[] = weekKeys.map((wk, i) => {
    // End of this bucket = start of next bucket - 1 day, OR today.
    const endKey = i < weekKeys.length - 1 ? prevDayKey(weekKeys[i + 1]) : today;
    const bucket = expenseTotalsInRange(expenses, wk, endKey);
    const recurringPortion = (() => {
      const start = Date.parse(wk + 'T12:00:00Z');
      const end   = Date.parse(endKey + 'T12:00:00Z');
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
      const days = (end - start) / 86_400_000 + 1;
      return monthlyRecurringTotal(expenses) * (days / 30.44);
    })();
    // Also include job COGS that fell in this week (per-job tireCost
    // etc — the "job costs" bucket the dashboard surfaces).
    const wkJobCost = (() => {
      let sum = 0;
      for (const j of list) {
        if (!j.date || j.status === 'Cancelled') continue;
        if (getWeekStart(j.date, weekStartDay) !== wk) continue;
        sum += Number(j.revenue || 0) - jobGrossProfit(j, settings);
      }
      return Math.max(0, sum);
    })();
    return {
      weekStart: wk,
      total: bucket.total + recurringPortion + wkJobCost,
    };
  });

  // Business net profit across the trend window.
  // jobsProfitSum = sum of trend revenue profit. (revenueTrend has
  // .profit per week; sum them.)
  const trendProfitSum = weekKeys
    .map((k) => trendMap.get(k)?.profit || 0)
    .reduce((s, p) => s + p, 0);
  const netProfit8w = businessNetProfit({
    jobsProfitSum: trendProfitSum,
    expenses,
    startISO: earliestKey,
    endISO: latestKey >= today ? today : latestKey,
  });

  const expenseAnalysis: ExpenseAnalysis = {
    topCategoriesByCost,
    monthlyRecurringBurden: monthlyRecurringTotal(expenses),
    weeklyExpenseTrend,
    netProfit8w,
  };

  return {
    revenueTrend: weekKeys.map((k) => trendMap.get(k) as WeekPoint),
    topServices: Array.from(svc.values()).sort((a, b) => b.profit - a.profit),
    topSources: Array.from(src.values()).sort((a, b) => b.revenue - a.revenue),
    topCities: Array.from(cty.values()).sort((a, b) => b.profit - a.profit),
    repeat: {
      total,
      repeat: repeatCount,
      pct: total > 0 ? Math.round((repeatCount / total) * 100) : 0,
    },
    unpaidAging: ['0-7d', '8-30d', '31-60d', '60d+'].map(
      (b) => aging.get(b as AgingBucket) as AgingRow,
    ),
    dailyJobs,
    expenseAnalysis,
  };
}

/** Helper: subtract one day from an ISO date (YYYY-MM-DD), keeping
 *  the same format. Used to compute per-week range ends. */
function prevDayKey(k: string): string {
  const d = new Date(k + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
