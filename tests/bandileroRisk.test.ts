// tests/bandileroRisk.test.ts
// Run: npx tsx tests/bandileroRisk.test.ts
//
// Risk signals (Action-shaped): churn (ESTIMATED next-visit value of
// at-risk customers) and revenue-decline (LIVE week-over-week $ drop,
// fires only past the threshold).

import { computeRisks } from '@/lib/bandilero/services/risk';
import type { CustomerProfile } from '@/lib/customers';
import type { WeekPoint } from '@/lib/insights';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const profile = (revenue: number, jobCount: number): CustomerProfile =>
  ({ key: 'k' + Math.random(), name: 'C', phone: '', email: '', jobCount, isRepeat: jobCount > 1,
     revenue, profit: revenue, firstDate: '2025-01-01', lastDate: '2025-02-01', jobs: [],
     tireSizes: [], vehicles: [], paymentMethods: [], paymentMethodCounts: {},
     visitCadenceDays: 30, reviewsSent: 0, unpaidCount: 0, unpaidTotal: 0 } as CustomerProfile);

const trend = (revenues: number[]): WeekPoint[] =>
  revenues.map((r, i) => ({ weekStart: `2026-04-${String(i + 1).padStart(2, '0')}`, revenue: r, profit: r }));

console.log('\n── churn risk ──');
{
  // Two at-risk customers: 600/2 = 300, 400/2 = 200 → exposure 500.
  const risks = computeRisks({ atRiskCustomers: [profile(600, 2), profile(400, 2)], revenueTrend: trend([100, 100, 100]) });
  const churn = risks.find((r) => r.id === 'risk-churn');
  check('churn risk fires', !!churn);
  check('churn impact ESTIMATED = 500', churn?.impact.state === 'ESTIMATED' && churn?.impact.value === 500, `got ${churn?.impact.value}`);
  check('churn severity medium (2 customers)', churn?.severity === 'medium');
  check('no churn risk when none at-risk', !computeRisks({ atRiskCustomers: [], revenueTrend: trend([100, 100, 100]) }).some((r) => r.id === 'risk-churn'));
}

console.log('\n── revenue-decline risk ──');
{
  // trend last entry is the partial current week (ignored). Compare
  // [len-2]=800 (last full week) vs [len-3]=1000 → down 20% ≥ 15%.
  const risks = computeRisks({ atRiskCustomers: [], revenueTrend: trend([1000, 800, 500]) });
  const dec = risks.find((r) => r.id === 'risk-revenue-decline');
  check('decline risk fires at 20% drop', !!dec);
  check('decline impact LIVE = 200 ($1000 − $800)', dec?.impact.state === 'LIVE' && dec?.impact.value === 200, `got ${dec?.impact.value}`);

  // 10% drop → below threshold, no risk.
  const small = computeRisks({ atRiskCustomers: [], revenueTrend: trend([1000, 900, 500]) });
  check('no decline risk at 10% drop (below 15% threshold)', !small.some((r) => r.id === 'risk-revenue-decline'));

  // Revenue up → no risk.
  const up = computeRisks({ atRiskCustomers: [], revenueTrend: trend([800, 1000, 500]) });
  check('no decline risk when revenue rose', !up.some((r) => r.id === 'risk-revenue-decline'));
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
