// tests/insightsCancelledFilter.test.ts
// Run: npx tsx tests/insightsCancelledFilter.test.ts
//
// Regression coverage for the audit's BUG #1 — Cancelled jobs were
// leaking into Top Services, Top Sources, Top Cities, Revenue Trend,
// and Unpaid Aging because the compute loop processed every job in
// the list. Operators correctly expect a canceled $500 repair to
// vanish from rankings the same week — not stick around as if the
// money came in. Status filter is now at the top of the loop so
// every downstream metric inherits the exclusion.

import { computeInsights } from '@/lib/insights';
import type { Job, Settings } from '@/types';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function makeJob(over: Partial<Job>): Job {
  return {
    id: 'j' + Math.random().toString(36).slice(2, 8),
    status: 'Completed',
    date: '2026-05-20',
    tireSize: '225/65R17',
    qty: 4,
    revenue: 500,
    tireCost: 200,
    materialCost: 50,
    miles: 10,
    note: '',
    emergency: false,
    lateNight: false,
    highway: false,
    weekend: false,
    tireSource: 'in_stock',
    service: 'Tire Replacement',
    source: 'Google',
    city: 'Hollywood',
    ...over,
  } as Job;
}

const settings: Settings = { workWeekStartDay: 1 } as Settings;
const TODAY = '2026-05-28';

console.log('\n┌─ Cancelled jobs excluded from Top Services ────');
{
  const jobs: Job[] = [
    makeJob({ id: 'a', service: 'Tire Replacement', revenue: 500, status: 'Completed' }),
    makeJob({ id: 'b', service: 'Tire Replacement', revenue: 500, status: 'Cancelled' }),
    makeJob({ id: 'c', service: 'Flat Repair', revenue: 100, status: 'Completed' }),
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  const tireReplacement = ins.topServices.find((s) => s.service === 'Tire Replacement');
  // 1 completed × 500 revenue = 500. Cancelled $500 must be excluded.
  check('Top Services revenue for Tire Replacement = $500 (not $1000)',
    !!tireReplacement && tireReplacement.revenue === 500 && tireReplacement.count === 1);
}

console.log('\n┌─ Cancelled jobs excluded from Top Lead Sources ──');
{
  const jobs: Job[] = [
    makeJob({ source: 'Google', revenue: 800, status: 'Completed' }),
    makeJob({ source: 'Google', revenue: 800, status: 'Cancelled' }),
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  const google = ins.topSources.find((s) => s.source === 'Google');
  check('Top Lead Sources revenue for Google = $800 (not $1600)',
    !!google && google.revenue === 800 && google.count === 1);
}

console.log('\n┌─ Cancelled jobs excluded from Top Cities ────');
{
  const jobs: Job[] = [
    makeJob({ city: 'Hollywood', revenue: 1000, tireCost: 400, status: 'Completed' }),
    makeJob({ city: 'Hollywood', revenue: 1000, tireCost: 400, status: 'Cancelled' }),
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  const hollywood = ins.topCities.find((c) => c.city === 'Hollywood');
  check('Top Cities count for Hollywood = 1 (cancelled excluded)',
    !!hollywood && hollywood.count === 1);
}

console.log('\n┌─ Cancelled jobs excluded from Unpaid Aging ────');
{
  // resolvePaymentStatus returns 'Paid' by default for Completed
  // jobs without an explicit paymentStatus — so to set up a real
  // unpaid scenario the Completed job uses status='Pending', which
  // makes resolvePaymentStatus return 'Pending Payment'. The cancel
  // path is the regression we care about: cancelling a job after
  // logging it (status flipped to Cancelled) must remove it from
  // aging entirely, regardless of paymentStatus on the doc.
  const jobs: Job[] = [
    makeJob({ date: '2026-05-25', revenue: 500, status: 'Pending' }),
    makeJob({ date: '2026-05-25', revenue: 500, status: 'Cancelled' }),
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  const total07d = ins.unpaidAging.find((b) => b.bucket === '0-7d');
  check('Unpaid 0-7d count = 1 (cancelled excluded)',
    !!total07d && total07d.count === 1 && total07d.total === 500);
}

console.log('\n┌─ Cancelled jobs excluded from Revenue Trend ─');
{
  const jobs: Job[] = [
    makeJob({ date: '2026-05-25', revenue: 1000, status: 'Completed' }),
    makeJob({ date: '2026-05-25', revenue: 1000, status: 'Cancelled' }),
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  // Sum across the 8-week trend — the most recent week should hold
  // exactly the completed revenue.
  const total = ins.revenueTrend.reduce((s, w) => s + w.revenue, 0);
  check('8-week trend revenue = $1000 (cancelled excluded)', total === 1000);
}

console.log('\n┌─ Pending jobs still counted (regression guard) ──');
{
  // The Cancelled filter is the ONLY status exclusion. Pending and
  // Completed both legitimately contribute to operational metrics.
  const jobs: Job[] = [
    makeJob({ service: 'Tire Replacement', revenue: 500, status: 'Pending' }),
    makeJob({ service: 'Tire Replacement', revenue: 500, status: 'Completed' }),
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  const tr = ins.topServices.find((s) => s.service === 'Tire Replacement');
  check('Pending jobs DO still count in Top Services',
    !!tr && tr.count === 2 && tr.revenue === 1000);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
