// tests/bandileroInventoryIntel.test.ts
// Run: npx tsx tests/bandileroInventoryIntel.test.ts
//
// Inventory intelligence: reorder suggestions are low/out-of-stock items
// whose SIZE still has recent demand (idle/dead stock excluded), ranked
// by demand × margin; dead-stock $ and top-seller. All LIVE.

import { inventoryIntel, reorderSuggestions, recentDemandBySize } from '@/lib/bandilero/services/inventoryIntel';
import { normalizeTireSize } from '@/lib/utils';
import type { InventoryItem, Job } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const item = (o: Partial<InventoryItem>): InventoryItem =>
  ({ id: Math.random().toString(36).slice(2), size: '', qty: 0, cost: 0, ...o } as InventoryItem);
function job(size: string, revenue = 200): Job {
  return {
    id: Math.random().toString(36).slice(2), date: TODAY, service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: '', customerPhone: '',
    tireSize: size, qty: 1, revenue, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  } as Job;
}

const items: InventoryItem[] = [
  item({ size: '225/65R17', qty: 1, cost: 80, retailPrice: 120, reorderPoint: 1 }), // low + has demand → reorder
  item({ size: '305/35R20', qty: 0, cost: 50, retailPrice: 90 }),                   // out of stock, NO demand → not reorder
  item({ size: '275/40R19', qty: 5, cost: 60 }),                                    // above reorder + no demand → dead stock
];
// Demand only for 225/65R17 (×2) — drives reorder + top-seller.
const jobs: Job[] = [job('225/65R17'), job('225/65R17')];

console.log('\n── recentDemandBySize ──');
{
  const d = recentDemandBySize(jobs, TODAY);
  // Keyed by NORMALIZED size (normalizeTireSize strips the slash).
  check('225/65R17 demand = 2', d.get(normalizeTireSize('225/65R17')) === 2, `got ${d.get(normalizeTireSize('225/65R17'))}`);
  check('305/35R20 demand absent', !d.has(normalizeTireSize('305/35R20')));
}

console.log('\n── reorderSuggestions ──');
{
  const s = reorderSuggestions(items, jobs, TODAY);
  check('1 reorder suggestion (only the in-demand low item)', s.length === 1, `got ${s.length}`);
  check('it is 225/65R17', s[0]?.item.size === '225/65R17');
  check('demand = 2', s[0]?.demand === 2);
  check('unitMargin = 40 (120 − 80)', s[0]?.unitMargin === 40, `got ${s[0]?.unitMargin}`);
  check('priority = 80 (2 × 40)', s[0]?.priority === 80, `got ${s[0]?.priority}`);
  check('out-of-stock with NO demand excluded', !s.some((x) => x.item.size === '305/35R20'));
}

console.log('\n── inventoryIntel ──');
{
  const r = inventoryIntel(items, jobs, TODAY);
  check('reorderCount LIVE = 1', r.reorderCount.state === 'LIVE' && r.reorderCount.value === 1);
  check('deadValue LIVE = 300 (275/40R19: 5 × $60)', r.deadValue.value === 300, `got ${r.deadValue.value}`);
  check('topSellerSize = 225/65R17', r.topSellerSize === '225/65R17');
  check('no demand at all → topSellerSize null', inventoryIntel(items, [], TODAY).topSellerSize === null);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
