// src/lib/bandilero/services/financeIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Revenue / Finance Intelligence (DETERMINISTIC, no LLM).
//
//  A dedicated financial view built ENTIRELY from existing jobs +
//  expenses, reusing the canonical app math so the numbers reconcile
//  exactly with Dashboard / Payouts:
//    • jobGrossProfit / monthlyFixed            (src/lib/utils.ts)
//    • businessNetProfit / totalExpensesInRange  (src/lib/expenseCalc.ts)
//    • computeInsights.revenueTrend/expenseAnalysis (src/lib/insights.ts)
//  The weekly distributable + owner split mirror Payouts.tsx precisely.
//  All LIVE — financial, so the panel is owner/admin-gated.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Settings } from '@/types';
import { getWeekStart, getMonth, jobGrossProfit, monthlyFixed } from '@/lib/utils';
import { businessNetProfit, totalExpensesInRange } from '@/lib/expenseCalc';
import { computeInsights, type WeekPoint } from '@/lib/insights';
import { type Metric, live } from '../confidence';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
const isCompleted = (j: Job): boolean => j.status === 'Completed';

export interface OwnerShare { name: string; pct: number; amount: number; }
export interface ExpenseRow { label: string; total: number; }
export interface RevenueRow { label: string; total: number; }

/** Sum completed-job revenue grouped by a key, top-N descending. */
function revenueBy(completed: ReadonlyArray<Job>, pick: (j: Job) => string, topN = 6): RevenueRow[] {
  const m = new Map<string, number>();
  for (const j of completed) {
    const label = (pick(j) || '').trim() || 'Unassigned';
    m.set(label, (m.get(label) || 0) + (Number(j.revenue) || 0));
  }
  return Array.from(m.entries())
    .map(([label, total]) => ({ label, total: round2(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);
}

export interface FinanceIntel {
  revenueToday: Metric<number>;
  revenueWeek: Metric<number>;
  revenueMonth: Metric<number>;
  profitToday: Metric<number>;
  grossProfitWeek: Metric<number>;
  netProfitMonth: Metric<number>;
  // Revenue breakdowns (month-to-date completed jobs).
  revenueByService: RevenueRow[];
  revenueByCity: RevenueRow[];
  revenueByCustomer: RevenueRow[];
  revenueByTechnician: RevenueRow[];
  monthlyRecurring: Metric<number>;
  expensesMonth: Metric<number>;
  /** Weekly distributable (net − tax reserve) — reconciles with Payouts. */
  distributableWeek: Metric<number>;
  ownerShares: OwnerShare[];
  topExpenseCategories: ExpenseRow[];
  /** 8-week revenue + profit trend (oldest → newest). */
  revenueTrend: WeekPoint[];
}

export function financeIntel(jobs: ReadonlyArray<Job>, settings: Settings, today: string): FinanceIntel {
  const weekStartDay = typeof settings.workWeekStartDay === 'number' ? settings.workWeekStartDay : 1;
  const thisWeek = getWeekStart(today, weekStartDay);
  const month = getMonth(today);
  const monthStart = today.slice(0, 7) + '-01';
  const completed = (jobs || []).filter(isCompleted);

  // ── Revenue ──────────────────────────────────────────────────────
  const sumRev = (pred: (j: Job) => boolean) =>
    round2(completed.filter(pred).reduce((t, j) => t + (Number(j.revenue) || 0), 0));
  const revenueToday = sumRev((j) => j.date === today);
  const revenueMonth = sumRev((j) => getMonth(j.date) === month);
  const profitToday = round2(
    completed.filter((j) => j.date === today).reduce((t, j) => t + jobGrossProfit(j, settings), 0),
  );

  // Revenue breakdowns over month-to-date completed jobs.
  const monthJobs = completed.filter((j) => getMonth(j.date) === month);
  const revenueByService = revenueBy(monthJobs, (j) => j.service);
  const revenueByCity = revenueBy(monthJobs, (j) => j.city || '');
  const revenueByCustomer = revenueBy(monthJobs, (j) => j.customerName || j.customerPhone || '');
  const revenueByTechnician = revenueBy(monthJobs, (j) => j.assignedToUid || j.createdByUid || '');

  // ── Weekly profit + distributable (mirrors Payouts.tsx exactly) ──
  const weekJobs = completed.filter((j) => getWeekStart(j.date, weekStartDay) === thisWeek);
  const revenueWeek = round2(weekJobs.reduce((t, j) => t + (Number(j.revenue) || 0), 0));
  const weekProfit = round2(weekJobs.reduce((t, j) => t + jobGrossProfit(j, settings), 0));
  const thisWeekEnd = (() => {
    const dt = new Date(thisWeek + 'T12:00:00');
    dt.setDate(dt.getDate() + 6);
    return dt.toLocaleDateString('en-CA');
  })();
  const netWeekly = businessNetProfit({
    jobsProfitSum: weekProfit, expenses: settings.expenses || [], startISO: thisWeek, endISO: thisWeekEnd,
  });
  const taxReserve = netWeekly * Number(settings.taxRate || 0) / 100;
  const distributable = round2(netWeekly - taxReserve);

  const o1 = settings.owner1Active ? Number(settings.profitSplit1 || 0) : 0;
  const o2 = settings.owner2Active ? Number(settings.profitSplit2 || 0) : 0;
  const totalShare = o1 + o2 || 100;
  const ownerShares: OwnerShare[] = [];
  if (o1 > 0) ownerShares.push({ name: settings.owner1Name || 'Owner 1', pct: o1, amount: round2(distributable * (o1 / totalShare)) });
  if (o2 > 0) ownerShares.push({ name: settings.owner2Name || 'Owner 2', pct: o2, amount: round2(distributable * (o2 / totalShare)) });

  // ── Month net + expenses ─────────────────────────────────────────
  const monthGross = round2(
    completed.filter((j) => getMonth(j.date) === month).reduce((t, j) => t + jobGrossProfit(j, settings), 0),
  );
  const netProfitMonth = round2(businessNetProfit({
    jobsProfitSum: monthGross, expenses: settings.expenses || [], startISO: monthStart, endISO: today,
  }));
  const expensesMonth = round2(totalExpensesInRange(settings.expenses || [], monthStart, today));

  // ── Trend + top expense categories (reuse computeInsights) ───────
  const insights = computeInsights(jobs, settings, today);
  const topExpenseCategories: ExpenseRow[] = insights.expenseAnalysis.topCategoriesByCost
    .slice(0, 5)
    .map((c) => ({ label: c.label, total: round2(c.total) }));

  return {
    revenueToday: live(revenueToday, 'jobs', today),
    revenueWeek: live(revenueWeek, 'jobs', today),
    revenueMonth: live(revenueMonth, 'jobs', today),
    profitToday: live(profitToday, 'jobs', today),
    revenueByService,
    revenueByCity,
    revenueByCustomer,
    revenueByTechnician,
    grossProfitWeek: live(weekProfit, 'jobs', today),
    netProfitMonth: live(netProfitMonth, 'jobs+expenses', today),
    monthlyRecurring: live(round2(monthlyFixed(settings)), 'expenses', today),
    expensesMonth: live(expensesMonth, 'expenses', today),
    distributableWeek: live(distributable, 'jobs+expenses', today),
    ownerShares,
    topExpenseCategories,
    revenueTrend: insights.revenueTrend,
  };
}
