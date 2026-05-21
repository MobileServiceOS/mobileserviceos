// tests/mechanicDeductionRollback.test.ts
// Run: npx tsx tests/mechanicDeductionRollback.test.ts

import { rollbackPartsDeductions } from '@/lib/mechanicJob';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ rollbackPartsDeductions ───────────────────────────');
{
  const r = rollbackPartsDeductions({ partsInventoryDeductions: null } as Job);
  check('null deductions → empty refund', Object.keys(r).length === 0);
}
{
  const r = rollbackPartsDeductions({ partsInventoryDeductions: undefined } as Job);
  check('undefined deductions → empty refund', Object.keys(r).length === 0);
}
{
  const r = rollbackPartsDeductions({
    partsInventoryDeductions: [
      { id: 'i1', size: '', qty: 2, cost: 5 },
      { id: 'i2', size: '', qty: 1, cost: 10 },
    ],
  } as Job);
  check('two distinct items → both refunded', Object.keys(r).length === 2);
  check('item i1 refund 2', r.i1 === 2);
  check('item i2 refund 1', r.i2 === 1);
}
{
  const r = rollbackPartsDeductions({
    partsInventoryDeductions: [
      { id: 'i1', size: '', qty: 2, cost: 5 },
      { id: 'i1', size: '', qty: 3, cost: 5 },
    ],
  } as Job);
  check('duplicate ids aggregated', r.i1 === 5);
}
{
  // Idempotency: clearing the array post-refund yields an empty result.
  const r = rollbackPartsDeductions({ partsInventoryDeductions: [] } as unknown as Job);
  check('empty array → no refunds (idempotent post-clear)', Object.keys(r).length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
