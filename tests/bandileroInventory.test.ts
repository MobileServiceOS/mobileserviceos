// tests/bandileroInventory.test.ts
// Run: npx tsx tests/bandileroInventory.test.ts
//
// Inventory service: health-bucket counts (reusing inventoryHealthCounts),
// low-stock (reorderPoint rule), out-of-stock, and dead-stock $ value.
// Inventory is a real collection → metrics are LIVE (a 0 count is a true
// fact, not a fake substitution).

import {
  lowStockItems, outOfStockItems, deadStockValue, inventoryAlertMetrics,
} from '@/lib/bandilero/services/inventory';
import type { InventoryItem, Job } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';

function item(over: Partial<InventoryItem>): InventoryItem {
  return { id: Math.random().toString(36).slice(2), size: '', qty: 0, cost: 0, ...over } as InventoryItem;
}
function job(over: Partial<Job>): Job {
  return {
    id: Math.random().toString(36).slice(2), date: TODAY, service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    ...over,
  } as Job;
}

const items: InventoryItem[] = [
  item({ size: '225/65R17', qty: 0, cost: 80 }),                  // critical
  item({ size: '225/65R17', qty: 1, cost: 80 }),                  // low (qty<=1)
  item({ size: '225/65R17', qty: 5, cost: 80 }),                  // healthy (size sold recently)
  item({ size: '305/35R20', qty: 4, cost: 80 }),                  // dead (no matching job) → $320
  item({ size: '275/40R19', qty: 3, cost: 50, reorderPoint: 5 }), // low by reorderPoint, healthy bucket-wise (no job)
];
// Recent jobs make 225/65R17 and 275/40R19 "sold recently" so qty>1 of
// those sizes is healthy, not dead — leaving 305/35R20 as the only dead size.
const jobs: Job[] = [
  job({ tireSize: '225/65R17', date: TODAY, status: 'Completed', revenue: 200 }),
  job({ tireSize: '275/40R19', date: TODAY, status: 'Completed', revenue: 180 }),
];

console.log('\n── inventoryAlertMetrics (LIVE) ──');
{
  const m = inventoryAlertMetrics(items, jobs, TODAY);
  check('critical = 1', m.critical.value === 1, `got ${m.critical.value}`);
  check('low (qty<=1) = 1', m.low.value === 1, `got ${m.low.value}`);
  check('dead = 1 (305/35R20 unsold)', m.dead.value === 1, `got ${m.dead.value}`);
  check('deadValue = 320 (4 × $80)', m.deadValue.value === 320, `got ${m.deadValue.value}`);
  check('all metrics LIVE', [m.critical, m.low, m.dead, m.deadValue].every(x => x.state === 'LIVE'));
}

console.log('\n── lowStockItems (reorderPoint rule) ──');
{
  const low = lowStockItems(items);
  // qty 1 (reorderPoint default 1) and qty 3 (reorderPoint 5) qualify; qty 5 does not; qty 0 is out, not low.
  check('2 low-stock items', low.length === 2, `got ${low.length}`);
  check('does not include out-of-stock (qty 0)', !low.some(i => Number(i.qty) === 0));
  check('includes qty 3 with reorderPoint 5', low.some(i => Number(i.qty) === 3));
}

console.log('\n── outOfStockItems ──');
{
  const oos = outOfStockItems(items);
  check('1 out-of-stock item', oos.length === 1);
  check('it is the qty-0 item', Number(oos[0].qty) === 0);
}

console.log('\n── deadStockValue ──');
{
  check('dead stock value = 320', deadStockValue(items, jobs, TODAY) === 320, `got ${deadStockValue(items, jobs, TODAY)}`);
  check('empty inventory → 0', deadStockValue([], jobs, TODAY) === 0);
}

console.log('\n── empty inventory is LIVE zero (not NOT_CONNECTED) ──');
{
  const m = inventoryAlertMetrics([], [], TODAY);
  check('critical LIVE 0 on empty collection', m.critical.state === 'LIVE' && m.critical.value === 0);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
