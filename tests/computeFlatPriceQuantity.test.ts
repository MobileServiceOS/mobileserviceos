// tests/computeFlatPriceQuantity.test.ts
// Run: npx tsx tests/computeFlatPriceQuantity.test.ts
//
// Pins the tireCost convention inside computeFlatPrice: tireCost on a
// SAVED Job is the TOTAL tire cost (qty already baked in), so
// computeFlatPrice MUST NOT multiply by qty.
//
// History (2026-06-05 audit): Batch A had made computeFlatPrice multiply
// tireCost × qty, on the assumption tireCost was per-unit. But the
// dominant path — inventory jobs — persists the FIFO plan TOTAL
// (App.tsx), and the rollups (jobCOGS / weekSummary) consume tireCost as
// a total. So the multiply double-counted every inventory job while the
// rollups under-counted "bought" jobs (stored per-unit). The fix aligns
// everything on TOTAL: saveJob now stores "bought" as tirePurchasePrice ×
// qty, the AddJob mirror sets the total, and computeFlatPrice reads it
// straight.
//
// 2026-06-08 audit: calcFlatQuote (the live suggested-price estimator)
// ALSO now follows the TOTAL convention — it previously scaled by qty,
// which double-counted AddJob's live suggestion because AddJob feeds it
// the already-total job.tireCost. The Dashboard Quick Quote (whose "Tire
// $" input is per-unit) now multiplies by qty at the call site. So both
// engines and every rollup agree: tireCost is always a TOTAL.

import { calcFlatQuote, computeFlatPrice } from '@/config/businessTypes/pricing/flat';
import type { Job, QuoteForm, Settings } from '@/types';

const settings: Settings = {
  businessName: 'Test',
  owner1Name: '', owner2Name: '',
  owner1Active: true, owner2Active: true,
  profitSplit1: 50, profitSplit2: 50,
  weeklyGoal: 1500, taxRate: 0,
  costPerMile: 0.65, defaultTargetProfit: 100,
  invoiceTaxRate: 0,
  servicePricing: {}, vehiclePricing: {},
  expenses: [],
  freeMilesIncluded: 0,
  tireRepairTargetProfit: 0, tireReplacementTargetProfit: 0,
} as Settings;

function mkJob(over: Partial<Job>): Job {
  return {
    id: 'j', date: '2026-06-05', service: 'Tire Replacement', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '',
    customerName: '', customerPhone: '',
    tireSize: '', qty: 1,
    revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    tireSource: 'Inventory',
    paymentStatus: 'Paid',
    invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    ...over,
  } as Job;
}

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── tireCost is the TOTAL — computeFlatPrice does NOT multiply by qty ──');
{
  // Stored total for a 4-tire job: 4 × $80 = $320.
  const j = mkJob({ revenue: 1000, tireCost: 320, qty: 4, miles: 0 });
  const r = computeFlatPrice(j, settings);
  check('total $320 → directCost = $320', r.directCost === 320, `got ${r.directCost}`);
  check('total $320 → profit = $680',     r.profit === 680,     `got ${r.profit}`);
}

console.log('\n── qty does NOT scale tireCost (regression guard) ──');
{
  // tireCost is already total; qty>1 must not re-multiply it.
  const j = mkJob({ revenue: 1000, tireCost: 80, qty: 4, miles: 0 });
  const r = computeFlatPrice(j, settings);
  check('tireCost=80,qty=4 → directCost = $80 (NOT $320)', r.directCost === 80, `got ${r.directCost}`);
  check('tireCost=80,qty=4 → profit = $920',               r.profit === 920,   `got ${r.profit}`);
  check('quantity still reported as 4',                    r.quantity === 4,   `got ${r.quantity}`);
}

console.log('\n── qty=1 path unchanged ──');
{
  const j = mkJob({ revenue: 200, tireCost: 80, qty: 1, miles: 0 });
  const r = computeFlatPrice(j, settings);
  check('directCost = $80', r.directCost === 80);
  check('profit = $120',    r.profit === 120);
}

console.log('\n── qty defaults to 1 when missing/zero ──');
{
  const j = mkJob({ revenue: 200, tireCost: 80, qty: 0, miles: 0 });
  const r = computeFlatPrice(j, settings);
  check('qty=0 floors to 1', r.quantity === 1);
  check('directCost = $80',  r.directCost === 80);
}

console.log('\n── materialCost + travelCost still added ──');
{
  // tires total $100; material $25; travel 10mi × 0.65 = 6.50
  const j = mkJob({ revenue: 500, tireCost: 100, qty: 2, materialCost: 25, miles: 10 });
  const r = computeFlatPrice(j, settings);
  check('direct = 131.50', r.directCost === 131.5, `got ${r.directCost}`);
  check('profit = 368.50',  r.profit === 368.5,    `got ${r.profit}`);
}

console.log('\n── travel: freeMiles applied before charge ──');
{
  const sFree = { ...settings, freeMilesIncluded: 5, costPerMile: 1 } as Settings;
  const j = mkJob({ revenue: 100, tireCost: 0, qty: 1, miles: 12 });
  const r = computeFlatPrice(j, sFree);
  // chargeable = 12 - 5 = 7; travel = 7
  check('travel = $7', r.travelCost === 7, `got ${r.travelCost}`);
  check('profit = $93', r.profit === 93,   `got ${r.profit}`);
}

console.log('\n── breakdown.tireCost echoes the stored total ──');
{
  const j = mkJob({ revenue: 1000, tireCost: 320, qty: 4 });
  const r = computeFlatPrice(j, settings);
  check('breakdown.tireCost = $320', r.tireCost === 320, `got ${r.tireCost}`);
}

console.log('\n── calcFlatQuote: tireCost is TOTAL — live suggestion does NOT double-count ──');
{
  // AddJob feeds the live estimator the already-total job.tireCost.
  // sd defaults: basePrice 100, minProfit 80 → targetProfit 80.
  // dc = 320 (+0 material +0 travel); suggested = ceil((320+80)/5)*5 = 400.
  const form = { service: 'Tire Replacement', vehicleType: 'Sedan', miles: 0,
    tireCost: 320, qty: 4, materialCost: 0 } as QuoteForm;
  const q = calcFlatQuote(form, settings);
  check('directCosts = $320 (NOT $1280)', q.directCosts === 320, `got ${q.directCosts}`);
  check('suggested = $400 (NOT $1360)',   q.suggested === 400,   `got ${q.suggested}`);
}

console.log('\n── calcFlatQuote reconciles with computeFlatPrice at the suggested price ──');
{
  // A job saved at the suggested price must show the estimator's targetProfit.
  const form = { service: 'Tire Replacement', vehicleType: 'Sedan', miles: 0,
    tireCost: 320, qty: 4, materialCost: 0 } as QuoteForm;
  const q = calcFlatQuote(form, settings);
  const j = mkJob({ revenue: q.suggested, tireCost: 320, qty: 4, miles: 0 });
  const r = computeFlatPrice(j, settings);
  check('saved directCost matches estimator', r.directCost === q.directCosts, `${r.directCost} vs ${q.directCosts}`);
  check('saved profit ≥ targetProfit',         r.profit >= q.targetProfit,     `${r.profit} vs ${q.targetProfit}`);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
