// tests/mechanicDeductionDiff.test.ts
// Run: npx tsx tests/mechanicDeductionDiff.test.ts

import {
  diffPartsForDeduction,
  buildPartsInventoryDeductions,
} from '@/lib/mechanicJob';
import type { JobPartLine } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const inv = (id: string, qty: number): JobPartLine => ({
  name: id, qty, unitPrice: 10, unitCost: 5,
  source: 'inventory', inventoryItemId: id,
});
const oneOff = (qty: number): JobPartLine => ({
  name: 'oneoff', qty, unitPrice: 10, unitCost: 0,
  source: 'bought_for_job',
});

console.log('\n┌─ diffPartsForDeduction ─────────────────────────────');
check('empty old + empty new → no diff',
  Object.keys(diffPartsForDeduction([], [])).length === 0);
check('new line on i1 qty 2 → delta i1 = -2',
  diffPartsForDeduction(undefined, [inv('i1', 2)]).i1 === -2);
check('removed line on i1 qty 2 → delta i1 = +2',
  diffPartsForDeduction([inv('i1', 2)], []).i1 === 2);
check('qty bumped 1 → 3 → delta i1 = -2',
  diffPartsForDeduction([inv('i1', 1)], [inv('i1', 3)]).i1 === -2);
check('qty reduced 3 → 1 → delta i1 = +2',
  diffPartsForDeduction([inv('i1', 3)], [inv('i1', 1)]).i1 === 2);
check('identical input → empty diff',
  Object.keys(diffPartsForDeduction([inv('i1', 2)], [inv('i1', 2)])).length === 0);
check('one-off lines never appear in diff',
  Object.keys(diffPartsForDeduction([], [oneOff(3)])).length === 0);
{
  const d = diffPartsForDeduction([inv('i1', 2)], [oneOff(2)]);
  check('source change inventory→bought_for_job refunds i1', d.i1 === 2);
  check('source change does not deduct elsewhere',
    Object.keys(d).length === 1);
}
{
  const d = diffPartsForDeduction([oneOff(2)], [inv('i1', 2)]);
  check('source change bought_for_job→inventory deducts i1', d.i1 === -2);
}

console.log('\n┌─ buildPartsInventoryDeductions ─────────────────────');
{
  const out = buildPartsInventoryDeductions([
    inv('i1', 2), oneOff(1), inv('i2', 1),
  ]);
  check('returns 2 entries (only inventory-sourced)', out.length === 2);
  check('entries use existing InventoryDeduction shape',
    out[0].id === 'i1' && out[0].size === '' && out[0].qty === 2 && out[0].cost === 5);
  check('second entry has correct id', out[1].id === 'i2');
}
{
  const out = buildPartsInventoryDeductions([]);
  check('empty input → empty array', out.length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
