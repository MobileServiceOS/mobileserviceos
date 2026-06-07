// tests/bandileroGrowth.test.ts
// Run: npx tsx tests/bandileroGrowth.test.ts
//
// Growth synthesis: pricing opportunities from underpriced groups, and
// the unified recommendation ranking across alerts + risks + pricing,
// deduped by id, ranked by dollar impact.

import { pricingOpportunities, rankRecommendations } from '@/lib/bandilero/services/growth';
import { buildRecommendations } from '@/lib/bandilero/recommendations';
import { live, estimated, assertValidMetric } from '@/lib/bandilero/confidence';
import type { Action } from '@/lib/bandilero/types';
import type { PricingDigest } from '@/lib/pricingInsights';
import type { Job, InventoryItem, Settings } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const digest = (groups: PricingDigest['groups']): PricingDigest =>
  ({ vertical: 'tire', windowDays: 90, totalCompletedJobs: 10, currency: 'USD', groups });

const action = (id: string, impact: Action['impact']): Action =>
  ({ id, title: id, detail: '', severity: 'low', impact, source: 'jobs' });

console.log('\n── pricingOpportunities ──');
{
  const d = digest([
    { service: 'Replacement', size: '225/65R17', sales: 4, medianRevenue: 120, p25Revenue: 110, p75Revenue: 130, configuredMin: 150, gapPct: -20 }, // underpriced → opp
    { service: 'Repair', size: '275/40R19', sales: 5, medianRevenue: 160, p25Revenue: 150, p75Revenue: 170, configuredMin: 150, gapPct: 7 },          // above min → skip
  ]);
  const opps = pricingOpportunities(d);
  check('1 pricing opportunity (only the underpriced group)', opps.length === 1, `got ${opps.length}`);
  check('lift ESTIMATED = 120 ((150−120) × 4)', opps[0]?.impact.state === 'ESTIMATED' && opps[0]?.impact.value === 120, `got ${opps[0]?.impact.value}`);
}

console.log('\n── rankRecommendations ──');
{
  const alerts = [action('unpaid-invoices', live(600, 'jobs')), action('critical-stock', estimated(300, 'x', 'inventory'))];
  const risks = [action('risk-churn', estimated(500, 'x', 'customers'))];
  const d = digest([
    { service: 'Replacement', size: '225/65R17', sales: 4, medianRevenue: 120, p25Revenue: 110, p75Revenue: 130, configuredMin: 150, gapPct: -20 }, // lift 120
  ]);
  const ranked = rankRecommendations({ alerts, risks, pricingDigest: d }, 5);
  check('4 recommendations merged', ranked.length === 4, `got ${ranked.length}`);
  check('#1 = unpaid (600)', ranked[0].id === 'unpaid-invoices');
  check('#2 = churn (500)', ranked[1].id === 'risk-churn');
  check('#3 = critical-stock (300)', ranked[2].id === 'critical-stock');
  check('#4 = pricing (120)', ranked[3].impact.value === 120);
}

console.log('\n── dedup by id ──');
{
  const dup = rankRecommendations({
    alerts: [action('risk-churn', live(999, 'jobs'))],          // same id as a risk
    risks: [action('risk-churn', estimated(500, 'x', 'customers'))],
    pricingDigest: digest([]),
  }, 5);
  check('duplicate id collapsed to one', dup.length === 1);
  check('first occurrence wins (the alert, 999)', dup[0].impact.value === 999);
}

console.log('\n── buildRecommendations (end-to-end smoke) ──');
{
  const S = { businessName: 'T', workWeekStartDay: 1, costPerMile: 0.65, freeMilesIncluded: 0,
    expenses: [], invoiceTaxRate: 0, servicePricing: {}, vehiclePricing: {} } as unknown as Settings;
  const job = (o: Partial<Job>): Job => ({
    id: Math.random().toString(36).slice(2), date: '2026-06-07', service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: 'A', customerPhone: '1110000001',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false, ...o } as Job);
  const jobs: Job[] = [
    job({ revenue: 200, status: 'Completed', paymentStatus: 'Pending Payment' }), // unpaid → alert
    job({ revenue: 150, status: 'Completed' }),
  ];
  const inventory: InventoryItem[] = [{ id: 'i1', size: '225/65R17', qty: 0, cost: 80 } as InventoryItem];
  const recs = buildRecommendations({
    jobs, leads: [], inventory, settings: S, connectivity: { twilio: false }, today: '2026-06-07', windowDays: 7,
  });
  check('returns an array', Array.isArray(recs));
  check('every recommendation impact is a valid metric', (() => {
    try { recs.forEach((r) => assertValidMetric(r.impact, r.id)); return true; } catch { return false; }
  })());
  check('sorted by impact desc', recs.every((r, i) => i === 0 || (recs[i - 1].impact.value ?? -Infinity) >= (r.impact.value ?? -Infinity)));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
