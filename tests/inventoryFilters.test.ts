// tests/inventoryFilters.test.ts
// Run: npx tsx tests/inventoryFilters.test.ts

import { matchesSmartChip, SMART_CHIPS } from '@/lib/inventoryFilters';
import type { InventoryItem } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '', qty: 0, cost: 0,
  ...over,
});

console.log('\n┌─ SMART_CHIPS list ─────────────────────────────────');
check('SMART_CHIPS has 7 chips in documented order',
  JSON.stringify(SMART_CHIPS) === JSON.stringify(
    ['Run Flat', 'Truck', 'Commercial', 'Tesla', 'Trailer', 'Low Profile', 'SUV']));

console.log('\n┌─ matchesSmartChip — substring chips ───────────────');
check("'Run Flat' matches 'run flat' in notes (case-insensitive)",
  matchesSmartChip(item({ notes: 'Run Flat tire, premium' }), 'Run Flat'));
check("'Run Flat' matches in model",
  matchesSmartChip(item({ model: 'RUN FLAT Series' }), 'Run Flat'));
check("'Run Flat' matches in brand",
  matchesSmartChip(item({ brand: 'Bridgestone Run Flat' }), 'Run Flat'));
check("'Run Flat' rejects when absent",
  !matchesSmartChip(item({ notes: 'standard tire' }), 'Run Flat'));

check("'Truck' matches 'truck' in notes",
  matchesSmartChip(item({ notes: 'Heavy truck use' }), 'Truck'));
check("'Truck' rejects when absent",
  !matchesSmartChip(item({ notes: 'sedan' }), 'Truck'));

check("'Commercial' matches in notes",
  matchesSmartChip(item({ notes: 'Commercial fleet' }), 'Commercial'));
check("'Tesla' matches in notes",
  matchesSmartChip(item({ notes: 'Tesla Model 3' }), 'Tesla'));
check("'Trailer' matches in notes",
  matchesSmartChip(item({ notes: 'trailer use' }), 'Trailer'));
check("'SUV' matches in notes",
  matchesSmartChip(item({ notes: 'For SUV vehicles' }), 'SUV'));

console.log('\n┌─ matchesSmartChip — Low Profile heuristic ─────────');
check("'Low Profile' matches aspect ratio 40 (e.g. 245/40R18)",
  matchesSmartChip(item({ size: '245/40R18' }), 'Low Profile'));
check("'Low Profile' matches aspect ratio 30",
  matchesSmartChip(item({ size: '255/30R20' }), 'Low Profile'));
check("'Low Profile' matches 49 (boundary, < 50)",
  matchesSmartChip(item({ size: '225/49R17' }), 'Low Profile'));
check("'Low Profile' rejects aspect ratio 50 (boundary)",
  !matchesSmartChip(item({ size: '225/50R17' }), 'Low Profile'));
check("'Low Profile' rejects aspect ratio 65",
  !matchesSmartChip(item({ size: '225/65R17' }), 'Low Profile'));
check("'Low Profile' substring fallback works when size is malformed",
  matchesSmartChip(item({ size: 'GARBAGE', notes: 'Low profile look' }), 'Low Profile'));
check("'Low Profile' rejects when size malformed AND no substring",
  !matchesSmartChip(item({ size: 'GARBAGE', notes: 'normal' }), 'Low Profile'));

console.log('\n┌─ matchesSmartChip — case insensitivity ────────────');
check("'Tesla' matches 'TESLA' (uppercase)",
  matchesSmartChip(item({ notes: 'TESLA Model Y' }), 'Tesla'));
check("'Truck' matches 'tRuCk' (mixed case)",
  matchesSmartChip(item({ brand: 'tRuCk Tires Co' }), 'Truck'));

console.log(`\n  ${passed} passed, ${failed} failed`);
