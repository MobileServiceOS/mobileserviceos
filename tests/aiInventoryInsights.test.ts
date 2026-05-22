// tests/aiInventoryInsights.test.ts
// Run: npx tsx tests/aiInventoryInsights.test.ts

import {
  buildInventoryInsightsInput,
  parseInventoryInsightsResponse,
} from '@/lib/aiInventoryInsights';
import type { InventoryInsightsDigest } from '@/lib/aiInventoryInsights';
import type { InventoryItem, Job, ReservedSlot } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const TODAY = '2026-05-22';
const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', size: '225/65R17', qty: 5, cost: 100, ...over,
});
const job = (over: Partial<Job>): Job => ({
  id: 'j', date: TODAY, tireSize: '225/65R17',
  ...over,
} as Job);
const slot = (over: Partial<ReservedSlot>): ReservedSlot => ({
  id: 's', qty: 1, createdAt: '2026-05-22T12:00:00.000Z', ...over,
});

console.log('\n┌─ buildInventoryInsightsInput ──────────────────────');
{
  const items: InventoryItem[] = [
    item({ id: 'a', qty: 5, cost: 100 }),                // value 500
    item({ id: 'b', qty: 0, cost: 200, size: '245/40R18' }),  // value 0
  ];
  const d = buildInventoryInsightsInput(items, [], TODAY);
  check('totalSKUs counts items', d.totalSKUs === 2);
  check('totalQty sums item qty', d.totalQty === 5);
  check('totalValue sums qty*cost rounded', d.totalValue === 500);
}
{
  const items: InventoryItem[] = [
    item({ id: 'a', qty: 0 }),  // critical
    item({ id: 'b', qty: 1 }),  // low
    item({ id: 'c', qty: 5, size: '245/40R18' }),  // dead (no jobs)
  ];
  const d = buildInventoryInsightsInput(items, [], TODAY);
  check('health counts delegated correctly',
    d.criticalCount === 1 && d.lowCount === 1 && d.deadCount === 1);
}
{
  // Six different sizes each sold once; topSelling caps at 5.
  const items: InventoryItem[] = [];
  const jobs: Job[] = [
    job({ id: 'j1', tireSize: '225/65R17' }),
    job({ id: 'j2', tireSize: '245/40R18' }),
    job({ id: 'j3', tireSize: '255/55R20' }),
    job({ id: 'j4', tireSize: '215/70R16' }),
    job({ id: 'j5', tireSize: '275/35R21' }),
    job({ id: 'j6', tireSize: '195/60R15' }),
  ];
  const d = buildInventoryInsightsInput(items, jobs, TODAY);
  check('topSelling caps at 5', d.topSelling.length === 5);
}
{
  // Same size sold three times → counted as 3.
  const items: InventoryItem[] = [];
  const jobs: Job[] = [
    job({ id: 'j1', tireSize: '225/65R17' }),
    job({ id: 'j2', tireSize: '225/65R17' }),
    job({ id: 'j3', tireSize: '225/65R17' }),
  ];
  const d = buildInventoryInsightsInput(items, jobs, TODAY);
  check('topSelling tallies repeated sizes',
    d.topSelling.length === 1 && d.topSelling[0].count === 3);
}
{
  // Slow movers: qty > 1 + no jobs in last 84d.
  const items: InventoryItem[] = [
    item({ id: 'fast', qty: 5, size: '225/65R17' }),
    item({ id: 'slow', qty: 5, size: '245/40R18' }),
  ];
  const jobs: Job[] = [
    job({ id: 'recent', date: TODAY, tireSize: '225/65R17' }),
  ];
  const d = buildInventoryInsightsInput(items, jobs, TODAY);
  check('slowMovers excludes items with recent matching jobs',
    !d.slowMovers.some((s) => s.size === '225/65R17'));
  check('slowMovers includes items with no recent jobs',
    d.slowMovers.some((s) => s.size === '245/40R18'));
}
{
  // topReserved excludes zero-reserved items, capped at 3.
  const items: InventoryItem[] = [
    item({ id: 'a', size: '1', qty: 10, reservations: [slot({ qty: 3 })] }),
    item({ id: 'b', size: '2', qty: 10, reservations: [slot({ qty: 5 })] }),
    item({ id: 'c', size: '3', qty: 10, reservations: [slot({ qty: 1 })] }),
    item({ id: 'd', size: '4', qty: 10, reservations: [slot({ qty: 2 })] }),
    item({ id: 'e', size: '5', qty: 10 }),
  ];
  const d = buildInventoryInsightsInput(items, [], TODAY);
  check('topReserved excludes zero-reserved items',
    !d.topReserved.some((r) => r.size === '5'));
  check('topReserved caps at 3', d.topReserved.length === 3);
  check('topReserved sorted by reserved desc',
    d.topReserved[0].reserved >= d.topReserved[1].reserved);
}

