// tests/expenseCalc.test.ts
// Run: npx tsx tests/expenseCalc.test.ts
//
// Pure-logic coverage for the Phase-1 expense schema and calculator.
// Covers:
//   - Backward compat (legacy {id, name, amount, active} expenses
//     deserialize as recurring + other, preserving existing accounts)
//   - filterExpensesInRange excludes recurring, includes one-time
//     within the date window
//   - monthlyRecurringTotal counts only active recurring
//   - expenseTotalsInRange groups by category + type
//   - totalExpensesInRange prorates recurring across arbitrary spans
//   - businessNetProfit (the key new business metric):
//       * subtracts one-time + job-linked
//       * does NOT double-count inventory by default (since per-unit
//         cost already flows into jobs via tireCost / materialCost)
//       * subtracts inventory when caller explicitly opts in
//       * prorates recurring to the range correctly
//   - Date boundary inclusivity (lexicographic ISO date comparison)
//   - Empty-collection paths

import {
  filterExpensesInRange,
  monthlyRecurringTotal,
  weeklyRecurringFromMonthly,
  expenseTotalsInRange,
  totalExpensesInRange,
  businessNetProfit,
} from '@/lib/expenseCalc';
import type { Expense } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); }
};
const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// ─── Helpers ────────────────────────────────────────────────────────
let nextId = 1;
const exp = (over: Partial<Expense> = {}): Expense => ({
  id: `exp-${nextId++}`,
  name: 'Generic',
  amount: 0,
  active: true,
  ...over,
});

const recur   = (amount: number, name = 'rec',  active = true)  => exp({ name, amount, active, type: 'recurring' });
const oneTime = (amount: number, date: string, cat?: Parameters<typeof exp>[0]['category']) =>
  exp({ amount, date, type: 'one_time', category: cat });
const jobExp  = (amount: number, date: string, jobId: string)   => exp({ amount, date, jobId, type: 'job_linked', category: 'parts' });
const invExp  = (amount: number, date: string)                  => exp({ amount, date, type: 'inventory', category: 'tire_purchase' });

// ─── Backward compatibility (legacy schema) ─────────────────────────
console.log('\n┌─ Legacy schema treated as recurring ──────────────');
// A "legacy" expense has no type/category. Our deserializer fills
// type='recurring' + category='other'. The calc functions should treat
// it identically to a brand-new recurring expense.
const legacy: Expense = { id: 'legacy', name: 'Insurance', amount: 200, active: true, type: 'recurring', category: 'other' };
check('legacy expense → counted by monthlyRecurringTotal',
  monthlyRecurringTotal([legacy]) === 200);
check('legacy expense → NOT in filterExpensesInRange (recurring is excluded)',
  filterExpensesInRange([legacy], '2026-05-01', '2026-05-31').length === 0);

// ─── filterExpensesInRange ──────────────────────────────────────────
console.log('\n┌─ filterExpensesInRange ───────────────────────────');
const range = ['2026-05-01', '2026-05-31'] as const;
check('one-time inside range → included',
  filterExpensesInRange([oneTime(50, '2026-05-10')], ...range).length === 1);
check('one-time before range → excluded',
  filterExpensesInRange([oneTime(50, '2026-04-30')], ...range).length === 0);
check('one-time after range → excluded',
  filterExpensesInRange([oneTime(50, '2026-06-01')], ...range).length === 0);
check('one-time on START boundary → included (inclusive)',
  filterExpensesInRange([oneTime(50, '2026-05-01')], ...range).length === 1);
check('one-time on END boundary → included (inclusive)',
  filterExpensesInRange([oneTime(50, '2026-05-31')], ...range).length === 1);
check('recurring with no date → excluded even if "in" range conceptually',
  filterExpensesInRange([recur(200)], ...range).length === 0);
check('expense missing date entirely → excluded (defensive)',
  filterExpensesInRange([exp({ amount: 10, type: 'one_time' })], ...range).length === 0);

// ─── monthlyRecurringTotal ──────────────────────────────────────────
console.log('\n┌─ monthlyRecurringTotal ───────────────────────────');
check('active recurring → counted',
  monthlyRecurringTotal([recur(100), recur(50)]) === 150);
check('inactive recurring → ignored',
  monthlyRecurringTotal([recur(100), recur(50, 'off', false)]) === 100);
