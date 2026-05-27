// tests/inventoryBulkMerge.test.ts
// Run: npx tsx tests/inventoryBulkMerge.test.ts

import { mergeBulkRows, type IncomingRow } from '@/lib/inventoryBulkMerge';
import type { InventoryItem } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// Deterministic id generator for test stability.
let counter = 0;
const nextId = () => `test-${++counter}`;
const resetIds = () => { counter = 0; };

const inv = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/65R17', qty: 0, cost: 0, condition: 'New',
  brand: '', model: '', notes: '',
  ...over,
});

const row = (over: Partial<IncomingRow>): IncomingRow => ({
  tireSize: '225/65R17',
  condition: 'New',
  quantity: 0, cost: 0, sellingPrice: 0,
  vendor: '', notes: '',
  ...over,
});

console.log('\n┌─ mergeBulkRows — same-batch dedup (the bug) ───');
{
  resetIds();
  // The exact scenario the user asked about: three lines of
  // "215/55R17" qty 1 each, pasted from notes. The result MUST be
  // one card with qty 3, not three cards or a corrupt row.
  const out = mergeBulkRows(
    [],
    [
      row({ tireSize: '215/55R17', quantity: 1 }),
      row({ tireSize: '215/55R17', quantity: 1 }),
      row({ tireSize: '215/55R17', quantity: 1 }),
    ],
    nextId,
  );
  check('three same-batch lines → one card with summed qty',
    out.next.length === 1
    && out.next[0].size === '215/55R17'
    && out.next[0].qty === 3
    && out.next[0].id === 'test-1'
    && out.next[0].condition === 'New');
  check('mergedCount counts the two merges', out.mergedCount === 2);
  check('addedCount counts only the first', out.addedCount === 1);
}
{
  resetIds();
  // Mixed: same-batch dedup PLUS dedup against existing inventory.
  const existing: InventoryItem[] = [
    inv({ id: 'e1', size: '225/65R17', qty: 5 }),
  ];
  const out = mergeBulkRows(
    existing,
    [
      row({ tireSize: '225/65R17', quantity: 2 }),         // merges into existing
      row({ tireSize: '275/35R20', quantity: 1 }),         // new
      row({ tireSize: '275/35R20', quantity: 4 }),         // merges into the new row above
      row({ tireSize: '225/65R17', quantity: 3 }),         // merges into existing again
    ],
    nextId,
  );
  check('existing card qty bumps through both matches',
    out.next.find((i) => i.id === 'e1')?.qty === 5 + 2 + 3);
  check('new card created once, accumulates within batch',
    out.next.filter((i) => i.size === '275/35R20').length === 1
    && out.next.find((i) => i.size === '275/35R20')?.qty === 5);
  check('mergedCount counts all three merges', out.mergedCount === 3);
  check('addedCount counts the one new card', out.addedCount === 1);
}
{
  resetIds();
  // Different conditions on same size → SEPARATE cards.
  const out = mergeBulkRows(
    [],
    [
      row({ tireSize: '215/55R17', condition: 'New',  quantity: 2 }),
      row({ tireSize: '215/55R17', condition: 'Used', quantity: 1 }),
    ],
    nextId,
  );
  check('same size + different condition → two cards',
    out.next.length === 2
    && out.next.some((i) => i.condition === 'New' && i.qty === 2)
    && out.next.some((i) => i.condition === 'Used' && i.qty === 1));
}
{
  resetIds();
  // Empty incoming → list returned unchanged (cloned).
  const existing: InventoryItem[] = [inv({ id: 'e1', qty: 3 })];
  const out = mergeBulkRows(existing, [], nextId);
  check('empty incoming → list cloned through',
    out.next.length === 1 && out.next[0].id === 'e1' && out.next[0].qty === 3);
  check('empty incoming → zero merges and zero new', out.mergedCount === 0 && out.addedCount === 0);
}
{
  resetIds();
  // Does not mutate input list. After the call, the original `list`
  // entry's qty should be unchanged even though merged.qty differs.
  const existing: InventoryItem[] = [inv({ id: 'e1', size: '215/55R17', qty: 5 })];
  mergeBulkRows(
    existing,
    [row({ tireSize: '215/55R17', quantity: 10 })],
    nextId,
  );
  check('input list is NOT mutated', existing[0].qty === 5);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
