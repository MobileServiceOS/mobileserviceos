// tests/inventoryIntel.test.ts
// Run: npx tsx tests/inventoryIntel.test.ts
//
// Deterministic inventory intelligence: reorder / fast-movers / dead-stock.
// Covers the two bug fixes:
//   1. Demand is measured in JOBS, not tire units (set-of-4 ≠ 4× a single).
//   2. On-hand is aggregated PER SIZE across duplicate entries.

import { computeInventoryIntel, computeSizeDemand, sizeKey, type SizeDemand } from '@/lib/inventoryIntel';
import type { Job } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

function makeJob(over: Partial<Job>): Job {
  return {
    id: 'j' + Math.random().toString(36).slice(2, 8),
    status: 'Completed', date: '2026-05-01', tireSize: '', qty: 1, revenue: 0,
    tireCost: 0, materialCost: 0, miles: 0, note: '',
    emergency: false, lateNight: false, highway: false, weekend: false,
    tireSource: 'in_stock',
    ...over,
  } as Job;
}

const NOW = new Date('2026-05-28T12:00:00Z');
const demandMap = (entries: [string, SizeDemand][]) =>
  new Map(entries.map(([s, d]) => [sizeKey(s), d]));

// ── computeSizeDemand: JOBS vs UNITS ──────────────────────────────
console.log('\n── computeSizeDemand: jobs vs units ──');
{
  // One job selling a SET OF 4 of size A; four single-tire jobs of size B.
  // Both = the SAME units (4) but A is ONE job, B is FOUR jobs.
  const jobs: Job[] = [
    makeJob({ tireSize: '235/40R18', qty: 4, revenue: 400, date: '2026-05-20' }),
    ...Array.from({ length: 4 }, () => makeJob({ tireSize: '245/40R18', qty: 1, revenue: 100, date: '2026-05-20' })),
  ];
  const d = computeSizeDemand(jobs, { windowDays: 30, now: NOW });
  const a = d.get(sizeKey('235/40R18'))!;
  const b = d.get(sizeKey('245/40R18'))!;
  check('set-of-4 → jobs 1, units 4', a.jobs === 1 && a.units === 4, JSON.stringify(a));
  check('four singles → jobs 4, units 4', b.jobs === 4 && b.units === 4, JSON.stringify(b));
  check('units are EQUAL (4 vs 4)', a.units === b.units);
  check('jobs DIVERGE (1 vs 4)', a.jobs !== b.jobs);
}

console.log('\n── computeSizeDemand: window + status + normalization ──');
{
  const jobs: Job[] = [
    makeJob({ tireSize: '205/55R16', qty: 1, date: '2026-05-25' }),       // in 30d
    makeJob({ tireSize: '205/55/16', qty: 2, date: '2026-05-26' }),       // variant → same size, in 30d
    makeJob({ tireSize: '205/55R16', qty: 1, date: '2026-01-01' }),       // outside 30d
    makeJob({ tireSize: '205/55R16', qty: 1, date: '2026-05-25', status: 'Pending' }), // not Completed
  ];
  const d30 = computeSizeDemand(jobs, { windowDays: 30, now: NOW });
  const row = d30.get(sizeKey('205/55R16'))!;
  check('format variants group as one size', row !== undefined && row.jobs === 2, JSON.stringify(row));
  check('per-window: old job excluded (jobs=2 not 3)', row.jobs === 2);
  check('non-Completed excluded (units=3)', row.units === 3); // 1 + 2 only

  const dAll = computeSizeDemand(jobs, { windowDays: 'all', now: NOW });
  check('all-window includes the old job (jobs=3)', dAll.get(sizeKey('205/55R16'))!.jobs === 3);
}

