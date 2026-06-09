// tests/planJobInventory.test.ts
// Run: npx tsx tests/planJobInventory.test.ts
//
// Pins the inventory plan extracted from saveJob: restore-on-edit, FIFO
// deduction, touched-item tracking, shortfall, and the resulting TOTAL
// tire cost. Pure — no emulator.

import { planJobInventory } from '@/lib/planJobInventory';
import type { InventoryItem } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const inv = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/45R17', qty: 0, cost: 0, ...over,
} as InventoryItem);

const qtyOf = (list: InventoryItem[], id: string) => Number(list.find((i) => i.id === id)?.qty ?? -1);

console.log('\n── basic FIFO deduction ──');
{
  const inventory = [inv({ id: 'a', qty: 10, cost: 80 })];
  const p = planJobInventory({ tireSize: '225/45R17', qty: 2, inventory, fallbackTireCost: 0 });
  check('deducts 2 from the matching item', qtyOf(p.nextInventory, 'a') === 8);
  check('one deduction recorded', p.deductions.length === 1 && p.deductions[0].qty === 2);
  check('touchedIds = [a]', p.touchedIds.length === 1 && p.touchedIds[0] === 'a');
  check('no shortfall', p.shortfall === 0);
  check('tireCost = 2 × 80 = 160 (TOTAL)', p.tireCost === 160, String(p.tireCost));
  check('input inventory not mutated', inventory[0].qty === 10);
}

console.log('\n── FIFO by cost: cheapest first ──');
{
  const inventory = [inv({ id: 'pricey', qty: 5, cost: 120 }), inv({ id: 'cheap', qty: 1, cost: 70 })];
  const p = planJobInventory({ tireSize: '225/45R17', qty: 3, inventory, fallbackTireCost: 0 });
  // 1 from cheap (70) + 2 from pricey (120) = 70 + 240 = 310.
  check('cheap drained first', qtyOf(p.nextInventory, 'cheap') === 0);
  check('remainder from pricey', qtyOf(p.nextInventory, 'pricey') === 3);
  check('both touched', p.touchedIds.includes('cheap') && p.touchedIds.includes('pricey'));
  check('weighted TOTAL = 310', p.tireCost === 310, String(p.tireCost));
}

console.log('\n── shortfall when stock is short ──');
{
  const inventory = [inv({ id: 'a', qty: 3, cost: 80 })];
  const p = planJobInventory({ tireSize: '225/45R17', qty: 5, inventory, fallbackTireCost: 0 });
  check('takes the 3 available', qtyOf(p.nextInventory, 'a') === 0);
  check('shortfall = 2', p.shortfall === 2, String(p.shortfall));
  check('tireCost = 3 × 80 = 240', p.tireCost === 240, String(p.tireCost));
}

console.log('\n── no matching size → fallback cost, no touch ──');
{
  const inventory = [inv({ id: 'a', qty: 10, cost: 80, size: '205/55R16' })];
  const p = planJobInventory({ tireSize: '225/45R17', qty: 2, inventory, fallbackTireCost: 99 });
  check('nothing deducted', p.deductions.length === 0 && p.touchedIds.length === 0);
  check('shortfall = full qty', p.shortfall === 2);
  check('tireCost falls back to existing', p.tireCost === 99, String(p.tireCost));
}

console.log('\n── edit: restore prev deductions before re-planning ──');
{
  // Item is at qty 6 because this job previously took 4. Re-saving the
  // same job (qty 4) must restore (→10) then re-deduct (→6) — net stable.
  const inventory = [inv({ id: 'a', qty: 6, cost: 80 })];
  const prevDeductions = [{ id: 'a', size: '225/45R17', qty: 4, cost: 80 }];
  const p = planJobInventory({ tireSize: '225/45R17', qty: 4, inventory, prevDeductions, fallbackTireCost: 0 });
  check('net qty unchanged at 6', qtyOf(p.nextInventory, 'a') === 6, String(qtyOf(p.nextInventory, 'a')));
  check('tireCost = 4 × 80 = 320', p.tireCost === 320, String(p.tireCost));
  check('net-zero change writes nothing', p.touchedIds.length === 0, JSON.stringify(p.touchedIds));
}

console.log('\n── edit: changing qty up restores then deducts more ──');
{
  // Previously took 2 (item now at 8); re-save with qty 5 → restore to 10,
  // deduct 5 → 5.
  const inventory = [inv({ id: 'a', qty: 8, cost: 80 })];
  const prevDeductions = [{ id: 'a', size: '225/45R17', qty: 2, cost: 80 }];
  const p = planJobInventory({ tireSize: '225/45R17', qty: 5, inventory, prevDeductions, fallbackTireCost: 0 });
  check('restored to 10 then deducted 5 → 5', qtyOf(p.nextInventory, 'a') === 5, String(qtyOf(p.nextInventory, 'a')));
  check('tireCost = 5 × 80 = 400', p.tireCost === 400, String(p.tireCost));
  check('changed item is persisted', p.touchedIds.includes('a'));
}

console.log('\n── edit: tire SIZE change persists the restore (bug fix) ──');
{
  // Job moves from size A (4 taken) to size B. The restored A stock MUST
  // be written back — previously the restore was local-only and lost on
  // sync. Plus B's new deduction.
  const inventory = [
    inv({ id: 'a', size: '225/45R17', qty: 6, cost: 80 }),   // prev took 4 of A
    inv({ id: 'b', size: '205/55R16', qty: 10, cost: 60 }),
  ];
  const prevDeductions = [{ id: 'a', size: '225/45R17', qty: 4, cost: 80 }];
  const p = planJobInventory({ tireSize: '205/55R16', qty: 2, inventory, prevDeductions, fallbackTireCost: 0 });
  check('A restored to 10', qtyOf(p.nextInventory, 'a') === 10, String(qtyOf(p.nextInventory, 'a')));
  check('B deducted to 8', qtyOf(p.nextInventory, 'b') === 8, String(qtyOf(p.nextInventory, 'b')));
  check('BOTH the A restore and the B deduction are persisted', p.touchedIds.includes('a') && p.touchedIds.includes('b'), JSON.stringify(p.touchedIds));
  check('tireCost from B = 2 × 60 = 120', p.tireCost === 120, String(p.tireCost));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
