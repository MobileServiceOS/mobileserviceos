// tests/softStockWarning.test.ts
// Run: npx tsx tests/softStockWarning.test.ts

import { shouldWarnOnDeduction } from '@/lib/mechanicJob';
import type { JobPartLine, InventoryItem } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const inv = (id: string, qty: number): InventoryItem => ({
  id, size: '', qty, cost: 5, partName: id,
} as InventoryItem);
const line = (over: Partial<JobPartLine>): JobPartLine => ({
  name: 'p', qty: 1, unitPrice: 10, unitCost: 5,
  source: 'inventory', inventoryItemId: 'i1', ...over,
});

console.log('\n┌─ shouldWarnOnDeduction ─────────────────────────────');
check('qty 2 > onHand 1 → warn',
  shouldWarnOnDeduction(line({ qty: 2 }), [inv('i1', 1)]) === true);
check('qty 1 === onHand 1 → no warn',
  shouldWarnOnDeduction(line({ qty: 1 }), [inv('i1', 1)]) === false);
check('qty 1 < onHand 5 → no warn',
  shouldWarnOnDeduction(line({ qty: 1 }), [inv('i1', 5)]) === false);
check('non-inventory source (bought_for_job) never warns',
  shouldWarnOnDeduction(line({ source: 'bought_for_job' }), [inv('i1', 0)]) === false);
check('non-inventory source (special_order) never warns',
  shouldWarnOnDeduction(line({ source: 'special_order' }), [inv('i1', 0)]) === false);
check('item not found → no warn',
  shouldWarnOnDeduction(line({ inventoryItemId: 'missing' }), [inv('i1', 5)]) === false);
check('missing inventoryItemId → no warn',
  shouldWarnOnDeduction(line({ inventoryItemId: undefined }), [inv('i1', 5)]) === false);
check('edit: qty 3, oldLineQty 2 (delta 1), onHand 1 → no warn',
  shouldWarnOnDeduction(line({ qty: 3 }), [inv('i1', 1)], 2) === false);
check('edit: qty 5, oldLineQty 2 (delta 3), onHand 1 → warn',
  shouldWarnOnDeduction(line({ qty: 5 }), [inv('i1', 1)], 2) === true);
check('edit: qty reduced (delta negative), never warns',
  shouldWarnOnDeduction(line({ qty: 1 }), [inv('i1', 0)], 5) === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
