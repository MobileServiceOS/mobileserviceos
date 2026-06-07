// tests/bandileroFinanceIntel.test.ts
// Run: npx tsx tests/bandileroFinanceIntel.test.ts
//
// Revenue/Finance Intelligence — reconciles with the canonical app math
// (jobGrossProfit, businessNetProfit, Payouts owner split). All LIVE.

import { financeIntel } from '@/lib/bandilero/services/financeIntel';
import type { Job, Settings, Expense } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
function settings(over: Partial<Settings> = {}): Settings {
  return {
    businessName: 'T', workWeekStartDay: 1, costPerMile: 0.65, freeMilesIncluded: 0, taxRate: 0,
    expenses: [], invoiceTaxRate: 0, servicePricing: {}, vehiclePricing: {},
    owner1Name: 'Dee', owner1Active: true, profitSplit1: 60,
    owner2Name: 'Sam', owner2Active: true, profitSplit2: 40,
    ...over,
  } as unknown as Settings;
}
function job(revenue: number, tireCost: number): Job {
  return {
    id: Math.random().toString(36).slice(2), date: TODAY, service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue, tireCost, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  } as Job;
}

// Two completed jobs today: gross profit 800 + 400 = 1200; revenue 1500.
const jobs: Job[] = [job(1000, 200), job(500, 100)];

console.log('\n── revenue + profit (no expenses) ──');
{
  const f = financeIntel(jobs, settings(), TODAY);
  check('revenue today = 1500', f.revenueToday.value === 1500, `got ${f.revenueToday.value}`);
  check('revenue week = 1500', f.revenueWeek.value === 1500);
  check('revenue month = 1500', f.revenueMonth.value === 1500);
  check('gross profit week = 1200', f.grossProfitWeek.value === 1200, `got ${f.grossProfitWeek.value}`);
  check('net profit month = 1200 (no expenses)', f.netProfitMonth.value === 1200, `got ${f.netProfitMonth.value}`);
  check('distributable week = 1200 (taxRate 0)', f.distributableWeek.value === 1200, `got ${f.distributableWeek.value}`);
  check('all headline metrics LIVE', [f.revenueToday, f.grossProfitWeek, f.distributableWeek, f.netProfitMonth].every((m) => m.state === 'LIVE'));
  check('revenueTrend is 8 weeks', f.revenueTrend.length === 8);
}

console.log('\n── owner split (60/40 of 1200) ──');
{
  const f = financeIntel(jobs, settings(), TODAY);
  check('two owner shares', f.ownerShares.length === 2);
  const dee = f.ownerShares.find((o) => o.name === 'Dee')!;
  const sam = f.ownerShares.find((o) => o.name === 'Sam')!;
  check('Dee 60% = 720', dee.pct === 60 && dee.amount === 720, `got ${dee.amount}`);
  check('Sam 40% = 480', sam.pct === 40 && sam.amount === 480, `got ${sam.amount}`);
}

console.log('\n── inactive owner excluded; survivor takes full split ──');
{
  const f = financeIntel(jobs, settings({ owner2Active: false }), TODAY);
  check('only one share', f.ownerShares.length === 1 && f.ownerShares[0].name === 'Dee');
  check('Dee gets full distributable (60/60) = 1200', f.ownerShares[0].amount === 1200, `got ${f.ownerShares[0].amount}`);
}

console.log('\n── expenses reduce net + distributable ──');
{
  const exp: Expense[] = [{ id: 'e1', type: 'one_time', amount: 100, date: TODAY, active: true, label: 'gas', category: 'fuel' } as unknown as Expense];
  const f = financeIntel(jobs, settings({ expenses: exp }), TODAY);
  check('expenses month = 100', f.expensesMonth.value === 100, `got ${f.expensesMonth.value}`);
  check('net profit month = 1100 (1200 − 100)', f.netProfitMonth.value === 1100, `got ${f.netProfitMonth.value}`);
  check('distributable = 1100', f.distributableWeek.value === 1100, `got ${f.distributableWeek.value}`);
  check('monthly recurring = 0 (one-time not recurring)', f.monthlyRecurring.value === 0);
}

console.log('\n── empty business ──');
{
  const f = financeIntel([], settings(), TODAY);
  check('revenue today LIVE 0 (real)', f.revenueToday.state === 'LIVE' && f.revenueToday.value === 0);
  check('distributable LIVE 0', f.distributableWeek.value === 0);
  check('no owner shares above 0 still computed', Array.isArray(f.ownerShares));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
