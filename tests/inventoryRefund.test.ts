// tests/inventoryRefund.test.ts
// Run: npx tsx tests/inventoryRefund.test.ts
//
// Pure-math coverage for the cancel-refund + delete-refund inventory
// path. Operators rely on this getting the numbers right — a bug here
// is silent inventory drift that they'd only notice when they go to
// the truck and find the count doesn't match the app.

import {
  refundJobDeductions,
  extractJobDeductions,
  planJobCancelRefund,
} from '@/lib/inventoryRefund';
import type { InventoryItem, Job } from '@/types';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function inv(over: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'inv-' + Math.random().toString(36).slice(2, 8),
    size: '225/65R17',
    brand: '',
    condition: 'New',
    qty: 4,
    cost: 60,
    sellingPrice: 0,
    vendor: '',
    notes: '',
    ...over,
  } as InventoryItem;
}

console.log('\n┌─ Empty / null input ──────────────────────────');
{
  const r = refundJobDeductions([], null, null);
  check('empty inventory + no deductions → empty + 0', r.inventory.length === 0 && r.totalRestored === 0);
}
{
  const items = [inv({ id: 'a', qty: 4 }), inv({ id: 'b', qty: 2 })];
  const r = refundJobDeductions(items, [], []);
  check('empty deduction arrays → inventory passes through', r.inventory.length === 2 && r.totalRestored === 0);
}
{
  const items = [inv({ id: 'a', qty: 4 })];
  const r = refundJobDeductions(items, null, undefined);
  check('null + undefined deductions → no change', r.inventory[0].qty === 4 && r.totalRestored === 0);
}

console.log('\n┌─ Single deduction refund (tire) ──────────────');
{
  const items = [inv({ id: 'a', qty: 4 })];
  const tireDeds = [{ id: 'a', qty: 2 }];
  const r = refundJobDeductions(items, tireDeds, null);
  check('qty restored: 4 + 2 = 6', Number(r.inventory[0].qty) === 6);
  check('totalRestored = 2', r.totalRestored === 2);
}

console.log('\n┌─ Multiple deductions, same item ──────────────');
{
  const items = [inv({ id: 'a', qty: 4 })];
  const tireDeds = [
    { id: 'a', qty: 2 },
    { id: 'a', qty: 1 },
  ];
  const r = refundJobDeductions(items, tireDeds, null);
  check('repeat deductions add up: 4 + 2 + 1 = 7', Number(r.inventory[0].qty) === 7);
  check('totalRestored = 3', r.totalRestored === 3);
}

console.log('\n┌─ Multiple items refunded ─────────────────────');
{
  const items = [
    inv({ id: 'a', qty: 4 }),
    inv({ id: 'b', qty: 2 }),
    inv({ id: 'c', qty: 0 }),
  ];
  const tireDeds = [
    { id: 'a', qty: 2 },
    { id: 'b', qty: 1 },
  ];
  const r = refundJobDeductions(items, tireDeds, null);
  const a = r.inventory.find((x) => x.id === 'a')!;
  const b = r.inventory.find((x) => x.id === 'b')!;
  const c = r.inventory.find((x) => x.id === 'c')!;
  check('a: 4 + 2 = 6', Number(a.qty) === 6);
  check('b: 2 + 1 = 3', Number(b.qty) === 3);
  check('c unchanged at 0', Number(c.qty) === 0);
  check('totalRestored = 3', r.totalRestored === 3);
}

console.log('\n┌─ Deleted item — silently skipped ─────────────');
{
  const items = [inv({ id: 'a', qty: 4 })];
  const tireDeds = [
    { id: 'a', qty: 2 },
    { id: 'deleted-item', qty: 5 }, // SKU was deleted between deduction and refund
  ];
  const r = refundJobDeductions(items, tireDeds, null);
  check('only existing item refunded: a = 6', Number(r.inventory[0].qty) === 6);
  check('totalRestored counts only applied refunds (2)', r.totalRestored === 2);
}

console.log('\n┌─ Tire + mechanic-parts both refunded ─────────');
{
  const items = [
    inv({ id: 'tire-1', qty: 4 }),
    inv({ id: 'part-1', qty: 0 }),
  ];
  const tireDeds = [{ id: 'tire-1', qty: 4 }];
  const partsDeds = [{ id: 'part-1', qty: 1 }];
  const r = refundJobDeductions(items, tireDeds, partsDeds);
  check('tire refunded: 4 + 4 = 8', Number(r.inventory.find((x) => x.id === 'tire-1')!.qty) === 8);
  check('part refunded: 0 + 1 = 1', Number(r.inventory.find((x) => x.id === 'part-1')!.qty) === 1);
  check('totalRestored = 5 (across both arrays)', r.totalRestored === 5);
}

console.log('\n┌─ String-typed qty coercion ───────────────────');
{
  const items = [inv({ id: 'a', qty: '4' as unknown as number })];
  const tireDeds = [{ id: 'a', qty: '2' as unknown as number }];
  const r = refundJobDeductions(items, tireDeds, null);
  check('string qtys add as numbers', Number(r.inventory[0].qty) === 6);
}