// ── computeInventoryIntel: per-size on-hand aggregation ───────────
console.log('\n── per-size on-hand aggregation (the duplicate-entry bug) ──');
{
  // Two 205/55R16 line items: a Used one at 0 and a New one at 2.
  // Combined on-hand = 2, so with demand it should NOT reorder (2 > rp 1)
  // and must report a SINGLE consolidated qty of 2 — not 0.
  const items = [
    { id: 'used', size: '205/55R16', qty: 0, cost: 50, reorderPoint: 1 },
    { id: 'new', size: '205/55/16', qty: 2, cost: 60, reorderPoint: 1 }, // variant spelling
  ];
  const demand = demandMap([['205/55R16', { jobs: 3, units: 3, revenue: 300 }]]);
  const r = computeInventoryIntel(items, demand);
  const consolidated = r.fastMovers.find((i) => sizeKey(i.size) === sizeKey('205/55R16'));
  check('duplicate entries collapse to ONE size row', r.fastMovers.length === 1);
  check('consolidated on-hand = 2 (0 + 2), not 0', consolidated?.qty === 2, String(consolidated?.qty));
  check('combined stock 2 > reorderPoint 1 → NOT reorder', r.reorderCount === 0, String(r.reorderCount));
}

console.log('\n── reorder uses combined qty (0-on-hand-while-stock-exists) ──');
{
  const items = [
    { id: 'a1', size: '235/40R18', qty: 0, cost: 90, reorderPoint: 2 },
    { id: 'a2', size: '235/40R18', qty: 1, cost: 90, reorderPoint: 2 }, // combined = 1 ≤ 2
  ];
  const demand = demandMap([['235/40R18', { jobs: 5, units: 8, revenue: 800 }]]);
  const r = computeInventoryIntel(items, demand);
  check('one reorder row (consolidated)', r.reorderCount === 1, String(r.reorderCount));
  check('reorder on-hand is combined (1, not 0)', r.reorderNow[0]?.qty === 1, String(r.reorderNow[0]?.qty));
}

console.log('\n── reorder/fast ranked by JOBS, not units ──');
{
  const items = [
    { id: 'set', size: '275/40R20', qty: 0, cost: 100, reorderPoint: 1 },  // jobs 1, units 4
    { id: 'singles', size: '225/45R17', qty: 0, cost: 80, reorderPoint: 1 }, // jobs 3, units 3
  ];
  const demand = demandMap([
    ['275/40R20', { jobs: 1, units: 4, revenue: 400 }],
    ['225/45R17', { jobs: 3, units: 3, revenue: 300 }],
  ]);
  const r = computeInventoryIntel(items, demand);
  check('3-job size outranks 1-job set-of-4 (jobs not units)',
    r.reorderNow[0]?.size === '225/45R17' && r.fastMovers[0]?.size === '225/45R17');
}

console.log('\n── jobs tie-break: out-of-stock first, then revenue ──');
{
  const items = [
    { id: 'in', size: '215/55R17', qty: 5, cost: 70, reorderPoint: 1 },  // in stock
    { id: 'out', size: '215/60R17', qty: 0, cost: 70, reorderPoint: 1 }, // out
  ];
  const demand = demandMap([
    ['215/55R17', { jobs: 4, units: 4, revenue: 999 }],
    ['215/60R17', { jobs: 4, units: 4, revenue: 100 }],
  ]);
  const r = computeInventoryIntel(items, demand);
  check('equal jobs → out-of-stock ranks first', r.fastMovers[0]?.id === 'out');
}

console.log('\n── dead stock excludes any size with demand ──');
{
  const items = [
    { id: 'dead', size: '205/65R16', qty: 4, cost: 60, reorderPoint: 1 }, // jobs 0, in stock → dead $240
    { id: 'live', size: '235/40R18', qty: 6, cost: 90, reorderPoint: 1 }, // jobs > 0 → not dead
  ];
  const demand = demandMap([['235/40R18', { jobs: 2, units: 2, revenue: 200 }]]);
  const r = computeInventoryIntel(items, demand);
  check('dead-stock = the no-demand size only', r.deadStockCount === 1 && r.deadStock[0]?.id === 'dead');
  check('in-demand size NOT dead', !r.deadStock.some((i) => i.id === 'live'));
  check('deadStockValue = 240', r.deadStockValue === 240, String(r.deadStockValue));
}

console.log('\n── edge: empty-size rows ignored ──');
{
  const items = [{ id: 'blank', size: '', qty: 9, cost: 50 }];
  const r = computeInventoryIntel(items, new Map());
  check('blank-size row contributes nothing', r.reorderCount === 0 && r.deadStockCount === 0 && r.fastMovers.length === 0);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
