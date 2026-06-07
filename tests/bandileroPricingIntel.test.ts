// tests/bandileroPricingIntel.test.ts
// Run: npx tsx tests/bandileroPricingIntel.test.ts
//
// Pricing Intelligence (deterministic, no AI): summary (median vs
// configured), and the what-if calculator — suggested price reconciles
// with calcQuote, profit = suggested − directCosts, confidence scales
// with comparable sample, acceptance rate from lead Booked/Lost
// (NOT_CONNECTED with no outcomes).

import {
  pricingSummary, computePricing, confidenceScore, acceptanceRate,
  unitTireCostForSize, comparableJobs,
} from '@/lib/bandilero/services/pricingIntel';
import { calcQuote } from '@/lib/utils';
import type { Job, Lead, InventoryItem, Settings, QuoteForm } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const S = {
  businessName: 'T', workWeekStartDay: 1, costPerMile: 0.65, freeMilesIncluded: 0,
  expenses: [], invoiceTaxRate: 0,
  servicePricing: { 'Tire Replacement': { basePrice: 150, minProfit: 50 } },
  vehiclePricing: { Sedan: { addOnProfit: 0 } },
} as unknown as Settings;

function job(o: Partial<Job>): Job {
  return {
    id: Math.random().toString(36).slice(2), date: TODAY, service: 'Tire Replacement', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: '', customerPhone: '',
    tireSize: '225/65R17', qty: 1, revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false, ...o,
  } as Job;
}

// 3 completed jobs of the same (service,size), all $120 (underpriced vs $150 base).
const jobs: Job[] = [
  job({ revenue: 120 }), job({ revenue: 120 }), job({ revenue: 120 }),
];
const inventory: InventoryItem[] = [{ id: 'i1', size: '225/65R17', qty: 8, cost: 80 } as InventoryItem];

console.log('\n── pricingSummary ──');
{
  const rows = pricingSummary(jobs, S, TODAY);
  const row = rows.find((r) => r.size === '225/65R17');
  check('row present for the (service,size)', !!row);
  check('median = 120', row?.median === 120, `got ${row?.median}`);
  check('configuredMin = 150', row?.configuredMin === 150);
  check('gapPct = -20 (underpriced)', row?.gapPct === -20, `got ${row?.gapPct}`);
  check('suggestedAdjustment = 30 (raise to min)', row?.suggestedAdjustment === 30, `got ${row?.suggestedAdjustment}`);
}

console.log('\n── unitTireCostForSize ──');
{
  check('matching size → cheapest cost 80', unitTireCostForSize(inventory, '225/65R17') === 80);
  check('no match → 0', unitTireCostForSize(inventory, '305/35R20') === 0);
}

console.log('\n── computePricing reconciles with calcQuote ──');
{
  const input = { service: 'Tire Replacement', vehicleType: 'Sedan', tireSize: '225/65R17', miles: 10, qty: 4, timeOfDay: 'standard' as const };
  const q = computePricing(input, { jobs, leads: [], inventory, settings: S });

  // Equivalent QuoteForm the engine would price (tireCost per-unit = 80).
  const form: QuoteForm = { service: 'Tire Replacement', vehicleType: 'Sedan', miles: 10, qty: 4, tireCost: 80, emergency: false, lateNight: false, weekend: false };
  const ref = calcQuote(form, S);

  check('suggestedPrice LIVE = calcQuote.suggested', q.suggestedPrice.state === 'LIVE' && q.suggestedPrice.value === ref.suggested, `got ${q.suggestedPrice.value} vs ${ref.suggested}`);
  check('estimatedProfit = suggested − directCosts', q.estimatedProfit.value === Math.round((ref.suggested - ref.directCosts) * 100) / 100, `got ${q.estimatedProfit.value}`);
  check('unitTireCost = 80 (from inventory)', q.unitTireCost === 80);
  check('comparableJobs = 3', q.comparableJobs === 3, `got ${q.comparableJobs}`);
}

console.log('\n── confidenceScore ──');
{
  const ident = (rev: number, n: number) => Array.from({ length: n }, () => job({ revenue: rev }));
  check('0 comparable → 0', confidenceScore([]) === 0);
  check('1 comparable → 26 (0.1 sample, 0.5 consistency)', confidenceScore(ident(120, 1)) === 26, `got ${confidenceScore(ident(120, 1))}`);
  check('3 identical → 58 (0.3 sample, 1.0 consistency)', confidenceScore(ident(120, 3)) === 58, `got ${confidenceScore(ident(120, 3))}`);
  check('10 identical → 100', confidenceScore(ident(120, 10)) === 100);
  // Wider spread lowers consistency → lower than identical.
  const spread = [job({ revenue: 60 }), job({ revenue: 200 }), job({ revenue: 120 })];
  check('high spread < identical 3', confidenceScore(spread) < 58);
}

console.log('\n── acceptanceRate (from leads) ──');
{
  const lead = (status: Lead['status']): Lead => ({ id: 'l' + Math.random(), customerId: 'c', phoneE164: '+1', source: 'missed_call', status, wasNewCustomer: true, autoTextSent: false } as unknown as Lead);
  const r = acceptanceRate([lead('Booked'), lead('Booked'), lead('Lost')]);
  check('2 booked / 1 lost → 67% LIVE', r.state === 'LIVE' && r.value === 67, `got ${r.value}`);
  check('no outcomes → NOT_CONNECTED (not 0%)', acceptanceRate([lead('New')]).state === 'NOT_CONNECTED');
  check('empty leads → NOT_CONNECTED', acceptanceRate([]).state === 'NOT_CONNECTED' && acceptanceRate([]).value === null);
}

console.log('\n── comparableJobs filtering ──');
{
  const mixed = [
    job({ service: 'Tire Replacement', tireSize: '225/65R17', city: 'Davie' }),
    job({ service: 'Tire Repair', tireSize: '225/65R17' }),         // wrong service
    job({ service: 'Tire Replacement', tireSize: '305/35R20' }),    // wrong size
    job({ service: 'Tire Replacement', tireSize: '225/65R17', status: 'Cancelled' }), // not completed
  ];
  check('filters by service + size + completed', comparableJobs(mixed, { service: 'Tire Replacement', tireSize: '225/65R17' }).length === 1);
  check('city filter narrows further', comparableJobs(mixed, { service: 'Tire Replacement', tireSize: '225/65R17', city: 'Miami' }).length === 0);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
