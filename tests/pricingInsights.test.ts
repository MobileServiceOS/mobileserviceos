// tests/pricingInsights.test.ts
// Run: npx tsx tests/pricingInsights.test.ts

import {
  buildPricingDigest,
  parsePricingInsightsResponse,
  countCompletedJobsInWindow,
} from '@/lib/pricingInsights';
import type { PricingDigest } from '@/lib/pricingInsights';
import type { Job, Settings, ServicePricing } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const TODAY = '2026-05-26';

// Job factory — only sets the fields buildPricingDigest reads.
const job = (over: Partial<Job>): Job => ({
  id: 'j',
  date: TODAY,
  status: 'Completed',
  service: 'Tire Installation',
  tireSize: '225/65R17',
  revenue: 150,
  ...over,
} as Job);

// Settings factory — supplies servicePricing entries.
const settings = (
  servicePricing: Record<string, ServicePricing> = {},
): Settings => ({
  servicePricing,
} as Settings);

const sp = (basePrice: number): ServicePricing => ({
  enabled: true, basePrice, minProfit: 0,
});

console.log('\n┌─ buildPricingDigest — filters ──────────────────');
{
  // 2 sales for one (service, size) → fewer than MIN_SALES_PER_GROUP (3)
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 160 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('groups with <3 sales are excluded', d.groups.length === 0);
}
{
  // Mix of in-window and out-of-window (>90 days old)
  const jobs = [
    job({ id: 'in1', date: TODAY, revenue: 150 }),
    job({ id: 'in2', date: TODAY, revenue: 160 }),
    job({ id: 'in3', date: TODAY, revenue: 170 }),
    job({ id: 'old', date: '2025-01-01', revenue: 999 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('jobs outside 90-day window are excluded',
    d.groups.length === 1 && d.groups[0].sales === 3);
}
{
  // Non-Completed status filtered out
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 160 }),
    job({ id: 'c', revenue: 170 }),
    job({ id: 'p', status: 'Pending', revenue: 999 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('non-Completed jobs are excluded',
    d.groups.length === 1 && d.groups[0].sales === 3);
}
{
  // Three sales but service has no servicePricing entry (basePrice === 0)
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 160 }),
    job({ id: 'c', revenue: 170 }),
  ];
  const d = buildPricingDigest(jobs, settings({}), TODAY);
  check('groups with no basePrice are excluded', d.groups.length === 0);
}

console.log('\n┌─ buildPricingDigest — statistics ───────────────');
{
  // Odd count → exact median.
  const jobs = [
    job({ id: 'a', revenue: 100 }),
    job({ id: 'b', revenue: 200 }),
    job({ id: 'c', revenue: 150 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(120) }),
    TODAY,
  );
  check('median is correct for odd count', d.groups[0].medianRevenue === 150);
}
{
  // Even count → avg of two middle values.
  const jobs = [
    job({ id: 'a', revenue: 100 }),
    job({ id: 'b', revenue: 150 }),
    job({ id: 'c', revenue: 160 }),
    job({ id: 'd', revenue: 200 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(120) }),
    TODAY,
  );
  check('median is correct for even count', d.groups[0].medianRevenue === 155);
}
{
  // p25 / p75 via linear-interp percentile.
  // 5 values evenly spaced: 100, 125, 150, 175, 200
  // p25 = sorted[1] = 125; p75 = sorted[3] = 175
  const jobs = [100, 125, 150, 175, 200].map((rev, i) =>
    job({ id: 'j' + i, revenue: rev }));
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(120) }),
    TODAY,
  );
  check('p25 and p75 are correct', d.groups[0].p25Revenue === 125 && d.groups[0].p75Revenue === 175);
}
{
  // gapPct rounding sanity: (155 - 100) / 100 * 100 = 55
  const jobs = [
    job({ id: 'a', revenue: 150 }),
    job({ id: 'b', revenue: 155 }),
    job({ id: 'c', revenue: 160 }),
  ];
  const d = buildPricingDigest(
    jobs,
    settings({ 'Tire Installation': sp(100) }),
    TODAY,
  );
  check('gapPct is (median-base)/base*100 rounded', d.groups[0].gapPct === 55);
}

console.log('\n┌─ buildPricingDigest — top-N ordering ────────────');
{
  // Two services, equal sales, different gapPct → bigger |gap| sorts first
  const jobs: Job[] = [];
  // Service A: 3 sales at $150, base $100 → median 150, gap 50%
  for (let i = 0; i < 3; i++) {
    jobs.push(job({ id: 'a' + i, service: 'Installation', revenue: 150 }));
  }
  // Service B: 3 sales at $120, base $100 → median 120, gap 20%
  for (let i = 0; i < 3; i++) {
    jobs.push(job({ id: 'b' + i, service: 'Balance', revenue: 120 }));
  }
  const d = buildPricingDigest(
    jobs,
    settings({ Installation: sp(100), Balance: sp(100) }),
    TODAY,
  );
  check('top-N sorts by |gapPct| × sales desc',
    d.groups[0].service === 'Installation' && d.groups[1].service === 'Balance');
}

console.log('\n┌─ parsePricingInsightsResponse ──────────────────');
const digest: PricingDigest = {
  vertical: 'tire', windowDays: 90, totalCompletedJobs: 30, currency: 'USD',
  groups: [{
    service: 'Tire Installation', size: '225/65R17',
    sales: 6, medianRevenue: 165, p25Revenue: 155, p75Revenue: 175,
    configuredMin: 145, gapPct: 14,
  }],
};
{
  const res = parsePricingInsightsResponse('not json at all', digest);
  check('rejects non-JSON', !res.ok && res.error === 'unparseable');
}
{
  const res = parsePricingInsightsResponse('{"bullets": "not an array"}', digest);
  check('rejects wrong shape (bullets not array)',
    !res.ok && res.error === 'malformed');
}
{
  // Bullet with a number 999 NOT in the digest's number set
  const text = '{"bullets": ["Median for 225/65R17 is 999 dollars"]}';
  const res = parsePricingInsightsResponse(text, digest);
  check('drops a bullet containing a hallucinated number',
    !res.ok && res.error === 'ungrounded');
}
{
  // Two bullets — one with a hallucinated number, one fully grounded
  const text = JSON.stringify({
    bullets: [
      'Hallucinated median is 999 dollars',
      'Median for 225/65R17 sits at 165 dollars across 6 sales',
    ],
  });
  const res = parsePricingInsightsResponse(text, digest);
  check('drops the bad bullet, keeps the grounded one',
    res.ok && res.bullets.length === 1 && res.bullets[0].includes('165'));
}
{
  // Bullet quoting the size string verbatim AND a digest number
  const text = '{"bullets": ["The 225/65R17 line clusters at 165"]}';
  const res = parsePricingInsightsResponse(text, digest);
  check('keeps bullets that quote a size string verbatim',
    res.ok && res.bullets.length === 1);
}

console.log('\n┌─ countCompletedJobsInWindow ────────────────────');
{
  const jobs = [
    job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' }),
    job({ id: 'p', status: 'Pending' }),
    job({ id: 'o', date: '2025-01-01' }),
  ];
  check('counts only Completed jobs in window',
    countCompletedJobsInWindow(jobs, TODAY) === 3);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