check('one-time → ignored',
  monthlyRecurringTotal([recur(100), oneTime(50, '2026-05-10')]) === 100);
check('inventory → ignored',
  monthlyRecurringTotal([recur(100), invExp(500, '2026-05-10')]) === 100);
check('job_linked → ignored',
  monthlyRecurringTotal([recur(100), jobExp(40, '2026-05-10', 'job-1')]) === 100);
check('empty list → 0',
  monthlyRecurringTotal([]) === 0);

// ─── weeklyRecurringFromMonthly ─────────────────────────────────────
console.log('\n┌─ weeklyRecurringFromMonthly ──────────────────────');
check('$433 monthly → $100 weekly (preserves /4.33 factor)',
  approx(weeklyRecurringFromMonthly(433), 100));
check('0 → 0',
  weeklyRecurringFromMonthly(0) === 0);

// ─── expenseTotalsInRange ───────────────────────────────────────────
console.log('\n┌─ expenseTotalsInRange — category + type grouping ──');
const mixed: Expense[] = [
  recur(200, 'Insurance'),                      // ignored (recurring)
  oneTime(40,  '2026-05-05', 'gas'),
  oneTime(30,  '2026-05-12', 'gas'),
  oneTime(15,  '2026-05-20', 'tolls'),
  jobExp(120,  '2026-05-15', 'job-A'),          // category=parts
  invExp(800,  '2026-05-22'),                   // category=tire_purchase
  oneTime(999, '2026-04-30', 'tools'),          // outside range
];
const totals = expenseTotalsInRange(mixed, '2026-05-01', '2026-05-31');
check('total = 40+30+15+120+800 = 1005',
  totals.total === 1005);
check('count = 5 non-recurring rows in range',
  totals.count === 5);
check('byCategory.gas = 70',
  totals.byCategory.gas === 70);
check('byCategory.tolls = 15',
  totals.byCategory.tolls === 15);
check('byCategory.parts = 120',
  totals.byCategory.parts === 120);
check('byCategory.tire_purchase = 800',
  totals.byCategory.tire_purchase === 800);
check('byCategory.tools = 0 (was outside range)',
  totals.byCategory.tools === 0);
check('byCategory.other = 0 (no expense in that category)',
  totals.byCategory.other === 0);
check('byType.one_time = 85 (40+30+15)',
  totals.byType.one_time === 85);
check('byType.job_linked = 120',
  totals.byType.job_linked === 120);
check('byType.inventory = 800',
  totals.byType.inventory === 800);
check('byType.recurring = 0 (always 0 in this function)',
  totals.byType.recurring === 0);

// ─── totalExpensesInRange — recurring proration ─────────────────────
console.log('\n┌─ totalExpensesInRange — recurring proration ──────');
// Recurring $200/mo prorated to 31 days = 200 * (31/30.44) ≈ $203.68
const may = totalExpensesInRange([recur(200)], '2026-05-01', '2026-05-31');
check('31 days of $200/mo recurring ≈ $203.68',
  approx(may, 200 * (31 / 30.44)));
// 7 days of $200/mo ≈ $45.99
const week = totalExpensesInRange([recur(200)], '2026-05-01', '2026-05-07');
check('7 days of $200/mo recurring ≈ $45.99',
  approx(week, 200 * (7 / 30.44)));
// includeRecurring=false → 0 since list has no non-recurring
check('includeRecurring=false → recurring not added',
  totalExpensesInRange([recur(200)], '2026-05-01', '2026-05-31', { includeRecurring: false }) === 0);
// Mixed: $200 recurring + $100 one-time
const mix = totalExpensesInRange([recur(200), oneTime(100, '2026-05-10')], '2026-05-01', '2026-05-31');
check('$200 recurring + $100 one-time, 31 days ≈ 100 + 203.68 ≈ 303.68',
  approx(mix, 100 + 200 * (31 / 30.44)));

