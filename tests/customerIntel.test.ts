// tests/customerIntel.test.ts
// Run: npx tsx tests/customerIntel.test.ts
//
// Deterministic customer intelligence: at-risk / top-value / repeat rate.

import { computeCustomerIntel } from '@/lib/customerIntel';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const NOW = Date.parse('2026-06-08T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const customers = [
  { id: 'a', name: 'Alice', lifetimeRevenue: 3000, jobCount: 5, lastJobAt: daysAgo(120) }, // repeat + inactive → at-risk (top value)
  { id: 'b', name: 'Bob',   lifetimeRevenue: 1200, jobCount: 3, lastJobAt: daysAgo(100) }, // repeat + inactive → at-risk
  { id: 'c', name: 'Cara',  lifetimeRevenue: 5000, jobCount: 8, lastJobAt: daysAgo(10) },  // active → NOT at-risk, top value
  { id: 'd', name: 'Dan',   lifetimeRevenue: 200,  jobCount: 1, lastJobAt: daysAgo(200) }, // one-timer → not at-risk (jobCount<2)
  { id: 'e', name: 'Eve',   lifetimeRevenue: 0,    jobCount: 0 },                          // no jobs
];

console.log('\n── at-risk (2+ jobs, 90+ days) ──');
{
  const r = computeCustomerIntel(customers, NOW);
  check('atRiskCount = 2', r.atRiskCount === 2, String(r.atRiskCount));
  check('at-risk ranked by value (Alice before Bob)', r.atRisk[0]?.id === 'a' && r.atRisk[1]?.id === 'b');
  check('active customer NOT at-risk', !r.atRisk.some((c) => c.id === 'c'));
  check('one-timer NOT at-risk', !r.atRisk.some((c) => c.id === 'd'));
  check('daysSince computed (Alice ~120)', (r.atRisk[0]?.daysSince ?? 0) >= 119 && (r.atRisk[0]?.daysSince ?? 0) <= 121);
}

console.log('\n── top by value ──');
{
  const r = computeCustomerIntel(customers, NOW);
  check('top customer is Cara ($5000)', r.topByValue[0]?.id === 'c');
  check('zero-revenue excluded', !r.topByValue.some((c) => c.lifetimeRevenue === 0));
}

console.log('\n── repeat rate ──');
{
  const r = computeCustomerIntel(customers, NOW);
  // repeat (jobCount>1): a,b,c = 3 of 5 = 60%
  check('repeat rate = 60%', r.repeatRatePct === 60, String(r.repeatRatePct));
  check('total = 5', r.total === 5);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
