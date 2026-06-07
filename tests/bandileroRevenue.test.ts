// tests/bandileroRevenue.test.ts
// Run: npx tsx tests/bandileroRevenue.test.ts
//
// Revenue + Finance services: revenue = Σ completed-job revenue keyed on
// Job.date (Cancelled excluded), today vs yesterday delta, daily series,
// average ticket, gross/net profit over a range.

import {
  revenueForDate, revenueTodayVsYesterday, dailyRevenueSeries, averageTicket,
} from '@/lib/bandilero/services/revenue';
import { grossProfitForRange, netProfitForRange } from '@/lib/bandilero/services/finance';
import type { Job, Settings } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const S = {
  businessName: 'Test', workWeekStartDay: 1, costPerMile: 0.65, freeMilesIncluded: 0,
  expenses: [], invoiceTaxRate: 0, servicePricing: {}, vehiclePricing: {},
} as unknown as Settings;

function job(over: Partial<Job>): Job {
  return {
    id: Math.random().toString(36).slice(2), date: '2026-06-07', service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    ...over,
  } as Job;
}

const TODAY = '2026-06-07';
const YESTERDAY = '2026-06-06';

const jobs: Job[] = [
  job({ date: TODAY, status: 'Completed', revenue: 200 }),
  job({ date: TODAY, status: 'Completed', revenue: 100 }),
  job({ date: TODAY, status: 'Cancelled', revenue: 999 }),   // excluded
  job({ date: TODAY, status: 'Pending',   revenue: 500 }),   // not Completed → excluded from revenue
  job({ date: YESTERDAY, status: 'Completed', revenue: 150 }),
];

console.log('\n── revenueForDate (Completed only, Cancelled excluded) ──');
{
  const today = revenueForDate(jobs, TODAY);
  check('today revenue = 300', today.value === 300, `got ${today.value}`);
  check('today is LIVE', today.state === 'LIVE');
  check('today source = jobs', today.source === 'jobs');
  check('yesterday revenue = 150', revenueForDate(jobs, YESTERDAY).value === 150);
}

console.log('\n── revenueTodayVsYesterday ──');
{
  const r = revenueTodayVsYesterday(jobs, TODAY);
  check('today 300', r.today.value === 300);
  check('yesterday 150', r.yesterday.value === 150);
  check('deltaPct = 100', r.deltaPct === 100, `got ${r.deltaPct}`);

  const noBaseline = revenueTodayVsYesterday(jobs.filter(j => j.date === TODAY), TODAY);
  check('deltaPct null when no yesterday baseline', noBaseline.deltaPct === null);
}

console.log('\n── dailyRevenueSeries ──');
{
  const series = dailyRevenueSeries(jobs, TODAY, 3);
  check('3-day series length 3', series.length === 3);
  check('oldest → newest order', series[0].date < series[2].date);
  check('today bucket = 300', series[2].revenue === 300, `got ${series[2].revenue}`);
  check('yesterday bucket = 150', series[1].revenue === 150);
  check('day-2 bucket = 0 (real zero, no job that day)', series[0].revenue === 0);
}

console.log('\n── averageTicket (completed, revenue>0) ──');
{
  // 200, 100, 150 → mean 150 (Cancelled 999 and Pending 500 excluded)
  check('avg ticket = 150', averageTicket(jobs) === 150, `got ${averageTicket(jobs)}`);
  check('avg ticket = 0 when no completed jobs', averageTicket([]) === 0);
}

console.log('\n── grossProfitForRange (zero costs → profit == revenue) ──');
{
  const gp = grossProfitForRange(jobs, S, YESTERDAY, TODAY);
  // Completed in range: 200 + 100 + 150 = 450 (Cancelled/Pending excluded)
  check('gross profit = 450', gp.value === 450, `got ${gp.value}`);
  check('gross is LIVE', gp.state === 'LIVE');
}

console.log('\n── netProfitForRange (no expenses → equals gross) ──');
{
  const net = netProfitForRange(jobs, S, YESTERDAY, TODAY);
  check('net profit = 450 (no expenses)', net.value === 450, `got ${net.value}`);

  const withExpense = {
    ...S,
    expenses: [{ id: 'e1', type: 'one_time', amount: 50, date: TODAY, active: true, label: 'gas' }],
  } as unknown as Settings;
  const net2 = netProfitForRange(jobs, withExpense, YESTERDAY, TODAY);
  check('net profit = 400 after $50 one-time expense', net2.value === 400, `got ${net2.value}`);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
