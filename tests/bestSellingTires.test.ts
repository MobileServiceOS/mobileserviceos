// tests/bestSellingTires.test.ts
// Run: npx tsx tests/bestSellingTires.test.ts
//
// Pure aggregation covering the BestSellersCard's data layer.
// Operators rely on this to decide what tires to stock — wrong
// numbers = wrong purchasing decisions, so the rules below are
// deliberately exhaustive on filter / grouping / ordering paths.

import { computeBestSellingTires } from '@/lib/bestSellingTires';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// Helper to build a minimal Completed job. Fields not set here are
// either undefined (fine — best-sellers doesn't read them) or default
// strings (Job type tolerates string-or-number for qty/revenue).
function makeJob(over: Partial<Job>): Job {
  return {
    id: 'j' + Math.random().toString(36).slice(2, 8),
    status: 'Completed',
    date: '2026-05-01',
    tireSize: '',
    qty: 0,
    revenue: 0,
    tireCost: 0,
    materialCost: 0,
    miles: 0,
    note: '',
    emergency: false,
    lateNight: false,
    highway: false,
    weekend: false,
    tireSource: 'in_stock',
    ...over,
  } as Job;
}

const NOW = new Date('2026-05-28T12:00:00Z');

console.log('\n┌─ Empty / null input ──────────────────────────');
check('null jobs → []', computeBestSellingTires(null).length === 0);
check('undefined jobs → []', computeBestSellingTires(undefined).length === 0);
check('empty array → []', computeBestSellingTires([]).length === 0);

console.log('\n┌─ Status filter — only Completed counted ──────');
{
  const jobs: Job[] = [
    makeJob({ status: 'Completed',  tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ status: 'Pending',    tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ status: 'Quoted',     tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ status: 'Canceled',   tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
  ];
  const out = computeBestSellingTires(jobs, { now: NOW });
  check('Pending / Quoted / Canceled excluded — only completed counted',
    out.length === 1 && out[0].quantity === 4 && out[0].jobCount === 1);
}

console.log('\n┌─ Size normalization — same physical size groups ──');
{
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '225/65-17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '225-65-17', qty: 4, revenue: 800, date: '2026-05-20' }),
  ];
  const out = computeBestSellingTires(jobs, { now: NOW });
  check('three syntactic variants of 225/65R17 → one row, qty 12',
    out.length === 1 && out[0].tireSize === '225/65R17' && out[0].quantity === 12 && out[0].jobCount === 3);
}

console.log('\n┌─ Ordering — by quantity DESC then revenue DESC ──');
{
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '245/40R18', qty: 8, revenue: 1600, date: '2026-05-20' }),
    makeJob({ tireSize: '275/35R20', qty: 8, revenue: 2400, date: '2026-05-20' }), // tie qty, higher rev
  ];
  const out = computeBestSellingTires(jobs, { now: NOW });
  check('tie on qty (8) → row with higher revenue wins tiebreak',
    out[0].tireSize === '275/35R20' && out[1].tireSize === '245/40R18' && out[2].tireSize === '225/65R17');
}

console.log('\n┌─ Window filter — only in-window jobs count ──');
{
  // NOW = 2026-05-28. 30-day window cutoff = 2026-04-28. 90-day = 2026-02-27.
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R17', qty: 4, revenue: 800,  date: '2026-05-20' }), // within 30
    makeJob({ tireSize: '245/40R18', qty: 4, revenue: 800,  date: '2026-04-05' }), // within 90 only
    makeJob({ tireSize: '275/35R20', qty: 4, revenue: 800,  date: '2025-12-01' }), // outside both
  ];
  const out30 = computeBestSellingTires(jobs, { now: NOW, windowDays: 30 });
  const out90 = computeBestSellingTires(jobs, { now: NOW, windowDays: 90 });
  const outAll = computeBestSellingTires(jobs, { now: NOW, windowDays: 'all' });
  check('30-day window → only 225/65R17', out30.length === 1 && out30[0].tireSize === '225/65R17');
  check('90-day window → 225 + 245', out90.length === 2);
  check("'all' window → all three", outAll.length === 3);
}

console.log('\n┌─ Bad data hygiene ─────────────────────────────');
{
  const jobs: Job[] = [
    makeJob({ tireSize: '',           qty: 4, revenue: 800, date: '2026-05-20' }), // empty size
    makeJob({ tireSize: '   ',        qty: 4, revenue: 800, date: '2026-05-20' }), // whitespace size
    makeJob({ tireSize: 'NotASize',   qty: 4, revenue: 800, date: '2026-05-20' }), // garbage
    makeJob({ tireSize: '225/65R17',  qty: 0, revenue: 0,   date: '2026-05-20' }), // no signal
    makeJob({ tireSize: '225/65R17',  qty: 2, revenue: 400, date: 'bad-date'    }), // unparseable date
    makeJob({ tireSize: '225/65R17',  qty: 4, revenue: 800, date: '2026-05-20' }), // GOOD
  ];
  const out = computeBestSellingTires(jobs, { now: NOW, windowDays: 30 });
  check('empty/whitespace/garbage size dropped; zero-signal dropped; bad-date dropped',
    out.length === 1 && out[0].tireSize === '225/65R17' && out[0].quantity === 4 && out[0].jobCount === 1);
}

