// tests/aiPricing.test.ts
// Run: npx tsx tests/aiPricing.test.ts

import { buildPricingInput, parsePricingResponse } from '@/lib/aiPricing';
import type { Job, QuoteForm, QuoteResult } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const job = (over: Partial<Job>): Job => ({
  service: 'Flat Tire Repair', revenue: 100, date: '2026-05-01',
  emergency: false, lateNight: false, highway: false, weekend: false,
  ...over,
} as Job);

const form = (over: Partial<QuoteForm>): QuoteForm => ({
  service: 'Flat Tire Repair', vehicleType: 'Car',
  emergency: false, lateNight: false, highway: false, weekend: false,
  ...over,
});

const quote: QuoteResult = {
  suggested: 120, premium: 160, directCosts: 40, targetProfit: 80,
};

console.log('\n┌─ buildPricingInput ───────────────────────────────');
{
  const input = buildPricingInput(form({ emergency: true, weekend: true }), quote, [], 'tire');
  check('conditions reflect true flags',
    JSON.stringify(input.conditions) === JSON.stringify(['emergency', 'weekend']));
  check('deterministicQuote lifted',
    input.deterministicQuote.suggested === 120
    && input.deterministicQuote.premium === 160
    && input.deterministicQuote.directCosts === 40);
  check('vertical passed through', input.vertical === 'tire');
  check('empty history → recentJobCount 0', input.history.recentJobCount === 0);
  check('empty history → null stats',
    input.history.avgPrice === null && input.history.medianPrice === null
    && input.history.minPrice === null && input.history.maxPrice === null
    && input.history.lastJobDate === null);
}
{
  const jobs: Job[] = [
    job({ service: 'Flat Tire Repair', revenue: 100, date: '2026-05-01' }),
    job({ service: 'Flat Tire Repair', revenue: 200, date: '2026-05-03' }),
    job({ service: 'Flat Tire Repair', revenue: 300, date: '2026-05-02' }),
    job({ service: 'Brake Job', revenue: 999, date: '2026-05-04' }),
  ];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('filters to matching service only', h.recentJobCount === 3);
  check('avgPrice = mean of matching', h.avgPrice === 200);
  check('medianPrice (odd count)', h.medianPrice === 200);
  check('minPrice', h.minPrice === 100);
  check('maxPrice', h.maxPrice === 300);
  check('lastJobDate = newest matching date', h.lastJobDate === '2026-05-03');
}
{
  const jobs: Job[] = [
    job({ revenue: 100 }), job({ revenue: 200 }),
    job({ revenue: 300 }), job({ revenue: 500 }),
  ];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('medianPrice (even count) = mean of middle two', h.medianPrice === 250);
}
{
  const jobs: Job[] = [
    job({ revenue: 100, emergency: true }),
    job({ revenue: 300, emergency: true }),
    job({ revenue: 999, highway: true }),
  ];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('recentEmergencyAvg over flagged jobs only', h.recentEmergencyAvg === 200);
  check('recentHighwayAvg over flagged jobs only', h.recentHighwayAvg === 999);
  check('recentLateNightAvg null when no flagged job', h.recentLateNightAvg === null);
}
{
  const jobs: Job[] = Array.from({ length: 60 }, (_, i) =>
    job({ revenue: i, date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}` }));
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('history window caps at 50 jobs', h.recentJobCount === 50);
}
{
  const jobs: Job[] = [job({ revenue: '150' as unknown as number })];
  const h = buildPricingInput(form({}), quote, jobs, 'tire').history;
  check('string revenue coerced to number', h.avgPrice === 150);
}

console.log('\n┌─ parsePricingResponse ────────────────────────────');
check('clean JSON parsed',
  (() => { const r = parsePricingResponse('{"price":130,"rationale":"ok"}', quote);
    return r.ok && r.price === 130 && r.rationale === 'ok'; })());
check('JSON inside markdown fences extracted',
  (() => { const r = parsePricingResponse('```json\n{"price":130,"rationale":"ok"}\n```', quote);
    return r.ok && r.price === 130; })());
check('non-JSON → unparseable',
  (() => { const r = parsePricingResponse('the price is good', quote);
    return !r.ok && r.error === 'unparseable'; })());
check('missing price → malformed',
  (() => { const r = parsePricingResponse('{"rationale":"ok"}', quote);
    return !r.ok && r.error === 'malformed'; })());
check('non-numeric price → malformed',
  (() => { const r = parsePricingResponse('{"price":"lots","rationale":"ok"}', quote);
    return !r.ok && r.error === 'malformed'; })());
check('empty rationale → malformed',
  (() => { const r = parsePricingResponse('{"price":130,"rationale":"  "}', quote);
    return !r.ok && r.error === 'malformed'; })());
check('price above premium*3 → out_of_range',
  (() => { const r = parsePricingResponse('{"price":600,"rationale":"ok"}', quote);
    return !r.ok && r.error === 'out_of_range'; })());
check('price below directCosts → out_of_range',
  (() => { const r = parsePricingResponse('{"price":10,"rationale":"ok"}', quote);
    return !r.ok && r.error === 'out_of_range'; })());
check('price at the band edge accepted',
  (() => { const r = parsePricingResponse('{"price":40,"rationale":"ok"}', quote);
    return r.ok && r.price === 40; })());

console.log(`\n  ${passed} passed, ${failed} failed`);
