// tests/insights.test.ts
// Run: npx tsx tests/insights.test.ts
//
// Pins computeInsights — the derivation behind the Insights page.

import { computeInsights } from '@/lib/insights';
import type { Job, Settings } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// workWeekStartDay 1 (Monday). costPerMile 0 so profit == revenue
// minus COGS, keeping the arithmetic obvious.
const settings = { workWeekStartDay: 1, costPerMile: 0, freeMilesIncluded: 0 } as unknown as Settings;
const TODAY = '2026-05-22'; // a Friday

function mkJob(over: Partial<Job>): Job {
  return {
    id: Math.random().toString(36).slice(2), date: TODAY,
    service: 'Flat Tire Repair', vehicleType: 'Sedan', area: '',
    payment: 'Cash', status: 'Completed', source: 'Google',
    customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0,
    miscCost: 0, miles: 0, note: '', emergency: false, lateNight: false,
    highway: false, weekend: false, tireSource: 'Inventory',
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false,
    reviewRequested: false, city: '', state: '', fullLocationLabel: '',
    ...over,
  } as Job;
}

console.log('\n┌─ Revenue trend — 8 weeks, zero-filled ────────────');
{
  const ins = computeInsights([mkJob({ revenue: 500, date: TODAY })], settings, TODAY);
  check('always exactly 8 week points', ins.revenueTrend.length === 8);
  check('points are oldest → newest',
    ins.revenueTrend[0].weekStart < ins.revenueTrend[7].weekStart);
  check('this-week revenue lands in the last bucket',
    ins.revenueTrend[7].revenue === 500);
  check('quiet weeks are zero-filled, not omitted',
    ins.revenueTrend[0].revenue === 0);
}

console.log('\n┌─ Top services — ranked by profit ─────────────────');
{
  const jobs = [
    mkJob({ service: 'Oil Change', revenue: 100, tireCost: 10 }),       // profit 90
    mkJob({ service: 'Brake Job', revenue: 400, tireCost: 50 }),         // profit 350
    mkJob({ service: 'Oil Change', revenue: 120, tireCost: 20 }),        // profit 100
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  check('Brake Job ranks first (highest profit)',
    ins.topServices[0].service === 'Brake Job');
  check('Oil Change aggregates two jobs',
    ins.topServices.find((s) => s.service === 'Oil Change')?.count === 2);
  check('Oil Change profit summed (90+100)',
    ins.topServices.find((s) => s.service === 'Oil Change')?.profit === 190);
}

console.log('\n┌─ Top sources / cities ────────────────────────────');
{
  const jobs = [
    mkJob({ source: 'Google', revenue: 200, city: 'Hollywood' }),
    mkJob({ source: 'Referral', revenue: 500, city: 'Aventura' }),
    mkJob({ source: 'Google', revenue: 100, city: 'Hollywood' }),
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  check('top source by revenue is Referral ($500 > Google $300)',
    ins.topSources[0].source === 'Referral');
  check('Google source aggregates 2 jobs',
    ins.topSources.find((s) => s.source === 'Google')?.count === 2);
  check('cities ranked by profit', ins.topCities[0].city === 'Aventura');
}

console.log('\n┌─ Repeat-customer rate ────────────────────────────');
{
  const jobs = [
    mkJob({ customerPhone: '5551112222', revenue: 100 }),
    mkJob({ customerPhone: '5551112222', revenue: 100 }), // repeat
    mkJob({ customerPhone: '5553334444', revenue: 100 }), // one-off
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  check('2 distinct customers', ins.repeat.total === 2);
  check('1 repeat customer', ins.repeat.repeat === 1);
  check('repeat pct = 50', ins.repeat.pct === 50);
}

console.log('\n┌─ Unpaid aging — bucket boundaries ────────────────');
{
  // today = 2026-05-22
  const jobs = [
    mkJob({ revenue: 100, paymentStatus: 'Pending Payment', status: 'Pending', date: '2026-05-20' }), // 2d → 0-7d
    mkJob({ revenue: 200, paymentStatus: 'Pending Payment', status: 'Pending', date: '2026-05-01' }), // 21d → 8-30d
    mkJob({ revenue: 300, paymentStatus: 'Pending Payment', status: 'Pending', date: '2026-04-10' }), // 42d → 31-60d
    mkJob({ revenue: 400, paymentStatus: 'Pending Payment', status: 'Pending', date: '2026-01-01' }), // >60d
    mkJob({ revenue: 999, paymentStatus: 'Paid', date: '2026-01-01' }),                               // paid → ignored
  ];
  const ins = computeInsights(jobs, settings, TODAY);
  const by = (b: string) => ins.unpaidAging.find((r) => r.bucket === b);
  check('always 4 buckets in order',
    ins.unpaidAging.map((r) => r.bucket).join(',') === '0-7d,8-30d,31-60d,60d+');
  check('0-7d bucket: 1 job, $100', by('0-7d')?.count === 1 && by('0-7d')?.total === 100);
  check('8-30d bucket: 1 job, $200', by('8-30d')?.count === 1 && by('8-30d')?.total === 200);
  check('31-60d bucket: 1 job, $300', by('31-60d')?.count === 1);
  check('60d+ bucket: 1 job, $400', by('60d+')?.count === 1 && by('60d+')?.total === 400);
  check('paid job excluded from aging',
    ins.unpaidAging.reduce((s, r) => s + r.count, 0) === 4);
}

console.log('\n┌─ Mechanic profit + empty input ───────────────────');
{
  // $400 mechanic job, $100 parts → profit 300 (partsCost counted).
  const ins = computeInsights(
    [mkJob({ service: 'Brake Repair', revenue: 400, partsCost: 100, tireSize: '' })],
    settings, TODAY,
  );
  check('mechanic service profit subtracts partsCost',
    ins.topServices[0].profit === 300);

  const empty = computeInsights([], settings, TODAY);
  check('empty input → 8 zero weeks', empty.revenueTrend.length === 8);
  check('empty input → no services', empty.topServices.length === 0);
  check('empty input → repeat pct 0', empty.repeat.pct === 0);
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
