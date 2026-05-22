// tests/inventoryHealth.test.ts
// Run: npx tsx tests/inventoryHealth.test.ts

import {
  categorizeInventoryHealth, inventoryHealthCounts, HEALTH_BUCKETS,
} from '@/lib/inventoryHealth';
import type { InventoryItem, Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const TODAY = '2026-05-22';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/65R17', qty: 0, cost: 0, ...over,
});
const job = (over: Partial<Job>): Job => ({
  id: 'j', date: TODAY, tireSize: '225/65R17', ...over,
} as Job);

console.log('\n┌─ HEALTH_BUCKETS ───────────────────────────────────');
check('HEALTH_BUCKETS lists the four bucket keys in documented order',
  JSON.stringify(HEALTH_BUCKETS) ===
  JSON.stringify(['critical', 'low', 'healthy', 'dead']));

console.log('\n┌─ categorizeInventoryHealth ────────────────────────');
check('qty 0 → critical',
  categorizeInventoryHealth(item({ qty: 0 }), [], TODAY) === 'critical');
check('qty 1 → low',
  categorizeInventoryHealth(item({ qty: 1 }), [], TODAY) === 'low');
check('qty 2 + same-size job today → healthy',
  categorizeInventoryHealth(item({ qty: 2 }), [job({ date: TODAY })], TODAY) === 'healthy');
check('qty 2 + same-size job exactly 90 days old → healthy (boundary)',
  categorizeInventoryHealth(item({ qty: 2 }), [job({ date: '2026-02-21' })], TODAY) === 'healthy');
check('qty 2 + same-size job 91 days old → dead',
  categorizeInventoryHealth(item({ qty: 2 }), [job({ date: '2026-02-20' })], TODAY) === 'dead');
check('qty 2 + only mismatched-size jobs → dead',
  categorizeInventoryHealth(
    item({ qty: 2, size: '245/40R18' }),
    [job({ date: TODAY, tireSize: '225/65R17' })],
    TODAY,
  ) === 'dead');
check('qty 2 + no jobs at all → dead',
  categorizeInventoryHealth(item({ qty: 2 }), [], TODAY) === 'dead');
check('qty 2 + no size → healthy (no dead check without a size to match)',
  categorizeInventoryHealth(item({ qty: 2, size: '' }), [], TODAY) === 'healthy');
check('size normalization: "225 65 R 17" matches "225/65R17"',
  categorizeInventoryHealth(
    item({ qty: 2, size: '225/65R17' }),
    [job({ date: TODAY, tireSize: '225 65 R 17' })],
    TODAY,
  ) === 'healthy');
check('custom deadDays: 30 → 60-day-old job is dead',
  categorizeInventoryHealth(
    item({ qty: 2 }),
    [job({ date: '2026-03-23' })],
    TODAY,
    { deadDays: 30 },
  ) === 'dead');
check('custom deadDays: 365 → 200-day-old job is healthy',
  categorizeInventoryHealth(
    item({ qty: 2 }),
    [job({ date: '2025-11-03' })],
    TODAY,
    { deadDays: 365 },
  ) === 'healthy');

console.log('\n┌─ inventoryHealthCounts ────────────────────────────');
{
  const items: InventoryItem[] = [
    item({ id: 'a', qty: 0 }),                     // critical
    item({ id: 'b', qty: 0 }),                     // critical
    item({ id: 'c', qty: 1 }),                     // low
    item({ id: 'd', qty: 5, size: '225/65R17' }),  // healthy (recent job)
    item({ id: 'e', qty: 5, size: '245/40R18' }),  // dead (no matching)
  ];
  const jobs: Job[] = [job({ date: TODAY, tireSize: '225/65R17' })];
  const counts = inventoryHealthCounts(items, jobs, TODAY);
  check('counts.critical = 2', counts.critical === 2);
  check('counts.low = 1', counts.low === 1);
  check('counts.healthy = 1', counts.healthy === 1);
  check('counts.dead = 1', counts.dead === 1);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
