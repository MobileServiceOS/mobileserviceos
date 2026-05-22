// tests/aiInsights.test.ts
// Run: npx tsx tests/aiInsights.test.ts

import { buildInsightsInput, parseInsightsResponse } from '@/lib/aiInsights';
import type { InsightsDigest } from '@/lib/aiInsights';
import type { Insights } from '@/lib/insights';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ buildInsightsInput ──────────────────────────────');
{
  const insights: Insights = {
    revenueTrend: [
      { weekStart: '2026-03-30', revenue: 1000.4, profit: 300.6 },
      { weekStart: '2026-04-06', revenue: 1500, profit: 500 },
    ],
    topServices: Array.from({ length: 7 }, (_, i) => ({
      service: `S${i}`, revenue: 100 * (i + 1), profit: 10 * (i + 1), count: i + 1,
    })),
    topSources: Array.from({ length: 7 }, (_, i) => ({
      source: `Src${i}`, revenue: 50 * (i + 1), count: i + 1,
    })),
    topCities: Array.from({ length: 7 }, (_, i) => ({
      city: `City${i}`, profit: 20 * (i + 1), count: i + 1,
    })),
    repeat: { total: 50, repeat: 17, pct: 34 },
    unpaidAging: [
      { bucket: '0-7d', count: 1, total: 100 },
      { bucket: '8-30d', count: 2, total: 200.5 },
      { bucket: '31-60d', count: 0, total: 0 },
      { bucket: '60d+', count: 3, total: 900 },
    ],
  };
  const d = buildInsightsInput(insights);
  check('weeks mapped with week/revenue/profit, rounded',
    d.weeks.length === 2 && d.weeks[0].week === '2026-03-30'
    && d.weeks[0].revenue === 1000 && d.weeks[0].profit === 301);
  check('totalRevenue8w = rounded sum of trend revenue', d.totalRevenue8w === 2500);
  check('totalProfit8w = rounded sum of trend profit', d.totalProfit8w === 801);
  check('topServices capped at 5', d.topServices.length === 5);
  check('topSources capped at 5', d.topSources.length === 5);
  check('topCities capped at 5', d.topCities.length === 5);
  check('repeat fields carried',
    d.repeatCustomerPct === 34 && d.repeatCustomers === 17 && d.totalCustomers === 50);
  check('unpaid buckets carried + rounded',
    d.unpaid.length === 4 && d.unpaid[1].total === 201 && d.unpaid[1].count === 2);
  check('totalUnpaid = rounded sum of bucket totals', d.totalUnpaid === 1201);
}

console.log('\n┌─ parseInsightsResponse ───────────────────────────');
const digest: InsightsDigest = {
  weeks: [
    { week: '2026-03-30', revenue: 1000, profit: 300 },
    { week: '2026-04-06', revenue: 1500, profit: 450 },
  ],
  totalRevenue8w: 2500,
  totalProfit8w: 750,
  topServices: [{ service: 'Brake Job', revenue: 1200, profit: 400, count: 8 }],
  topSources: [{ source: 'Google', revenue: 900, count: 5 }],
  topCities: [{ city: 'Austin', profit: 350, count: 6 }],
  repeatCustomerPct: 34,
  repeatCustomers: 17,
  totalCustomers: 50,
  unpaid: [{ bucket: '60d+', count: 2, total: 1200 }],
  totalUnpaid: 1200,
};
// digest numbers: 1000 300 1500 450 2500 750 1200 400 8 900 5 350 6 34 17 50 2

check('clean JSON, both bullets grounded → ok with 2 bullets',
  (() => { const r = parseInsightsResponse(
    '{"bullets":["Total revenue was 2500.","Brake Job profit was 400."]}', digest);
    return r.ok && r.bullets.length === 2; })());
check('JSON inside markdown fences extracted',
  (() => { const r = parseInsightsResponse(
    '```json\n{"bullets":["Revenue was 2500."]}\n```', digest);
    return r.ok && r.bullets.length === 1; })());
check('non-JSON → unparseable',
  (() => { const r = parseInsightsResponse('just some text', digest);
    return !r.ok && r.error === 'unparseable'; })());
check('non-array bullets → malformed',
  (() => { const r = parseInsightsResponse('{"bullets":"nope"}', digest);
    return !r.ok && r.error === 'malformed'; })());
check('bullet citing a number absent from the digest is dropped → ungrounded',
  (() => { const r = parseInsightsResponse('{"bullets":["Revenue grew by 9999."]}', digest);
    return !r.ok && r.error === 'ungrounded'; })());
check('bullet with no number is dropped → ungrounded',
  (() => { const r = parseInsightsResponse('{"bullets":["The business is thriving."]}', digest);
    return !r.ok && r.error === 'ungrounded'; })());
check('mixed: grounded bullet kept, ungrounded bullet dropped',
  (() => { const r = parseInsightsResponse(
    '{"bullets":["Revenue was 2500.","Profit was 8888."]}', digest);
    return r.ok && r.bullets.length === 1 && r.bullets[0] === 'Revenue was 2500.'; })());
check('every numeric token must be grounded — one bad token drops the bullet',
  (() => { const r = parseInsightsResponse('{"bullets":["2500 revenue from 7 jobs."]}', digest);
    return !r.ok && r.error === 'ungrounded'; })());
check('exact-duplicate bullets de-duplicated',
  (() => { const r = parseInsightsResponse(
    '{"bullets":["Revenue was 2500.","Revenue was 2500."]}', digest);
    return r.ok && r.bullets.length === 1; })());
check('survivors capped at 6',
  (() => { const r = parseInsightsResponse(JSON.stringify({ bullets: [
    'Value 2500.', 'Value 750.', 'Value 1200.', 'Value 400.',
    'Value 900.', 'Value 350.', 'Value 1000.', 'Value 1500.',
  ] }), digest);
    return r.ok && r.bullets.length === 6; })());
check('comma-formatted number normalised and matched',
  (() => { const r = parseInsightsResponse('{"bullets":["Revenue was 2,500 dollars."]}', digest);
    return r.ok && r.bullets.length === 1; })());

console.log(`\n  ${passed} passed, ${failed} failed`);