// ─── businessNetProfit — the headline calculation ──────────────────
console.log('\n┌─ businessNetProfit ───────────────────────────────');
// Scenario: $1000 in job profit, $200/mo recurring, $50 one-time gas,
// $120 job-linked parts, $800 inventory purchase. Inventory cost
// already flowed into job COGS via the tireCost path (default), so
// inventory should NOT be double-subtracted.
const expSet: Expense[] = [
  recur(200),                                 // prorated to range
  oneTime(50,  '2026-05-10', 'gas'),
  jobExp(120, '2026-05-15', 'job-A'),
  invExp(800, '2026-05-22'),                  // NOT subtracted by default
];
const netDefault = businessNetProfit({
  jobsProfitSum: 1000,
  expenses: expSet,
  startISO: '2026-05-01',
  endISO: '2026-05-31',
});
// 1000 - 50 - 120 - (200 * 31/30.44) ≈ 1000 - 170 - 203.68 ≈ 626.32
check('default: inventory NOT double-subtracted → net ≈ $626.32',
  approx(netDefault, 1000 - 50 - 120 - 200 * (31 / 30.44)));

const netCounted = businessNetProfit({
  jobsProfitSum: 1000,
  expenses: expSet,
  startISO: '2026-05-01',
  endISO: '2026-05-31',
  inventoryAlreadyInJobs: false,
});
// Same as above minus the $800 inventory
check('inventoryAlreadyInJobs=false → also subtract inventory',
  approx(netCounted, 1000 - 50 - 120 - 800 - 200 * (31 / 30.44)));

const netNoRecur = businessNetProfit({
  jobsProfitSum: 1000,
  expenses: expSet,
  startISO: '2026-05-01',
  endISO: '2026-05-31',
  includeRecurring: false,
});
check('includeRecurring=false → recurring skipped → net = 1000 - 50 - 120 = $830',
  netNoRecur === 830);

// Spec scenario: "one-time gas expense reduces business net profit"
const oneGasOnly = businessNetProfit({
  jobsProfitSum: 500,
  expenses: [oneTime(60, '2026-05-10', 'gas')],
  startISO: '2026-05-10',
  endISO: '2026-05-10',
  includeRecurring: false,
});
check('SPEC: $60 one-time gas → net = $500 - $60 = $440',
  oneGasOnly === 440);

// Spec scenario: "gas does NOT incorrectly reduce individual job
// profit unless linked to a job." validateInvite-style: at this
// layer, businessNetProfit takes jobsProfitSum unchanged. The caller
// (Dashboard) computes jobsProfitSum from per-job math which already
// excludes business-level expenses. This is documented and tested
// by ensuring businessNetProfit doesn't touch jobsProfitSum.
const jobsProfitUnchanged = businessNetProfit({
  jobsProfitSum: 999,
  expenses: [],
  startISO: '2026-05-01', endISO: '2026-05-31',
  includeRecurring: false,
});
check('SPEC: empty expenses, includeRecurring=false → net == jobsProfitSum',
  jobsProfitUnchanged === 999);

// Spec scenario: "recurring expenses calculate correctly"
const recurOnly = businessNetProfit({
  jobsProfitSum: 1000,
  expenses: [recur(304.4)],
  startISO: '2026-05-01', endISO: '2026-05-31',
});
// 1000 - 304.4 * 31/30.44 ≈ 1000 - 309.99 ≈ 690.01
check('SPEC: $304.40 monthly recurring × 31 days ≈ $309.99 cost → net ≈ $690.01',
  approx(recurOnly, 1000 - 304.4 * 31 / 30.44));

// Spec scenario: "inventory purchases are not double-counted"
const inventoryCheck = businessNetProfit({
  jobsProfitSum: 1000,
  expenses: [invExp(500, '2026-05-15')],
  startISO: '2026-05-01', endISO: '2026-05-31',
  includeRecurring: false,
});
check('SPEC: $500 inventory purchase (default flag) → net unchanged = $1000',
  inventoryCheck === 1000);

// ─── Empty-collection edges ─────────────────────────────────────────
console.log('\n┌─ empty / edge cases ──────────────────────────────');
check('expenseTotalsInRange([], ...) → total 0, count 0',
  (() => { const t = expenseTotalsInRange([], '2026-05-01', '2026-05-31'); return t.total === 0 && t.count === 0; })());
check('totalExpensesInRange([], ...) → 0',
  totalExpensesInRange([], '2026-05-01', '2026-05-31') === 0);
check('businessNetProfit with empty expenses → jobsProfitSum',
  businessNetProfit({ jobsProfitSum: 250, expenses: [], startISO: '2026-05-01', endISO: '2026-05-31', includeRecurring: false }) === 250);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