console.log('\n┌─ Limit — top N enforced ───────────────────────');
{
  const jobs: Job[] = [];
  // Build 15 different sizes, descending qty.
  for (let i = 0; i < 15; i++) {
    jobs.push(makeJob({
      tireSize: `${200 + i}/55R17`,
      qty: 20 - i,
      revenue: (20 - i) * 200,
      date: '2026-05-20',
    }));
  }
  const top10 = computeBestSellingTires(jobs, { now: NOW });
  const top5 = computeBestSellingTires(jobs, { now: NOW, limit: 5 });
  check('default limit = 10', top10.length === 10);
  check('limit = 5 returns 5', top5.length === 5);
  check('top row is the highest-qty size', top10[0].tireSize === '200/55R17' && top10[0].quantity === 20);
}

console.log('\n┌─ avgPerTire — derived metric ──────────────────');
{
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }), // $200/tire
    makeJob({ tireSize: '225/65R17', qty: 2, revenue: 500, date: '2026-05-21' }), // $250/tire
  ];
  const out = computeBestSellingTires(jobs, { now: NOW });
  // qty 6, revenue 1300 → avg ~216.67
  check('avgPerTire is total revenue / total quantity',
    Math.abs(out[0].avgPerTire - (1300 / 6)) < 0.01);
}

console.log('\n┌─ String-typed qty/revenue (operator entry) ────');
{
  // Operators often enter qty/revenue via text fields; the Job type
  // tolerates `number | string`. The aggregator must coerce safely.
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R17', qty: '4'   as unknown as number, revenue: '800.50' as unknown as number, date: '2026-05-20' }),
    makeJob({ tireSize: '225/65R17', qty: '2.5' as unknown as number, revenue: '500'    as unknown as number, date: '2026-05-21' }),
  ];
  const out = computeBestSellingTires(jobs, { now: NOW });
  check('string-typed qty + revenue coerce correctly',
    out[0].quantity === 6.5 && Math.abs(out[0].revenue - 1300.5) < 0.01);
}

console.log('\n┌─ Sort: by size (numeric width / aspect / rim) ──');
{
  // Out-of-order input; size-sort should land them in
  // 215/55R17, 225/65R17, 235/40R18 — sorted by width then aspect then rim.
  const jobs: Job[] = [
    makeJob({ tireSize: '235/40R18', qty: 6, revenue: 1500, date: '2026-05-20' }),
    makeJob({ tireSize: '215/55R17', qty: 4, revenue: 800,  date: '2026-05-20' }),
    makeJob({ tireSize: '225/65R17', qty: 8, revenue: 1600, date: '2026-05-20' }),
  ];
  const out = computeBestSellingTires(jobs, { now: NOW, sortBy: 'size' });
  check('size-sort orders by width ASC: 215 → 225 → 235',
    out.length === 3
    && out[0].tireSize === '215/55R17'
    && out[1].tireSize === '225/65R17'
    && out[2].tireSize === '235/40R18');
}

console.log('\n┌─ Sort: by size — tie-break on aspect / rim ──');
{
  // Same width 225; aspect 60 / 65 / 70 should sort ASC.
  const jobs: Job[] = [
    makeJob({ tireSize: '225/70R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '225/60R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
  ];
  const out = computeBestSellingTires(jobs, { now: NOW, sortBy: 'size' });
  check('same width: ordered 60 → 65 → 70 on aspect',
    out[0].tireSize === '225/60R17'
    && out[1].tireSize === '225/65R17'
    && out[2].tireSize === '225/70R17');
}
{
  // Same width 225 + same aspect 65; rim 17 / 18 / 19 should sort ASC.
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R19', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '225/65R18', qty: 4, revenue: 800, date: '2026-05-20' }),
  ];
  const out = computeBestSellingTires(jobs, { now: NOW, sortBy: 'size' });
  check('same width + aspect: ordered 17 → 18 → 19 on rim',
    out[0].tireSize === '225/65R17'
    && out[1].tireSize === '225/65R18'
    && out[2].tireSize === '225/65R19');
}

console.log('\n┌─ Sort: by revenue ─────────────────────────────');
{
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R17', qty: 20, revenue: 500,  date: '2026-05-20' }), // high qty, low rev
    makeJob({ tireSize: '275/35R20', qty: 4,  revenue: 2400, date: '2026-05-20' }), // low qty, high rev
    makeJob({ tireSize: '245/40R18', qty: 8,  revenue: 1600, date: '2026-05-20' }),
  ];
  const out = computeBestSellingTires(jobs, { now: NOW, sortBy: 'revenue' });
  check('revenue-sort ranks 275/35R20 first ($2400) despite low qty',
    out[0].tireSize === '275/35R20' && out[1].tireSize === '245/40R18' && out[2].tireSize === '225/65R17');
}

console.log('\n┌─ Sort: default is quantity (no regression) ──');
{
  const jobs: Job[] = [
    makeJob({ tireSize: '225/65R17', qty: 4, revenue: 800, date: '2026-05-20' }),
    makeJob({ tireSize: '245/40R18', qty: 8, revenue: 1600, date: '2026-05-20' }),
  ];
  const outDefault = computeBestSellingTires(jobs, { now: NOW });
  const outExplicit = computeBestSellingTires(jobs, { now: NOW, sortBy: 'quantity' });
  check('default sort matches explicit quantity sort',
    outDefault.length === outExplicit.length
    && outDefault[0].tireSize === outExplicit[0].tireSize
    && outDefault[1].tireSize === outExplicit[1].tireSize
    && outDefault[0].tireSize === '245/40R18');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
