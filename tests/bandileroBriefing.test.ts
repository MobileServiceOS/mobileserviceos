// tests/bandileroBriefing.test.ts
// Run: npx tsx tests/bandileroBriefing.test.ts
//
// Daily-briefing assembly end-to-end on seeded data:
//   - greeting pulls business name;
//   - EVERY metric carries a valid confidence state (invariant sweep);
//   - no NOT_CONNECTED metric leaks a non-null value;
//   - technicians get a RESTRICTED (not faked) financial section + no
//     dollar Actions;
//   - sources with no integration render NOT_CONNECTED, never 0;
//   - missed calls render NOT_CONNECTED when Twilio is off.

import { buildDailyBriefing } from '@/lib/bandilero/briefing';
import { assertValidMetric } from '@/lib/bandilero/confidence';
import type { Connectivity } from '@/lib/bandilero/types';
import type { Job, Lead, InventoryItem, ReviewRequest, Settings } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const S = {
  businessName: 'Acme Mobile Tire', workWeekStartDay: 1, costPerMile: 0.65, freeMilesIncluded: 0,
  expenses: [], invoiceTaxRate: 0, servicePricing: {}, vehiclePricing: {},
} as unknown as Settings;

function job(over: Partial<Job>): Job {
  return {
    id: Math.random().toString(36).slice(2), date: TODAY, service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    ...over,
  } as Job;
}
const item = (o: Partial<InventoryItem>): InventoryItem =>
  ({ id: Math.random().toString(36).slice(2), size: '', qty: 0, cost: 0, ...o } as InventoryItem);

const jobs: Job[] = [
  job({ date: TODAY, status: 'Completed', revenue: 200 }),
  job({ date: TODAY, status: 'Completed', revenue: 100 }),
  job({ date: TODAY, status: 'Cancelled', revenue: 999 }),
  job({ date: '2026-06-06', status: 'Completed', revenue: 150 }),
];
const inventory: InventoryItem[] = [
  item({ size: '225/65R17', qty: 0, cost: 80 }),     // critical → drives an Action
  item({ size: '225/65R17', qty: 5, cost: 80 }),     // healthy (size sold today)
];
const reviewRequests: ReviewRequest[] = [];
const OFF: Connectivity = { ai: false, twilio: false, reviews: false, gbp: false, seo: false, dispatch: false };

// Sweep helper: assert every metric in the briefing is a valid state.
function sweep(b: ReturnType<typeof buildDailyBriefing>): { ok: boolean; leaks: number } {
  let ok = true, leaks = 0;
  for (const s of b.sections) {
    for (const m of s.metrics) {
      try { assertValidMetric(m, `${s.key}.${m.label}`); } catch { ok = false; }
      if (m.state === 'NOT_CONNECTED' && m.value !== null) leaks += 1;
    }
  }
  for (const a of b.topActions) { try { assertValidMetric(a.impact, a.id); } catch { ok = false; } }
  return { ok, leaks };
}

console.log('\n── owner briefing (canViewFinancials true) ──');
{
  const b = buildDailyBriefing({
    today: TODAY, settings: S, jobs, leads: [], reviewRequests, inventory,
    connectivity: OFF, operatorName: 'Dee', businessName: S.businessName, canViewFinancials: true,
  });
  check('greeting businessName set', b.greeting.businessName === 'Acme Mobile Tire');
  check('greeting operatorName set', b.greeting.operatorName === 'Dee');

  const sw = sweep(b);
  check('invariant sweep: all metrics valid', sw.ok);
  check('no NOT_CONNECTED metric leaks a value', sw.leaks === 0);

  const revenue = b.sections.find(s => s.key === 'revenue')!;
  check('revenue section visible (3 metrics)', !revenue.restricted && revenue.metrics.length === 3);
  check('revenue today metric = 300', revenue.metrics[0].value === 300, `got ${revenue.metrics[0].value}`);

  check('actionsRestricted false for owner', b.actionsRestricted !== true);
  check('top actions include critical-stock', b.topActions.some(a => a.id === 'critical-stock'));
  check('every action carries a source', b.topActions.every(a => !!a.source));
  check('narrative NOT_CONNECTED by default (AI off)', b.narrative.state === 'NOT_CONNECTED' && b.narrative.value === null);
}

console.log('\n── command-briefing section order (spec) ──');
{
  const b = buildDailyBriefing({
    today: TODAY, settings: S, jobs, leads: [], reviewRequests, inventory,
    connectivity: OFF, operatorName: null, businessName: S.businessName, canViewFinancials: true,
  });
  check('sections are exactly: revenue, jobs, missedCalls, reviews, inventory (in order)',
    b.sections.map(s => s.key).join(',') === 'revenue,jobs,missedCalls,reviews,inventory',
    b.sections.map(s => s.key).join(','));
  // The not-integrated sources (review score / SEO / dispatch) live in the
  // dedicated Reputation panel now, not the core briefing.
  check('no growth/customers section in the core briefing', !b.sections.some(s => s.key === 'growth' || s.key === 'customers'));
  const jobs2 = b.sections.find(s => s.key === 'jobs')!;
  check('jobs section has a Pending metric', jobs2.metrics.some(m => m.label === 'Pending'));
}

console.log('\n── missed calls render NOT_CONNECTED when Twilio off ──');
{
  const b = buildDailyBriefing({
    today: TODAY, settings: S, jobs, leads: [], reviewRequests, inventory,
    connectivity: OFF, operatorName: null, businessName: S.businessName, canViewFinancials: true,
  });
  const mc = b.sections.find(s => s.key === 'missedCalls')!;
  check('missed-call metrics NOT_CONNECTED (not 0)', mc.metrics.every(m => m.state === 'NOT_CONNECTED' && m.value === null));
}

console.log('\n── missed calls LIVE when Twilio on ──');
{
  const leads = [{
    id: 'l1', customerId: 'c', phoneE164: '+1', source: 'missed_call', status: 'New',
    wasNewCustomer: true, autoTextSent: false,
    receivedAt: { toMillis: () => new Date(TODAY + 'T12:00:00').getTime() },
  }] as unknown as Lead[];
  const ON: Connectivity = { ...OFF, twilio: true };
  const b = buildDailyBriefing({
    today: TODAY, settings: S, jobs, leads, reviewRequests, inventory,
    connectivity: ON, operatorName: null, businessName: S.businessName, canViewFinancials: true,
  });
  const mc = b.sections.find(s => s.key === 'missedCalls')!;
  check('missed-call count LIVE = 1', mc.metrics[0].state === 'LIVE' && mc.metrics[0].value === 1);
}

console.log('\n── technician briefing: financials REDACTED, not faked ──');
{
  const b = buildDailyBriefing({
    today: TODAY, settings: S, jobs, leads: [], reviewRequests, inventory,
    connectivity: OFF, operatorName: 'Tech', businessName: S.businessName, canViewFinancials: false,
  });
  const revenue = b.sections.find(s => s.key === 'revenue')!;
  check('revenue section restricted', revenue.restricted === true);
  check('revenue metrics withheld (no value leaked)', revenue.metrics.length === 0);
  check('top actions withheld for tech', b.topActions.length === 0);
  check('actionsRestricted flag true', b.actionsRestricted === true);

  // Operational sections still visible to techs.
  const jobsSec = b.sections.find(s => s.key === 'jobs')!;
  check('jobs section still visible to tech', !jobsSec.restricted && jobsSec.metrics.length > 0);
  check('jobs completed-today = 2', jobsSec.metrics.find(m => m.label === 'Completed today')?.value === 2);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
