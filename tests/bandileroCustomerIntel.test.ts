// tests/bandileroCustomerIntel.test.ts
// Run: npx tsx tests/bandileroCustomerIntel.test.ts
//
// Customer Intelligence from existing jobs/customers — all LIVE, no
// estimates, no Twilio. Returning detection, CLV ranking, inactive-90,
// follow-ups, city repeat-rate trends, tire/service modes.

import { customerIntelligence, customerCity, INACTIVE_DAYS } from '@/lib/bandilero/services/customerIntel';
import { deriveCustomerProfiles } from '@/lib/customers';
import type { Job, Settings } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const S = {
  businessName: 'T', workWeekStartDay: 1, costPerMile: 0.65, freeMilesIncluded: 0,
  expenses: [], invoiceTaxRate: 0, servicePricing: {}, vehiclePricing: {},
} as unknown as Settings;

function job(o: { name: string; phone: string; date: string; revenue: number; city: string; size: string; service: string }): Job {
  return {
    id: Math.random().toString(36).slice(2), date: o.date, service: o.service, vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: o.name, customerPhone: o.phone,
    tireSize: o.size, qty: 1, revenue: o.revenue, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false, city: o.city,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  } as Job;
}

const jobs: Job[] = [
  // Alice — Platinum, 3 jobs, Miami, recent
  job({ name: 'Alice', phone: '1110000001', date: TODAY, revenue: 1000, city: 'Miami', size: '225/65R17', service: 'Tire Replacement' }),
  job({ name: 'Alice', phone: '1110000001', date: TODAY, revenue: 1000, city: 'Miami', size: '225/65R17', service: 'Tire Replacement' }),
  job({ name: 'Alice', phone: '1110000001', date: TODAY, revenue: 1000, city: 'Miami', size: '225/65R17', service: 'Tire Replacement' }),
  // Bob — Gold, 2 jobs, Miami, recent
  job({ name: 'Bob', phone: '1110000002', date: TODAY, revenue: 600, city: 'Miami', size: '225/65R17', service: 'Tire Repair' }),
  job({ name: 'Bob', phone: '1110000002', date: TODAY, revenue: 600, city: 'Miami', size: '225/65R17', service: 'Tire Repair' }),
  // Cara — Standard, 1 job, Davie, recent
  job({ name: 'Cara', phone: '1110000003', date: TODAY, revenue: 100, city: 'Davie', size: '305/35R20', service: 'Tire Replacement' }),
  // Dan — repeat, lapsed (2024), Davie → follow-up
  job({ name: 'Dan', phone: '1110000004', date: '2024-01-01', revenue: 200, city: 'Davie', size: '225/65R17', service: 'Tire Replacement' }),
  job({ name: 'Dan', phone: '1110000004', date: '2024-06-01', revenue: 200, city: 'Davie', size: '225/65R17', service: 'Tire Replacement' }),
  // Eve — not repeat, lapsed (2024), Miami → inactive but not follow-up
  job({ name: 'Eve', phone: '1110000005', date: '2024-06-01', revenue: 50, city: 'Miami', size: '275/40R19', service: 'Tire Replacement' }),
];

console.log('\n── headline counts ──');
{
  const ci = customerIntelligence(jobs, S, TODAY);
  check('totalCustomers = 5', ci.totalCustomers.value === 5, `got ${ci.totalCustomers.value}`);
  check('returningCustomers = 3 (Alice, Bob, Dan)', ci.returningCustomers.value === 3, `got ${ci.returningCustomers.value}`);
  check('returningRatePct = 60', ci.returningRatePct.value === 60, `got ${ci.returningRatePct.value}`);
  check(`inactive ${INACTIVE_DAYS}+ count = 2 (Dan, Eve)`, ci.inactive90Count.value === 2, `got ${ci.inactive90Count.value}`);
  check('all headline metrics LIVE', [ci.totalCustomers, ci.returningCustomers, ci.returningRatePct, ci.inactive90Count].every((m) => m.state === 'LIVE'));
}

console.log('\n── best customers (CLV / revenue) ──');
{
  const ci = customerIntelligence(jobs, S, TODAY);
  check('#1 best = Alice', ci.bestCustomers[0].name === 'Alice');
  check('Alice revenue = 3000', ci.bestCustomers[0].revenue === 3000);
  check('Alice vipTier Platinum', ci.bestCustomers[0].vipTier === 'Platinum');
  check('ranked by revenue desc', ci.bestCustomers.every((r, i) => i === 0 || ci.bestCustomers[i - 1].revenue >= r.revenue));
}

console.log('\n── follow-ups + inactive ──');
{
  const ci = customerIntelligence(jobs, S, TODAY);
  check('inactive90 includes Dan + Eve', ci.inactive90.some((r) => r.name === 'Dan') && ci.inactive90.some((r) => r.name === 'Eve'));
  check('followUps = repeat AND lapsed → just Dan', ci.followUps.length === 1 && ci.followUps[0].name === 'Dan');
  check('Eve excluded from followUps (not repeat)', !ci.followUps.some((r) => r.name === 'Eve'));
}

console.log('\n── city repeat-rate trends ──');
{
  const ci = customerIntelligence(jobs, S, TODAY);
  const miami = ci.cityTrends.find((c) => c.city === 'Miami')!;
  const davie = ci.cityTrends.find((c) => c.city === 'Davie')!;
  check('Miami total 3, repeat 2 → 67%', miami.total === 3 && miami.repeat === 2 && miami.repeatPct === 67, JSON.stringify(miami));
  check('Davie total 2, repeat 1 → 50%', davie.total === 2 && davie.repeat === 1 && davie.repeatPct === 50);
  check('sorted by repeatPct desc (Miami first)', ci.cityTrends[0].city === 'Miami');
}

console.log('\n── most common tire size / service ──');
{
  const ci = customerIntelligence(jobs, S, TODAY);
  check('top tire size = 225/65R17 (count 7)', ci.topTireSizes[0].value === '225/65R17' && ci.topTireSizes[0].count === 7, JSON.stringify(ci.topTireSizes[0]));
  check('top service = Tire Replacement', ci.topServices[0].value === 'Tire Replacement');
}

console.log('\n── customerCity helper ──');
{
  const profiles = deriveCustomerProfiles(jobs, S);
  const alice = profiles.find((p) => p.name === 'Alice')!;
  check('Alice city = Miami', customerCity(alice) === 'Miami');
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
