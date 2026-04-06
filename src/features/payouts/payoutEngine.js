// src/features/payouts/payoutEngine.js
import { getWeekStart } from '../../utils/index.js';

/**
 * Group items (jobs or expenses) by weekKey.
 * @param {Array} items - must have .weekKey or .date field
 * @param {number} weekStartDay
 */
export function groupByWeek(items, weekStartDay = 5) {
  const map = {};
  items.forEach(item => {
    const wk = item.weekKey || getWeekStart(item.date, weekStartDay);
    if (!map[wk]) map[wk] = [];
    map[wk].push(item);
  });
  return map;
}

/**
 * Compute a full weekly payout summary.
 *
 * COST SEPARATION:
 * - job.pricing.materialCost + otherJobCost + laborCost + travelCost = per-job costs
 * - expenses = separate variable business expenses
 * - weeklyOverhead = applied ONCE at summary level, never per job
 */
export function computeWeeklySummary(jobs = [], expenses = [], payoutConfig = {}) {
  const {
    weeklyOverhead    = 0,
    overheadMode      = 'weekly_fixed',
    team              = [],
    monthlyOverhead   = 0,
  } = payoutConfig;

  // Revenue
  const revenue = jobs.reduce((s, j) => s + (j.pricing?.revenue || 0), 0);

  // Job-level costs
  const materialCosts  = jobs.reduce((s, j) => s + (j.pricing?.materialCost  || 0), 0);
  const otherJobCosts  = jobs.reduce((s, j) => s + (j.pricing?.otherJobCost  || 0), 0);
  const laborCosts     = jobs.reduce((s, j) => s + (j.pricing?.laborCost     || 0), 0);
  const travelCosts    = jobs.reduce((s, j) => s + (j.pricing?.travelCost    || 0), 0);
  const totalJobCosts  = materialCosts + otherJobCosts + laborCosts + travelCosts;

  // Variable expenses
  const variableExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  // Overhead — applied ONCE per week
  let overhead = 0;
  if (overheadMode === 'weekly_fixed') {
    overhead = weeklyOverhead;
  } else if (overheadMode === 'accrued') {
    const uniqueDays   = new Set(jobs.map(j => j.date)).size;
    const dailyRate    = (monthlyOverhead || 0) / 30;
    overhead           = dailyRate * uniqueDays;
  }

  // Distributable profit (never negative)
  const rawProfit      = revenue - totalJobCosts - variableExpenses - overhead;
  const distributable  = Math.max(0, rawProfit);

  // Payout shares — only profit_percentage + active members
  const profitMembers  = team.filter(m => m.active && m.payType === 'profit_percentage');
  const totalPct       = profitMembers.reduce((s, m) => s + (m.value || 0), 0);
  const ownerPayouts   = profitMembers.map(m => ({
    ...m,
    amount: distributable > 0
      ? parseFloat((distributable * (m.value / 100)).toFixed(2))
      : 0,
  }));

  return {
    revenue:            parseFloat(revenue.toFixed(2)),
    materialCosts:      parseFloat(materialCosts.toFixed(2)),
    otherJobCosts:      parseFloat(otherJobCosts.toFixed(2)),
    laborCosts:         parseFloat(laborCosts.toFixed(2)),
    travelCosts:        parseFloat(travelCosts.toFixed(2)),
    totalJobCosts:      parseFloat(totalJobCosts.toFixed(2)),
    variableExpenses:   parseFloat(variableExpenses.toFixed(2)),
    overhead:           parseFloat(overhead.toFixed(2)),
    rawProfit:          parseFloat(rawProfit.toFixed(2)),
    distributableProfit:parseFloat(distributable.toFixed(2)),
    ownerPayouts,
    totalPct,
    jobCount:           jobs.length,
    miles:              jobs.reduce((s, j) => s + (j.travel?.miles || 0), 0),
  };
}

/**
 * Build a snapshot document for saving to Firestore.
 */
export function buildPayoutSnapshot(weekKey, jobs, expenses, payoutConfig) {
  const summary = computeWeeklySummary(jobs, expenses, payoutConfig);
  return {
    weekKey,
    weekEnd:    addDays(weekKey, 6),
    ...summary,
    isPaid:     false,
    createdAt:  new Date(),
  };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
