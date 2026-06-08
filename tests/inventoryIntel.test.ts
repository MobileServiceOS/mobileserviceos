// tests/inventoryIntel.test.ts
// Run: npx tsx tests/inventoryIntel.test.ts
//
// Deterministic inventory intelligence: reorder / fast-movers / dead-stock.

import { computeInventoryIntel } from '@/lib/inventoryIntel';
import { normalizeTireSize } from '@/lib/utils';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

// velocity keyed by NORMALIZED size — exactly how the Inventory page
// builds the map (velocityBySize), so lookups in the helper match.
const vel = new Map<string, number>([
  ['235/40R18', 7],
  ['245/40R18', 5],
  ['205/65R16', 0],
  ['225/60R17', 2],
].map(([s, v]) => [normalizeTireSize(s as string), v as number]));

const items = [
  { id: 'a', size: '235/40R18', qty: 0, cost: 90, reorderPoint: 2 }, // in demand + out → reorder
  { id: 'b', size: '245/40R18', qty: 1, cost: 80, reorderPoint: 2 }, // in demand + low → reorder
  { id: 'c', size: '225/60R17', qty: 8, cost: 70, reorderPoint: 2 }, // in demand, well-stocked → not reorder
  { id: 'd', size: '205/65R16', qty: 4, cost: 60, reorderPoint: 1 }, // no velocity, in stock → dead ($240)
  { id: 'e', size: '315/35R20', qty: 3, cost: 100, reorderPoint: 1 }, // no velocity, in stock → dead ($300)
  { id: 'f', size: '', qty: 5, cost: 50 },                            // no size → ignored
];

console.log('\n── reorder (in demand + low) ──');
{
  const r = computeInventoryIntel(items, vel);
  check('reorderCount = 2', r.reorderCount === 2, String(r.reorderCount));
  check('reorder sorted by velocity (235 before 245)', r.reorderNow[0]?.id === 'a' && r.reorderNow[1]?.id === 'b');
  check('well-stocked in-demand NOT in reorder', !r.reorderNow.some((i) => i.id === 'c'));
}

console.log('\n── fast movers ──');
{
  const r = computeInventoryIntel(items, vel);
  check('top mover is 235/40R18 (7)', r.fastMovers[0]?.size === '235/40R18');
  check('zero-velocity excluded', !r.fastMovers.some((i) => i.velocity === 0));
}

console.log('\n── dead stock (in stock, not moving) ──');
{
  const r = computeInventoryIntel(items, vel);
  check('deadStockCount = 2', r.deadStockCount === 2, String(r.deadStockCount));
  check('dead ranked by tied $ (315 $300 before 205 $240)', r.deadStock[0]?.id === 'e' && r.deadStock[1]?.id === 'd');
  check('deadStockValue = 540', r.deadStockValue === 540, String(r.deadStockValue));
  check('sized-out / empty-size row ignored', !r.deadStock.some((i) => i.id === 'f'));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
