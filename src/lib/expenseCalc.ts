import type { Expense, ExpenseCategory, ExpenseType } from '@/types';
import { EXPENSE_CATEGORIES } from '@/types';

// ─────────────────────────────────────────────────────────────────────
//  Pure helpers for the expense ledger. No Firebase imports — these
//  drive the Dashboard cost breakdown, Expenses page totals, and
//  Insights cost analysis, and are unit-tested in isolation via tsx.
//
//  Semantics by expense type:
//
//    • recurring   — no date. Accrues monthly. monthlyRecurringTotal
//                    sums the active ones; weeklyRecurringFromMonthly
//                    converts to a weekly accrual via the existing
//                    /4.33 month-to-week factor used by Payouts.
//    • one_time    — has a date. Counted in range-based totals only
//                    when its date falls in [startISO, endISO].
//    • job_linked  — has a date AND a jobId. Counted the same as
//                    one_time for business-net-profit math. The
//                    Dashboard / Job detail surfaces decide whether
//                    to ALSO reduce that job's profit (typically yes
//                    for parts purchases, no for tolls / gas).
//    • inventory   — has a date. Counted in range-based totals so
//                    bulk purchases reduce business net profit when
//                    they happen. The per-unit cost still flows into
//                    Job COGS via inventoryDeduction at job time —
//                    callers must subtract Inventory bucket from job
//                    COGS to avoid double-counting in business net
//                    profit (see businessNetProfit() below).
// ─────────────────────────────────────────────────────────────────────

/** Zero-initialized category bucket. */
function emptyByCategory(): Record<ExpenseCategory, number> {
  const out = {} as Record<ExpenseCategory, number>;
  for (const c of EXPENSE_CATEGORIES) out[c] = 0;
  return out;
}

/** Zero-initialized type bucket. */
function emptyByType(): Record<ExpenseType, number> {
  return { recurring: 0, one_time: 0, job_linked: 0, inventory: 0 };
}

export interface ExpenseTotals {
  total: number;
  byCategory: Record<ExpenseCategory, number>;
  byType: Record<ExpenseType, number>;
  count: number;
}

/**
 * Filter to non-recurring expenses with dates inside [startISO, endISO]
 * inclusive. Recurring expenses are excluded — they have no date and
 * are summed separately via monthlyRecurringTotal().
 *
 * Date strings are compared lexicographically; this works because we
 * store dates as YYYY-MM-DD (ISO 8601 sorts correctly as strings).
 */
export function filterExpensesInRange(
  expenses: Expense[],
  startISO: string,
  endISO: string,
): Expense[] {
  return expenses.filter((e) => {
    const type = e.type || 'recurring';
    if (type === 'recurring') return false;
    if (!e.date) return false;
    return e.date >= startISO && e.date <= endISO;
  });
}

/**
 * Sum all ACTIVE recurring expenses into a single monthly total.
 * Mirrors monthlyFixed() but at this pure-module layer for callers
 * that don't have a full Settings object.
 */
export function monthlyRecurringTotal(expenses: Expense[]): number {
  return expenses
    .filter((e) => (e.type || 'recurring') === 'recurring' && e.active !== false)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
}

/** monthly / 4.33 — same conversion Payouts already uses. */
export function weeklyRecurringFromMonthly(monthly: number): number {
  return monthly / 4.33;
}

/**
 * Sum non-recurring expenses (one_time + job_linked + inventory) in
 * a date range, grouped by category AND by type.
 */
export function expenseTotalsInRange(
  expenses: Expense[],
  startISO: string,
  endISO: string,
): ExpenseTotals {
  const subset = filterExpensesInRange(expenses, startISO, endISO);
  const byCategory = emptyByCategory();
  const byType = emptyByType();
  let total = 0;
  for (const e of subset) {
    const cat  = e.category || 'other';
    const type = e.type     || 'recurring';
    const amt  = Number(e.amount || 0);
    byCategory[cat] += amt;
    byType[type]    += amt;
    total           += amt;
  }
  return { total, byCategory, byType, count: subset.length };
}

