// tests/inventoryReservations.test.ts
// Run: npx tsx tests/inventoryReservations.test.ts

import {
  reservedQty, availableQty, addReservation, removeReservation,
} from '@/lib/inventoryReservations';
import type { InventoryItem, ReservedSlot } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/65R17', qty: 10, cost: 0, ...over,
});
const slot = (over: Partial<ReservedSlot>): ReservedSlot => ({
  id: 's', qty: 1, createdAt: '2026-05-22T12:00:00.000Z', ...over,
});

console.log('\n┌─ reservedQty ──────────────────────────────────────');
check('no reservations → 0', reservedQty(item({})) === 0);
check('empty array → 0', reservedQty(item({ reservations: [] })) === 0);
check('one slot of 2 → 2',
  reservedQty(item({ reservations: [slot({ qty: 2 })] })) === 2);
check('multiple slots sum',
  reservedQty(item({ reservations: [slot({ id: 'a', qty: 2 }), slot({ id: 'b', qty: 3 })] })) === 5);
check('non-finite slot qty treated as 0',
  reservedQty(item({ reservations: [slot({ qty: NaN as unknown as number })] })) === 0);

console.log('\n┌─ availableQty ─────────────────────────────────────');
check('no reservations → qty', availableQty(item({ qty: 10 })) === 10);
check('qty 10, reserved 3 → 7',
  availableQty(item({ qty: 10, reservations: [slot({ qty: 3 })] })) === 7);
check('over-reserved clamps to 0',
  availableQty(item({ qty: 2, reservations: [slot({ qty: 5 })] })) === 0);

console.log('\n┌─ addReservation ───────────────────────────────────');
{
  const before = item({ qty: 10 });
  const after = addReservation(before, 3, 'Smith 5pm', '2026-05-22T15:00:00.000Z');
  check('returns a new item (input not mutated)', before.reservations === undefined && after !== before);
  check('appends one slot', (after.reservations || []).length === 1);
  check('slot has qty', after.reservations![0].qty === 3);
  check('slot has label', after.reservations![0].label === 'Smith 5pm');
  check('slot has the provided createdAt',
    after.reservations![0].createdAt === '2026-05-22T15:00:00.000Z');
  check('slot has a non-empty id', typeof after.reservations![0].id === 'string' && after.reservations![0].id.length > 0);
}
{
  const before = item({ qty: 10 });
  const after = addReservation(before, 0, 'noop');
  check('addReservation(qty=0) returns the input reference unchanged', after === before);
  check('addReservation(qty=0) leaves reservations undefined', after.reservations === undefined);
}
{
  const before = item({ qty: 2, reservations: [slot({ qty: 2 })] });
  const after = addReservation(before, 1, 'over');
  check('addReservation(qty > availableQty) is rejected (length unchanged)',
    (after.reservations || []).length === 1);
}

console.log('\n┌─ removeReservation ────────────────────────────────');
{
  const before = item({
    qty: 10,
    reservations: [slot({ id: 'a', qty: 2 }), slot({ id: 'b', qty: 3 })],
  });
  const after = removeReservation(before, 'a');
  check('removes the matching slot', (after.reservations || []).length === 1);
  check('preserves the other slot', after.reservations![0].id === 'b');
  check('returns a new item', before !== after);
}
{
  const before = item({ qty: 10, reservations: [slot({ id: 'a', qty: 2 })] });
  const after = removeReservation(before, 'unknown-id');
  check('unknown id → unchanged length', (after.reservations || []).length === 1);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
