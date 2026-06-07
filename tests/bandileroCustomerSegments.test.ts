// tests/bandileroCustomerSegments.test.ts
// Run: npx tsx tests/bandileroCustomerSegments.test.ts
//
// Customer segmentation derived from real jobs: VIP (deriveVipTier),
// repeat, new (recent first job), at-risk (overdue vs cadence / 12-mo
// inactive). Boundary-checked.

import { customerSegments, isVip, isNewCustomer, isAtRisk } from '@/lib/bandilero/services/customerSegments';
import { deriveCustomerProfiles } from '@/lib/customers';
import type { Job, Settings } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const S = {
  businessName: 'Test', workWeekStartDay: 1, costPerMile: 0.65, freeMilesIncluded: 0,
  expenses: [], invoiceTaxRate: 0, servicePricing: {}, vehiclePricing: {},
} as unknown as Settings;

function job(name: string, phone: string, date: string, revenue: number): Job {
  return {
    id: Math.random().toString(36).slice(2), date, service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '',
    customerName: name, customerPhone: phone,
    tireSize: '', qty: 1, revenue, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  } as Job;
}

const jobs: Job[] = [
  // A — Platinum VIP ($3000), single job today → new, not repeat
  job('Alice', '1110000001', TODAY, 3000),
  // B — Gold VIP ($1200 across 2 jobs today) → repeat, new
  job('Bob', '1110000002', TODAY, 600),
  job('Bob', '1110000002', TODAY, 600),
  // C — Standard, single job today → new, not VIP, not at-risk
  job('Cara', '1110000003', TODAY, 100),
  // D — repeat ($400), last job 2 years ago → Inactive → at-risk, not new
  job('Dan', '1110000004', '2024-01-01', 200),
  job('Dan', '1110000004', '2024-06-01', 200),
];

console.log('\n── segment counts ──');
{
  const seg = customerSegments(jobs, S, TODAY);
  check('total = 4 distinct customers', seg.counts.total.value === 4, `got ${seg.counts.total.value}`);
  check('vip = 2 (Alice Platinum + Bob Gold)', seg.counts.vip.value === 2, `got ${seg.counts.vip.value}`);
  check('repeat = 2 (Bob + Dan)', seg.counts.repeat.value === 2, `got ${seg.counts.repeat.value}`);
  check('atRisk = 1 (Dan, inactive)', seg.counts.atRisk.value === 1, `got ${seg.counts.atRisk.value}`);
  check('all counts LIVE', Object.values(seg.counts).every((m) => m.state === 'LIVE'));
}

console.log('\n── vip / at-risk lists ──');
{
  const seg = customerSegments(jobs, S, TODAY);
  check('vipList sorted by revenue desc (Alice first)', seg.vipList[0]?.name === 'Alice');
  check('atRiskList contains Dan', seg.atRiskList.some((p) => p.name === 'Dan'));
  check('atRiskList excludes active repeat Bob', !seg.atRiskList.some((p) => p.name === 'Bob'));
}

console.log('\n── predicate boundaries ──');
{
  const profiles = deriveCustomerProfiles(jobs, S);
  const byName = (n: string) => profiles.find((p) => p.name === n)!;
  check('isVip Alice (Platinum)', isVip(byName('Alice')));
  check('isVip Bob (Gold)', isVip(byName('Bob')));
  check('NOT isVip Cara (Standard)', !isVip(byName('Cara')));
  check('isNewCustomer Cara (first job today)', isNewCustomer(byName('Cara'), TODAY));
  check('NOT isNewCustomer Dan (first job 2024)', !isNewCustomer(byName('Dan'), TODAY));
  check('isAtRisk Dan (inactive repeat)', isAtRisk(byName('Dan'), TODAY));
  check('NOT isAtRisk Bob (active repeat today)', !isAtRisk(byName('Bob'), TODAY));
  check('NOT isAtRisk Alice (single job, not repeat)', !isAtRisk(byName('Alice'), TODAY));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