console.log('\n┌─ Zero / negative / NaN qty → no-op ───────────');
{
  const items = [inv({ id: 'a', qty: 4 })];
  const r1 = refundJobDeductions(items, [{ id: 'a', qty: 0 }], null);
  check('qty 0 → no change', Number(r1.inventory[0].qty) === 4 && r1.totalRestored === 0);
  const r2 = refundJobDeductions(items, [{ id: 'a', qty: -3 }], null);
  check('negative qty → no change (safer than deducting)', Number(r2.inventory[0].qty) === 4 && r2.totalRestored === 0);
  const r3 = refundJobDeductions(items, [{ id: 'a', qty: NaN }], null);
  check('NaN qty → no change', Number(r3.inventory[0].qty) === 4 && r3.totalRestored === 0);
}

console.log('\n┌─ Caller inventory reference preserved ────────');
{
  const items: InventoryItem[] = [inv({ id: 'a', qty: 4 })];
  const original = items[0];
  const r = refundJobDeductions(items, [{ id: 'a', qty: 2 }], null);
  check('original array not mutated', items[0] === original && Number(items[0].qty) === 4);
  check('returned item is a fresh object', r.inventory[0] !== original);
}

console.log('\n┌─ extractJobDeductions — type-guard accessor ──');
{
  const job: Job = {
    id: 'j1',
    inventoryDeductions: [{ id: 'a', size: '225/65R17', qty: 2, cost: 60 }],
    partsInventoryDeductions: [{ id: 'p1', size: '', qty: 1, cost: 10 }],
  } as unknown as Job;
  const { tireDeds, partsDeds } = extractJobDeductions(job);
  check('tireDeds extracted', Array.isArray(tireDeds) && tireDeds!.length === 1);
  check('partsDeds extracted', Array.isArray(partsDeds) && partsDeds!.length === 1);
}
{
  const job: Job = { id: 'j1' } as Job;
  const { tireDeds, partsDeds } = extractJobDeductions(job);
  check('missing arrays → null/null', tireDeds === null && partsDeds === null);
}
{
  const { tireDeds, partsDeds } = extractJobDeductions(null);
  check('null job → null/null', tireDeds === null && partsDeds === null);
}

console.log('\n┌─ Realistic cancel scenario ───────────────────');
{
  // Operator cancels a Completed job that had deducted 4 tires
  // from one bin (qty 4) and 2 from another (qty 2). After
  // cancel, both bins should reflect the original pre-deduction
  // counts (8 and 4 respectively).
  const items = [
    inv({ id: 'bin-a', qty: 4 }),  // was 8, deducted 4
    inv({ id: 'bin-b', qty: 2 }),  // was 4, deducted 2
  ];
  const tireDeds = [
    { id: 'bin-a', qty: 4 },
    { id: 'bin-b', qty: 2 },
  ];
  const r = refundJobDeductions(items, tireDeds, null);
  check('bin-a restored to 8', Number(r.inventory.find((x) => x.id === 'bin-a')!.qty) === 8);
  check('bin-b restored to 4', Number(r.inventory.find((x) => x.id === 'bin-b')!.qty) === 4);
  check('totalRestored = 6', r.totalRestored === 6);
}

console.log('\n┌─ planJobCancelRefund: restores a cancelled job + touched ids ──');
{
  const inventory = [inv({ id: 'a', qty: 6, cost: 80 }), inv({ id: 'b', qty: 2, cost: 60 })];
  const prevJob = {
    id: 'j1',
    inventoryDeductions: [{ id: 'a', size: '225/45R17', qty: 4, cost: 80 }],
    partsInventoryDeductions: [{ id: 'b', size: 'pad', qty: 2, cost: 60 }],
  } as unknown as Job;
  const p = planJobCancelRefund(prevJob, inventory);
  check('a restored 6 → 10', Number(p.nextInventory.find((x) => x.id === 'a')!.qty) === 10);
  check('b restored 2 → 4', Number(p.nextInventory.find((x) => x.id === 'b')!.qty) === 4);
  check('both items touched', p.touchedIds.includes('a') && p.touchedIds.includes('b'));
  check('totalRestored = 6', p.totalRestored === 6);
  check('input inventory not mutated', Number(inventory[0].qty) === 6);
}

console.log('\n┌─ planJobCancelRefund: no prior deductions ⇒ no-op ──');
{
  const inventory = [inv({ id: 'a', qty: 10, cost: 80 })];
  const p = planJobCancelRefund({ id: 'j2' } as unknown as Job, inventory);
  check('inventory unchanged', Number(p.nextInventory.find((x) => x.id === 'a')!.qty) === 10);
  check('nothing touched', p.touchedIds.length === 0);
  check('totalRestored = 0', p.totalRestored === 0);
}

console.log('\n┌─ planJobCancelRefund: deduction for a deleted item is skipped ──');
{
  const inventory = [inv({ id: 'a', qty: 5, cost: 80 })];
  const prevJob = {
    id: 'j3',
    inventoryDeductions: [{ id: 'gone', size: '225/45R17', qty: 4, cost: 80 }],
  } as unknown as Job;
  const p = planJobCancelRefund(prevJob, inventory);
  check('surviving item untouched', Number(p.nextInventory.find((x) => x.id === 'a')!.qty) === 5);
  check('no phantom touch for deleted item', p.touchedIds.length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