console.log('\n┌─ parseInventoryInsightsResponse ───────────────────');
const digest: InventoryInsightsDigest = {
  totalSKUs: 12,
  totalQty: 42,
  totalValue: 4200,
  criticalCount: 3,
  lowCount: 2,
  healthyCount: 5,
  deadCount: 2,
  topSelling: [{ size: '225/65R17', count: 4 }],
  slowMovers: [{ size: '275/35R21', qty: 6, daysSinceLastJob: 120 }],
  topReserved: [{ size: '245/40R18', reserved: 7, available: 1 }],
};
// digest numbers: 12, 42, 4200, 3, 2, 5, 4, 6, 120, 7, 1
// plus size-component digits: 225, 65, 17, 275, 35, 21, 245, 40, 18

check('clean grounded JSON kept',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Total inventory value is 4200.","The 225/65R17 sold 4 times recently."]}',
      digest);
    return r.ok && r.bullets.length === 2;
  })());
check('fenced JSON extracted',
  (() => {
    const r = parseInventoryInsightsResponse(
      '```json\n{"bullets":["Total inventory value is 4200."]}\n```',
      digest);
    return r.ok && r.bullets.length === 1;
  })());
check('non-JSON → unparseable',
  (() => {
    const r = parseInventoryInsightsResponse('not JSON', digest);
    return !r.ok && r.error === 'unparseable';
  })());
check('non-array bullets → malformed',
  (() => {
    const r = parseInventoryInsightsResponse('{"bullets":"nope"}', digest);
    return !r.ok && r.error === 'malformed';
  })());
check('bullet citing absent number → dropped → ungrounded when only',
  (() => {
    const r = parseInventoryInsightsResponse('{"bullets":["Value is 9999."]}', digest);
    return !r.ok && r.error === 'ungrounded';
  })());
check('mixed: grounded kept, ungrounded dropped',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Total qty 42.","Value soared 8888."]}', digest);
    return r.ok && r.bullets.length === 1 && r.bullets[0] === 'Total qty 42.';
  })());
check('tire size digits (225, 65, 17) accepted as grounded',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["The 225/65R17 size moves well."]}', digest);
    return r.ok && r.bullets.length === 1;
  })());
check('bullet with no number → dropped → ungrounded',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Things look good."]}', digest);
    return !r.ok && r.error === 'ungrounded';
  })());
check('exact-duplicate bullets de-duplicated',
  (() => {
    const r = parseInventoryInsightsResponse(
      '{"bullets":["Total qty 42.","Total qty 42."]}', digest);
    return r.ok && r.bullets.length === 1;
  })());
check('survivors capped at 6',
  (() => {
    const r = parseInventoryInsightsResponse(
      JSON.stringify({ bullets: [
        'Value 4200.', 'Total 42 units.', 'Critical 3.',
        'Low 2.', 'Healthy 5.', 'Dead 2.', 'SKUs 12.', 'Sold 4.',
      ] }),
      digest);
    return r.ok && r.bullets.length === 6;
  })());

console.log(`\n  ${passed} passed, ${failed} failed`);
