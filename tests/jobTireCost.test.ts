// tests/jobTireCost.test.ts
// Run: npx tsx tests/jobTireCost.test.ts
//
// Pins the money-critical tire-cost-by-source rule extracted from
// saveJob. Stored tireCost is always a TOTAL (qty baked in).

import { computeJobTireCost } from '@/lib/jobTireCost';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── Inventory: weighted FIFO total ──');
{
  // 4 tires @ weighted $320 plan total → stored TOTAL $320.
  check('plan total stored as TOTAL', computeJobTireCost({ tireSource: 'Inventory', fifoPlanTotal: 320, fallbackTireCost: 0 }) === 320);
  // No stock deductible (plan total 0) → keep the fallback.
  check('zero plan falls back to existing tireCost', computeJobTireCost({ tireSource: 'Inventory', fifoPlanTotal: 0, fallbackTireCost: 75 }) === 75);
  check('rounds to cents', computeJobTireCost({ tireSource: 'Inventory', fifoPlanTotal: 99.999, fallbackTireCost: 0 }) === 100);
}

console.log('\n── Bought for this job: per-unit × qty ──');
{
  // PER-UNIT purchase price × qty = TOTAL.
  check('80 × 4 = 320 (TOTAL, not per-unit)', computeJobTireCost({ tireSource: 'Bought for this job', tirePurchasePrice: 80, qty: 4, fallbackTireCost: 0 }) === 320);
  check('single tire 80 × 1 = 80', computeJobTireCost({ tireSource: 'Bought for this job', tirePurchasePrice: 80, qty: 1, fallbackTireCost: 0 }) === 80);
  check('qty missing floors to 1', computeJobTireCost({ tireSource: 'Bought for this job', tirePurchasePrice: 80, fallbackTireCost: 0 }) === 80);
  check('qty 0 floors to 1', computeJobTireCost({ tireSource: 'Bought for this job', tirePurchasePrice: 80, qty: 0, fallbackTireCost: 0 }) === 80);
  check('no purchase price falls back', computeJobTireCost({ tireSource: 'Bought for this job', tirePurchasePrice: 0, qty: 4, fallbackTireCost: 50 }) === 50);
  check('rounds to cents', computeJobTireCost({ tireSource: 'Bought for this job', tirePurchasePrice: 33.333, qty: 3, fallbackTireCost: 0 }) === 100);
}

console.log('\n── Customer supplied: always 0 ──');
{
  check('customer-supplied → 0', computeJobTireCost({ tireSource: 'Customer supplied', fallbackTireCost: 999 }) === 0);
}

console.log('\n── Unknown / missing source: fallback ──');
{
  check('unknown source keeps existing tireCost', computeJobTireCost({ tireSource: 'Something Else', fallbackTireCost: 42 }) === 42);
  check('undefined source keeps existing tireCost', computeJobTireCost({ tireSource: undefined, fallbackTireCost: 42 }) === 42);
  check('string fallback coerced', computeJobTireCost({ tireSource: 'Inventory', fifoPlanTotal: 0, fallbackTireCost: '60' }) === 60);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