/**
 * Sum all expenses (recurring + one-time + job-linked + inventory)
 * for a date range. Recurring is prorated by days-in-range against a
 * 30.44-day month (matches the /4.33 weekly conversion already in
 * Payouts: 30.44 / 7 ≈ 4.35; the existing /4.33 is preserved for
 * weekly calls via weeklyRecurringFromMonthly).
 *
 * For arbitrary ranges (used by Insights), we prorate linearly.
 */
export function totalExpensesInRange(
  expenses: Expense[],
  startISO: string,
  endISO: string,
  options: { includeRecurring?: boolean } = {},
): number {
  const rangeBreakdown = expenseTotalsInRange(expenses, startISO, endISO);
  let total = rangeBreakdown.total;
  if (options.includeRecurring !== false) {
    const start = Date.parse(startISO + 'T12:00:00Z');
    const end   = Date.parse(endISO   + 'T12:00:00Z');
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      const days = (end - start) / 86_400_000 + 1;
      const monthly = monthlyRecurringTotal(expenses);
      total += monthly * (days / 30.44);
    }
  }
  return total;
}

/**
 * Job Profit — per the Phase-1 spec, this is the per-job profitability
 * metric callers already compute via jobGrossProfit() in utils.ts. We
 * re-export the formula here as a label-only doc so the boundary
 * between "job profit" and "business net profit" is visible to
 * anyone reading expenseCalc.ts.
 *
 *   jobProfit(j) = revenue - tireCost - materialCost - travelCost
 *
 * NOT subtracted at the job layer:
 *   - recurring fixed costs
 *   - one-time or inventory-purchase expenses
 *
 * These belong to business-level math (below), not job-level math.
 */

/**
 * Business Net Profit for a date range.
 *
 *   netProfit = jobsProfitSum
 *             - one_time     expenses in range
 *             - job_linked   expenses in range
 *             - inventory    expenses in range
 *             - recurring    prorated to the range (if includeRecurring)
 *
 * jobsProfitSum is the sum of per-job gross profit (revenue - direct
 * cost) for the same range — the caller computes that with their
 * existing weekSummary / jobGrossProfit machinery and passes it in.
 *
 * This keeps the formula explicit and testable, and prevents the
 * "double-count inventory" trap: per-unit cost is already inside
 * jobsProfitSum via the existing tireCost flow, so the function
 * accepts an explicit `inventoryAlreadyInJobs` flag that lets the
 * caller decide whether to subtract the Inventory bucket on top.
 *
 * Default behavior: do NOT subtract the Inventory bucket on top
 * (set to true), matching the current pattern where inventory cost
 * is already reflected in per-job tireCost / materialCost.
 */
export interface NetProfitInput {
  jobsProfitSum: number;
  expenses: Expense[];
  startISO: string;
  endISO: string;
  includeRecurring?: boolean;
  /** When true (default), inventory purchases are NOT double-subtracted.
   *  Set to false if you genuinely want bulk inventory purchases to hit
   *  net profit independently of per-job COGS (rare). */
  inventoryAlreadyInJobs?: boolean;
}

export function businessNetProfit(input: NetProfitInput): number {
  const includeRecurring = input.includeRecurring !== false;
  const inventoryAlreadyInJobs = input.inventoryAlreadyInJobs !== false;

  const breakdown = expenseTotalsInRange(
    input.expenses, input.startISO, input.endISO,
  );

  let expenseHit = breakdown.byType.one_time
                 + breakdown.byType.job_linked;
  if (!inventoryAlreadyInJobs) {
    expenseHit += breakdown.byType.inventory;
  }

  if (includeRecurring) {
    const start = Date.parse(input.startISO + 'T12:00:00Z');
    const end   = Date.parse(input.endISO   + 'T12:00:00Z');
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      const days = (end - start) / 86_400_000 + 1;
      const monthly = monthlyRecurringTotal(input.expenses);
      expenseHit += monthly * (days / 30.44);
    }
  }

  return input.jobsProfitSum - expenseHit;
}
