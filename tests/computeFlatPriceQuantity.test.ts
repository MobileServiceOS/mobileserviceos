// tests/computeFlatPriceQuantity.test.ts
// Run: npx tsx tests/computeFlatPriceQuantity.test.ts
//
// Pin tireCost × qty inside computeFlatPrice. Pre-fix (flat.ts:82) the
// direct cost summed `tireCost + materialCost + travelCost` where
// tireCost was the PER-UNIT value from the job — so multi-tire profit
// was overstated by tireCost × (qty - 1). Production example: a 4-tire
// $80 job reported $640 profit on a $1000 invoice; correct value is
// $400. Bug propagated to Quick Pricing breakdown, AddJob footer, and
// the suggested-price cross-check.

import { computeFlatPrice } from '@/config/businessTypes/pricing/flat';
import type { Job, Settings } from '@/types';

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

console.log('\n── REGRESSION: tireCost is per-unit, not total ──');
{
  const j = mkJob({ revenue: 1000, tireCost: 80, qty: 4, miles: 0 });
  const r = computeFlatPrice(j, settings);
  // Correct: 4 tires × $80 = $320 direct → $1000 - $320 = $680 profit
  check('4×$80 directCost = $320', r.directCost === 320, `got ${r.directCost}`);
  check('4×$80 profit = $680',    r.profit === 680,     `got ${r.profit}`);
  // Pre-fix bug would have reported directCost=80, profit=920.
  check('NOT pre-fix overstated profit ($920)', r.profit !== 920);
}

console.log('\n── qty=1 path unchanged ──');
{
  const j = mkJob({ revenue: 200, tireCost: 80, qty: 1, miles: 0 });
  const r = computeFlatPrice(j, settings);
  check('1×$80 directCost = $80', r.directCost === 80);
  check('1×$80 profit = $120',    r.profit === 120);
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
  const j = mkJob({ revenue: 500, tireCost: 50, qty: 2, materialCost: 25, miles: 10 });
  const r = computeFlatPrice(j, settings);
  // tires: 2 × 50 = 100; material: 25; travel: 10 mi × 0.65 = 6.50
  // direct: 100 + 25 + 6.50 = 131.50; profit: 500 - 131.50 = 368.50
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

console.log('\n── breakdown.tireCost reflects total, not per-unit ──');
{
  const j = mkJob({ revenue: 1000, tireCost: 80, qty: 4 });
  const r = computeFlatPrice(j, settings);
  check('breakdown.tireCost = $320 (total, displayed)', r.tireCost === 320, `got ${r.tireCost}`);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
