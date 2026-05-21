// tests/mechanicJobDerivation.test.ts
// Run: npx tsx tests/mechanicJobDerivation.test.ts

import {
  deriveLegacyPartsCost,
  derivePartsMarginSnapshot,
} from '@/lib/mechanicJob';
import type { JobPartLine } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const line = (over: Partial<JobPartLine> = {}): JobPartLine => ({
  name: 'p', qty: 1, unitPrice: 10, unitCost: 5,
  source: 'inventory', inventoryItemId: 'i1', ...over,
});

console.log('\n┌─ deriveLegacyPartsCost ─────────────────────────────');
check('empty array → 0', deriveLegacyPartsCost([]) === 0);
check('single line: 2 × $45 = $90',
  deriveLegacyPartsCost([line({ qty: 2, unitPrice: 45 })]) === 90);
check('multi-line sums correctly',
  deriveLegacyPartsCost([
    line({ qty: 1, unitPrice: 45 }),
    line({ qty: 2, unitPrice: 12 }),
    line({ qty: 4, unitPrice: 8 }),
  ]) === 101);
check('r2 rounding determinism (0.1+0.2)*1=0.3',
  deriveLegacyPartsCost([
    line({ qty: 1, unitPrice: 0.1 }),
    line({ qty: 1, unitPrice: 0.2 }),
  ]) === 0.3);

console.log('\n┌─ derivePartsMarginSnapshot ─────────────────────────');
check('empty array → undefined',
  derivePartsMarginSnapshot([]) === undefined);
{
  const r = derivePartsMarginSnapshot([line({ qty: 2, unitPrice: 45, unitCost: 30 })]);
  check('single line snapshot revenue', r?.revenue === 90);
  check('single line snapshot costBasis', r?.costBasis === 60);
  check('single line snapshot margin', r?.margin === 30);
}
{
  const r = derivePartsMarginSnapshot([line({ unitCost: 0 })]);
  check('zero unitCost invalidates snapshot', r === undefined);
}
{
  const r = derivePartsMarginSnapshot([
    line({ unitCost: 5 }),
    line({ unitCost: 0 }),
  ]);
  check('any zero-cost line invalidates whole snapshot', r === undefined);
}
{
  const r = derivePartsMarginSnapshot([
    line({ qty: 1, unitPrice: 45, unitCost: 28 }),
    line({ qty: 2, unitPrice: 12, unitCost: 7 }),
  ]);
  check('multi-line snapshot revenue', r?.revenue === 69);
  check('multi-line snapshot costBasis', r?.costBasis === 42);
  check('multi-line snapshot margin', r?.margin === 27);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
