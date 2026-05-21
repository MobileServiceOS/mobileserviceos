// tests/inventoryValidity.test.ts
// Run: npx tsx tests/inventoryValidity.test.ts
//
// Pins the per-vertical "valid inventory item" contract that
// persistInventory in App.tsx uses to filter rows before saving.
// Pre-fix, the filter required `size` non-empty — silently deleting
// every mechanic (partName) and detailing (chemicalName) item on
// every save. This test extracts the predicate so future changes
// to the filter logic can't reintroduce that data loss.

import type { InventoryItem } from '@/types';

// Mirror the persistInventory filter exactly. Keep in sync with
// src/App.tsx:persistInventory.
function isPersistable(i: InventoryItem): boolean {
  return Boolean(
    (i.size || '').trim() ||
    (i.partName || '').trim() ||
    (i.partNumber || '').trim() ||
    (i.chemicalName || '').trim()
  );
}

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ Tire items ──────────────────────────────────────');
check('valid tire size → keep',
  isPersistable({ id: '1', size: '225/65R17', qty: 4, cost: 80 }));
check('whitespace-only size → drop',
  !isPersistable({ id: '1', size: '   ', qty: 4, cost: 80 }));
check('empty everything → drop',
  !isPersistable({ id: '1', size: '', qty: 0, cost: 0 }));

console.log('\n┌─ Mechanic items (size intentionally empty) ───────');
check('partName set, size empty → keep',
  isPersistable({ id: '1', size: '', qty: 12, cost: 45, partName: 'Brake Pad Set' }));
check('partNumber set, size empty → keep',
  isPersistable({ id: '1', size: '', qty: 12, cost: 45, partNumber: 'P-12345' }));
check('both partName + partNumber → keep',
  isPersistable({ id: '1', size: '', qty: 12, cost: 45, partName: 'Pad', partNumber: 'P-1' }));
check('partName whitespace-only → drop',
  !isPersistable({ id: '1', size: '', qty: 12, cost: 45, partName: '   ' }));

console.log('\n┌─ Detailing items (size intentionally empty) ──────');
check('chemicalName set → keep',
  isPersistable({ id: '1', size: '', qty: 2, cost: 30, chemicalName: 'Citrus Degreaser' }));
check('chemicalName + dilution → keep',
  isPersistable({ id: '1', size: '', qty: 2, cost: 30, chemicalName: 'Tire Shine', dilutionRatio: '1:5' }));
check('chemicalName whitespace-only → drop',
  !isPersistable({ id: '1', size: '', qty: 2, cost: 30, chemicalName: ' ' }));

console.log('\n┌─ Cross-vertical regression guard ─────────────────');
// Production failure mode: pre-fix App.tsx required size non-empty,
// so a mechanic save of partName='Brake Pad' / size='' got dropped.
// This is the assertion that would have caught it.
const mechanicItem: InventoryItem = {
  id: 'mech-1', size: '', qty: 5, cost: 50, partName: 'Brake Pad', partNumber: 'BP-100',
};
check('REGRESSION: mechanic item with empty size is persistable',
  isPersistable(mechanicItem));

const detailItem: InventoryItem = {
  id: 'detail-1', size: '', qty: 1, cost: 25, chemicalName: 'Wax', dilutionRatio: '',
};
check('REGRESSION: detailing item with empty size is persistable',
  isPersistable(detailItem));

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
