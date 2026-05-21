// tests/jobProfit.test.ts
// Run: npx tsx tests/jobProfit.test.ts
//
// Pins jobDirectCost + jobGrossProfit + weekSummary across all three
// verticals. Pre-fix these helpers added only tireCost — mechanic
// jobs' partsCost was silently dropped, so every mechanic profit
// number (Dashboard, History, JobDetailModal, JobSuccessPanel,
// Payouts) overstated profit by the cost of parts. Production
// example: a $400 brake job using $100 of parts reported $400
// profit instead of $300. Bug propagated to weekly + monthly
// rollups too.

import { jobDirectCost, jobGrossProfit, weekSummary } from '@/lib/utils';
import type { Job, Settings } from '@/types';

const baseSettings: Settings = {
  businessName: 'Test',
  owner1Name: '', owner2Name: '',
  owner1Active: true, owner2Active: true,
  profitSplit1: 50, profitSplit2: 50,
  weeklyGoal: 1500, taxRate: 0,
  costPerMile: 1, defaultTargetProfit: 100,
  invoiceTaxRate: 0,
  servicePricing: {}, vehiclePricing: {},
  expenses: [],
  freeMilesIncluded: 0,
  tireRepairTargetProfit: 0, tireReplacementTargetProfit: 0,
};

function mkJob(over: Partial<Job>): Job {
  return {
    id: 'j', date: '2026-05-21', service: 'X', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '',
    customerName: '', customerPhone: '',
    tireSize: '', qty: 0,
    revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    tireSource: 'Inventory',
    paymentStatus: 'Paid',
    invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    city: '', state: '', fullLocationLabel: '',
    ...over,
  } as Job;
}

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ Tire job (unchanged) ────────────────────────────');
{
  const j = mkJob({ revenue: 200, tireCost: 80, miles: 10 });
  // dc = travel(10) + tire(80) = 90. profit = 200 - 90 = 110
  check('jobDirectCost = travel + tireCost', jobDirectCost(j, baseSettings) === 90);
  check('jobGrossProfit = revenue - dc', jobGrossProfit(j, baseSettings) === 110);
}

console.log('\n┌─ Mechanic job (REGRESSION fix) ───────────────────');
{
  // Brake job: $400 revenue, $100 in parts, 5 miles
  // Pre-fix: dc = travel(5) + tireCost(0) = 5, profit = 395 (WRONG)
  // Post-fix: dc = travel(5) + partsCost(100) = 105, profit = 295
  const j = mkJob({ revenue: 400, partsCost: 100, miles: 5 });
  check('mechanic dc = travel + partsCost', jobDirectCost(j, baseSettings) === 105);
  check('REGRESSION: profit subtracts partsCost', jobGrossProfit(j, baseSettings) === 295);
}

console.log('\n┌─ Detailing job (unchanged — no parts) ────────────');
{
  // Detail package: $150 revenue, 8 miles, no goods cost tracked
  const j = mkJob({ revenue: 150, miles: 8, vehicleSize: 'sedan' });
  check('detailing dc = travel only', jobDirectCost(j, baseSettings) === 8);
  check('detailing profit = revenue - travel', jobGrossProfit(j, baseSettings) === 142);
}

console.log('\n┌─ Mixed: tire + parts both set (defensive) ────────');
{
  // Hybrid edge case — defensive math should add BOTH
  const j = mkJob({ revenue: 500, tireCost: 60, partsCost: 40, miles: 0 });
  check('both fields summed', jobDirectCost(j, baseSettings) === 100);
  check('hybrid profit correct', jobGrossProfit(j, baseSettings) === 400);
}

console.log('\n┌─ Materials/misc legacy field still counted ───────');
{
  const j = mkJob({ revenue: 100, materialCost: 30, miles: 0 });
  check('materialCost in dc', jobDirectCost(j, baseSettings) === 30);
  check('miscCost fallback', jobDirectCost(mkJob({ revenue: 100, miscCost: 25, miles: 0 }), baseSettings) === 25);
}

console.log('\n┌─ weekSummary aggregates correctly ────────────────');
{
  const jobs = [
    mkJob({ id: 'a', revenue: 200, tireCost: 50, miles: 5 }),           // tire
    mkJob({ id: 'b', revenue: 400, partsCost: 100, miles: 0 }),         // mechanic
    mkJob({ id: 'c', revenue: 150, materialCost: 20, miles: 0 }),       // detail
  ];
  const w = weekSummary(jobs, baseSettings);
  // tc bucket = 50 (tire) + 100 (parts) = 150
  check('weekSummary tireCosts includes partsCost', w.tireCosts === 150);
  check('weekSummary miscCosts = 20', w.miscCosts === 20);
  check('weekSummary travelCosts = 5 (only job a had miles)', w.travelCosts === 5);
  // dc = 150 + 20 + 5 = 175; rev = 750; gp = 575
  check('weekSummary grossProfit math holds', w.grossProfit === 575);
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
